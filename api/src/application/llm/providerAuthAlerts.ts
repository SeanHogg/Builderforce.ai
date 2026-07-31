import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Per-tenant BYO credential AUTH ALERTS — the bridge that turns a buried cascade
 * failure into an operator-facing "reconnect this account" prompt.
 *
 * The problem this closes: when a tenant's connected account is authenticated but
 * REJECTED (a ChatGPT/Codex 403 because the plan lapsed or the account isn't
 * entitled to Codex; an expired Claude subscription token; a rotated BYO key), the
 * gateway does the right thing operationally — it classifies the attempt `auth`,
 * cools the vendor for 30 minutes, and fails over — and then throws the signal
 * away. The run still succeeds on another model, so nobody is told. The credential
 * health surface (`GET /provider-keys/:provider/status`) can't see it either: that
 * endpoint reports whether the credential RESOLVES, and an unentitled-but-live
 * token resolves perfectly. So the account stays "● connected", silently unused,
 * indefinitely.
 *
 * The fix is a small write-on-failure / read-on-status store:
 *
 *   dispatch fails ─► FailoverEvent{kind:'auth'} ─► recordProviderAuthAlerts()
 *                                                        │  (KV, per tenant+provider)
 *   Settings ▸ API Keys ─► GET /provider-keys/:p/status ─┘─► authAlert → "Reconnect"
 *
 * Scoping: alerts are keyed by TENANT + provider, never globally — one tenant's
 * lapsed ChatGPT plan says nothing about another's. It rides the same
 * `AUTH_CACHE_KV` binding as `cooldownStore` / key-resolution caching under its own
 * `byoauth:` prefix (no second namespace to provision), and degrades to a
 * per-isolate Map when KV is unbound so dev/test behave.
 *
 * Deliberately NOT the cooldown store: a cooldown is a routing decision with a
 * short TTL whose whole job is to expire quietly. An alert is a REMEDIATION notice
 * that must outlive the routing backoff (30 min) so an operator who looks at the
 * settings page hours later still sees why their account went quiet — hence a
 * separate store with its own, much longer, TTL.
 */

import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { CODEX_AUTH_MARKER } from './vendors/openaiCodex';
import { CAPACITY_LIMIT_MARKER, isCapacityLimitBody } from './vendors';
import { PROVIDER_VENDOR_MAP, isSupportedProvider, type LlmProvider } from './tenantProviderKeyService';

/** Just the slice of `Env` this module needs — mirrors `CooldownEnv`'s narrowing so
 *  the proxy's `ProxyEnv` and route `Env` are both callable without a cast. */
export interface ProviderAuthAlertEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

/**
 * How long a recorded rejection keeps prompting. 7 days: long enough that a
 * weekly-cadence operator still sees the notice that explains a quiet account,
 * short enough that a credential fixed out-of-band (a plan renewed, a key rotated
 * elsewhere) stops nagging on its own without needing an explicit dismissal.
 * A successful reconnect clears it eagerly via {@link clearProviderAuthAlert}.
 */
const ALERT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Short read-through cache on the status endpoint's lookup. The alert changes at
 *  most once per 30-minute vendor cooldown, and the settings drawer re-reads status
 *  on every open + auth-type change, so a 60s window collapses that burst to one KV
 *  read while still surfacing a fresh rejection within a page refresh or two. */
const ALERT_READ_TTL_SECONDS = 60;

export type ProviderAuthAlertReason = 'not_entitled' | 'rejected' | 'capacity' | 'unresolved';

/**
 * WHOSE credential an alert is about.
 *
 * A tenant holds two structurally different kinds of rankable account, and both break the
 * same ways. A provider is keyed by its id; an OpenRouter CONNECTION (migration 0382) has no
 * provider row at all — it is keyed by numeric id — so keying this store on `LlmProvider`
 * alone meant a connection whose own `sk-or-…` key was revoked or out of credit raised
 * nothing and its card showed nothing. The tenant only found out when the cascade quietly
 * failed over onto the operator key.
 */
export type AuthAlertSubject =
  | { kind: 'provider'; provider: LlmProvider }
  | { kind: 'connection'; connectionId: number };

/** An alert about ONE named OpenRouter connection. Same fields as a provider alert minus the
 *  provider id, which a connection does not have — `vendor` is always `openrouter`. */
export interface ConnectionAuthAlert {
  connectionId: number;
  reason: ProviderAuthAlertReason;
  status: number;
  vendor: string;
  at: number;
}

export interface ProviderAuthAlert {
  provider: LlmProvider;
  /** Which remediation to show. `not_entitled` = the account authenticated but the
   *  plan doesn't cover this surface (the Codex 403 case) — reconnecting a DIFFERENT
   *  account or upgrading the plan is the fix. `rejected` = the credential itself was
   *  refused (401, expired/revoked token, rotated key) — reconnect the same account.
   *  `capacity` = the credential is valid but the ACCOUNT is out of budget (spend cap /
   *  no credits) — top up, don't reconnect. `unresolved` = the stored credential could
   *  not even be decrypted or refreshed ({@link ByoUnresolvedReason}), so nothing was
   *  ever sent upstream; only the daily probe can observe this. */
  reason: ProviderAuthAlertReason;
  /** Upstream HTTP status that produced the alert (401 / 403 / 429-capacity), or `0`
   *  when the credential failed before any request was made (`unresolved`). */
  status: number;
  /** The gateway vendor that was rejected — `openai-codex` vs `openai` matters to
   *  the operator ("your ChatGPT subscription" vs "your OpenAI API key"). */
  vendor: string;
  /** Epoch-ms of the most recent rejection. */
  at: number;
}

/**
 * Gateway vendor id → the BYO provider a tenant connects in Settings ▸ API Keys.
 *
 * Derived from {@link PROVIDER_VENDOR_MAP} rather than hand-listed, so a new
 * provider is picked up automatically — PLUS the OAuth-only vendor aliases, which
 * that map does not carry: a connected ChatGPT subscription dispatches as
 * `openai-codex` and a connected Grok subscription as `xai-oauth`, but both are
 * managed under their base provider's card. Mirrors the same aliasing
 * `byoVendorPriorityOrder` applies in the other direction.
 */
const PROVIDER_BY_VENDOR: ReadonlyMap<string, LlmProvider> = new Map<string, LlmProvider>([
  ...(Object.entries(PROVIDER_VENDOR_MAP) as Array<[LlmProvider, { vendorId: string }]>)
    .map(([provider, { vendorId }]) => [vendorId, provider] as [string, LlmProvider]),
  ['openai-codex', 'openai'],
  ['xai-oauth', 'xai'],
]);

/** The BYO provider a gateway vendor belongs to, or `null` when the vendor is not
 *  something a tenant can connect (an operator-pool vendor like `openrouter`). */
export function providerForVendor(vendorId: string): LlmProvider | null {
  return PROVIDER_BY_VENDOR.get(vendorId) ?? null;
}

/** Minimal shape this module reads off a `FailoverEvent` — declared structurally so
 *  the alert layer doesn't drag the whole proxy result type into route code. The
 *  normalised `kind` is deliberately NOT read: {@link providerAlertFromFailure} keys off
 *  the raw status + detail so a capacity failure (which arrives as a rate-limit kind)
 *  isn't filtered out before it can be classified. */
export interface AuthFailoverLike {
  vendor: string;
  code: number;
  detail?: string;
}

/**
 * THE classifier: does one upstream failure mean the tenant's connected account needs
 * attention, and which remediation? `null` = no, don't prompt.
 *
 * PURE — no I/O, no env — so it is unit-testable without KV or a live upstream, and so
 * callers can decide whether a write is needed at all before paying for one. Shared by
 * the dispatch-observed path ({@link authAlertsFromFailovers}) and the daily/on-demand
 * credential probe ({@link probeByoProvider}), so a failure classified as "broken" in a
 * background run is classified identically when a request hits it, and the settings page
 * can never disagree with the email.
 *
 * Rules:
 *  - only vendors that map to a CONNECTABLE provider count — an operator-pool key
 *    failing auth is our problem, not something the tenant can fix from settings;
 *  - a spend-cap / out-of-credits failure ({@link CAPACITY_LIMIT_MARKER}), including
 *    xAI's raw "weekly limit" 403 wording, is `capacity`:
 *    the credential is fine, so telling the owner to reconnect would be wrong advice.
 *    It is checked FIRST because it rides on a 429/400 that the gates below would
 *    otherwise misroute (mirrors `cooldownStore.classifyFailure`);
 *  - a Codex entitlement 403 ({@link CODEX_AUTH_MARKER}) — or any 403 — is
 *    `not_entitled`: the account authenticated but isn't allowed on this surface;
 *  - a 401 is `rejected`: the credential itself was refused;
 *  - everything else (429 without the capacity marker, 5xx, timeouts, 400 schema
 *    errors) returns `null`. A transient blip must never nag an owner to reconnect a
 *    working account, and it must never fire the "your integration stopped working"
 *    email — that is the same email-quiet rule the vendor-health cron follows.
 */
export function providerAlertFromFailure(
  vendor: string,
  status: number,
  detail?: string,
  now: number = Date.now(),
): ProviderAuthAlert | null {
  const provider = providerForVendor(vendor);
  if (!provider) return null;
  const reason = authAlertReason(status, detail);
  if (!reason) return null;
  return { provider, reason, status, vendor, at: now };
}

/**
 * The REASON half of the classification, with no opinion about whose credential failed.
 *
 * Split out because an OpenRouter connection fails in exactly these ways and yet
 * {@link providerForVendor} returns null for `openrouter` — correctly, since no settings card
 * connects "OpenRouter the provider". Sharing the rules (rather than re-deriving them for the
 * connection surface) is what stops a revoked connection key being called `rejected` on one
 * surface and `not_entitled` on the other.
 */
export function authAlertReason(status: number, detail?: string): ProviderAuthAlertReason | null {
  const text = (detail ?? '').toLowerCase();
  return text.includes(CAPACITY_LIMIT_MARKER.toLowerCase()) || isCapacityLimitBody(text) ? 'capacity'
    : text.includes(CODEX_AUTH_MARKER) || status === 403 ? 'not_entitled'
    : status === 401 ? 'rejected'
    : null;
}

/** The same classification for ONE OpenRouter connection. `null` = a transient blip that must
 *  not paint the card or mail anyone, exactly as on the provider path. */
export function connectionAlertFromFailure(
  connectionId: number,
  vendor: string,
  status: number,
  detail?: string,
  now: number = Date.now(),
): ConnectionAuthAlert | null {
  const reason = authAlertReason(status, detail);
  if (!reason) return null;
  return { connectionId, reason, status, vendor, at: now };
}

/**
 * Project a cascade's failover events onto the BYO providers that need attention.
 *
 * Deduped per provider, keeping the FIRST occurrence — the cascade walks the tenant's
 * accounts in precedence order, so the first failure is the highest-precedence account,
 * i.e. the one worth naming. Classification itself lives in
 * {@link providerAlertFromFailure}; this function is only the projection + dedupe.
 */
export function authAlertsFromFailovers(
  failovers: ReadonlyArray<AuthFailoverLike>,
  now: number = Date.now(),
): ProviderAuthAlert[] {
  const byProvider = new Map<LlmProvider, ProviderAuthAlert>();
  for (const f of failovers) {
    const alert = providerAlertFromFailure(f.vendor, f.code, f.detail, now);
    if (!alert || byProvider.has(alert.provider)) continue;
    byProvider.set(alert.provider, alert);
  }
  return [...byProvider.values()];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * The storage key for one alert subject.
 *
 * The PROVIDER form is unchanged (`byoauth:<tenant>:<provider>`) — widening the keyspace must
 * not orphan alerts already sitting in KV under the old shape. Connections take a
 * `connection:<id>` segment, which can never collide because no provider id contains a colon.
 */
function alertKey(tenantId: number, subject: AuthAlertSubject): string {
  return subject.kind === 'provider'
    ? `byoauth:${tenantId}:${subject.provider}`
    : `byoauth:${tenantId}:connection:${subject.connectionId}`;
}

/** Per-isolate fallback for environments without `AUTH_CACHE_KV` (unit tests, local
 *  dev). Values carry their own expiry because a Map has no TTL. */
const memoryAlerts = new Map<string, { alert: AuthAlert; until: number }>();

/** Either flavour of stored alert. */
export type AuthAlert = ProviderAuthAlert | ConnectionAuthAlert;

/** Test seam — drop in-memory alerts between cases. */
export function _resetMemoryProviderAuthAlerts(): void {
  memoryAlerts.clear();
}

/**
 * Persist every auth alert a cascade produced. Never throws: a KV hiccup must not
 * fail (or even slow) a request that already succeeded on another model, so each
 * write is individually swallowed.
 */
export async function recordProviderAuthAlerts(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  failovers: ReadonlyArray<AuthFailoverLike>,
): Promise<void> {
  const alerts = authAlertsFromFailovers(failovers);
  if (alerts.length === 0) return;
  await Promise.all(alerts.map((alert) => recordProviderAuthAlert(env, tenantId, alert)));
}

/**
 * Persist ONE alert. The single write path — {@link recordProviderAuthAlerts} (the
 * dispatch-observed cascade) and the credential probe (`probeByoProvider`, on-demand and
 * from the daily cron) both land here, so the settings page reads one shape regardless of
 * which surface noticed the breakage.
 *
 * Never throws: alerting is advisory and must not fail a request that already succeeded
 * elsewhere, nor abort a cron sweep partway through a tenant list.
 */
export async function recordProviderAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  alert: ProviderAuthAlert,
): Promise<void> {
  return recordAuthAlert(env, tenantId, { kind: 'provider', provider: alert.provider }, alert);
}

/** Persist ONE connection's alert — the connection-shaped twin of
 *  {@link recordProviderAuthAlert}, sharing its store, TTL and never-throws contract. */
export async function recordConnectionAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  alert: ConnectionAuthAlert,
): Promise<void> {
  return recordAuthAlert(env, tenantId, { kind: 'connection', connectionId: alert.connectionId }, alert);
}

async function recordAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  subject: AuthAlertSubject,
  alert: AuthAlert,
): Promise<void> {
  const key = alertKey(tenantId, subject);
  memoryAlerts.set(key, { alert, until: alert.at + ALERT_TTL_SECONDS * 1000 });
  // Drop the read-through entry so the settings page reflects a fresh rejection
  // on its next poll instead of serving a cached "healthy" for up to a minute.
  await invalidateCached(env as unknown as Env, key).catch((error) => { /* advisory */ 
    reportCaughtError(error, { source: "application/llm/providerAuthAlerts.ts", operation: "recordProviderAuthAlert" });
  });
  if (!env.AUTH_CACHE_KV) return;
  try {
    await env.AUTH_CACHE_KV.put(key, JSON.stringify(alert), { expirationTtl: ALERT_TTL_SECONDS });
  } catch (error) { /* alerting is advisory — never surface a storage failure */ 
    reportCaughtError(error, { source: "application/llm/providerAuthAlerts.ts", operation: "recordProviderAuthAlert" });
  }
}

/**
 * Read the live alert for one tenant+provider, or `null` when the account is
 * healthy. Goes through the canonical read-through cache ({@link getOrSetCached})
 * rather than an ad-hoc Map+TTL, so the credential-status endpoint — which the
 * settings drawer re-reads on every open — collapses to one KV read per minute per
 * tenant+provider and shares the same L1/L2 invalidation semantics as every other
 * cached read in the app.
 */
export async function loadProviderAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  provider: LlmProvider,
): Promise<ProviderAuthAlert | null> {
  return loadAuthAlert(
    env, tenantId, { kind: 'provider', provider },
    (parsed): parsed is ProviderAuthAlert => isSupportedProvider((parsed as ProviderAuthAlert).provider),
  );
}

/** Read the live alert for ONE OpenRouter connection, or `null` when it is healthy. Same
 *  store, cache window and degradation as the provider read. */
export async function loadConnectionAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  connectionId: number,
): Promise<ConnectionAuthAlert | null> {
  return loadAuthAlert(
    env, tenantId, { kind: 'connection', connectionId },
    (parsed): parsed is ConnectionAuthAlert => typeof (parsed as ConnectionAuthAlert).connectionId === 'number',
  );
}

async function loadAuthAlert<T extends AuthAlert>(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  subject: AuthAlertSubject,
  // A stored value is validated against the shape the CALLER expects, so a hand-edited or
  // legacy KV entry degrades to "healthy" instead of being handed back mis-typed.
  isValid: (parsed: AuthAlert) => parsed is T,
): Promise<T | null> {
  const key = alertKey(tenantId, subject);
  return getOrSetCached<T | null>(
    env as unknown as Env,
    key,
    async () => {
      if (env.AUTH_CACHE_KV) {
        try {
          const raw = await env.AUTH_CACHE_KV.get(key);
          if (raw) {
            const parsed = JSON.parse(raw) as AuthAlert;
            if (isValid(parsed)) return parsed;
          }
          return null;
        } catch (error) { /* fall through to the in-memory copy */
          reportCaughtError(error, { source: "application/llm/providerAuthAlerts.ts", operation: "loadAuthAlert" });
        }
      }
      const local = memoryAlerts.get(key);
      if (!local) return null;
      if (Date.now() >= local.until) { memoryAlerts.delete(key); return null; }
      return isValid(local.alert) ? local.alert : null;
    },
    { kvTtlSeconds: ALERT_READ_TTL_SECONDS },
  );
}

/**
 * Drop a provider's alert — called when the tenant reconnects or removes the
 * credential, so the prompt disappears immediately instead of lingering for the
 * remainder of its TTL and telling the operator to redo work they just did.
 */
export async function clearProviderAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  provider: LlmProvider,
): Promise<void> {
  return clearAuthAlert(env, tenantId, { kind: 'provider', provider });
}

/** Drop ONE connection's alert — on a successful probe, or when the registration is edited
 *  or removed, so a fixed connection stops warning about work the operator just did. */
export async function clearConnectionAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  connectionId: number,
): Promise<void> {
  return clearAuthAlert(env, tenantId, { kind: 'connection', connectionId });
}

async function clearAuthAlert(
  env: ProviderAuthAlertEnv,
  tenantId: number,
  subject: AuthAlertSubject,
): Promise<void> {
  const key = alertKey(tenantId, subject);
  memoryAlerts.delete(key);
  await invalidateCached(env as unknown as Env, key).catch((error) => { /* advisory */ 
    reportCaughtError(error, { source: "application/llm/providerAuthAlerts.ts", operation: "clearProviderAuthAlert" });
  });
  if (!env.AUTH_CACHE_KV) return;
  try { await env.AUTH_CACHE_KV.delete(key); } catch (error) { /* advisory */ 
    reportCaughtError(error, { source: "application/llm/providerAuthAlerts.ts", operation: "clearProviderAuthAlert" });
  }
}
