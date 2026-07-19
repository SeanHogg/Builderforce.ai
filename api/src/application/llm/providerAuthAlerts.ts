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

export type ProviderAuthAlertReason = 'not_entitled' | 'rejected';

export interface ProviderAuthAlert {
  provider: LlmProvider;
  /** Which remediation to show. `not_entitled` = the account authenticated but the
   *  plan doesn't cover this surface (the Codex 403 case) — reconnecting a DIFFERENT
   *  account or upgrading the plan is the fix. `rejected` = the credential itself was
   *  refused (401, expired/revoked token, rotated key) — reconnect the same account. */
  reason: ProviderAuthAlertReason;
  /** Upstream HTTP status that produced the alert (401 / 403). */
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
 *  the alert layer doesn't drag the whole proxy result type into route code. */
export interface AuthFailoverLike {
  vendor: string;
  code: number;
  kind?: string;
  detail?: string;
}

/**
 * Project a cascade's failover events onto the BYO providers that need reconnecting.
 *
 * PURE — no I/O, no env — so the classification is unit-testable without KV or a
 * live upstream, and so route code can decide whether a write is needed at all
 * before paying for one.
 *
 * Rules:
 *  - only `kind === 'auth'` attempts count (401/403; `kindForStatus` already
 *    normalised the status into that class), so a 429 or 5xx never prompts a
 *    pointless reconnect;
 *  - only vendors that map to a CONNECTABLE provider count — an operator-pool key
 *    failing auth is our problem, not something the tenant can fix from settings;
 *  - a Codex entitlement 403 ({@link CODEX_AUTH_MARKER}) is distinguished from a
 *    plain credential rejection, because the remediation differs;
 *  - deduped per provider, keeping the FIRST occurrence — the cascade walks the
 *    tenant's accounts in precedence order, so the first auth failure is the
 *    highest-precedence account, i.e. the one worth naming.
 */
export function authAlertsFromFailovers(
  failovers: ReadonlyArray<AuthFailoverLike>,
  now: number = Date.now(),
): ProviderAuthAlert[] {
  const byProvider = new Map<LlmProvider, ProviderAuthAlert>();
  for (const f of failovers) {
    if (f.kind !== 'auth') continue;
    const provider = providerForVendor(f.vendor);
    if (!provider || byProvider.has(provider)) continue;
    const notEntitled = (f.detail ?? '').toLowerCase().includes(CODEX_AUTH_MARKER) || f.code === 403;
    byProvider.set(provider, {
      provider,
      reason: notEntitled ? 'not_entitled' : 'rejected',
      status: f.code,
      vendor: f.vendor,
      at: now,
    });
  }
  return [...byProvider.values()];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function alertKey(tenantId: number, provider: LlmProvider): string {
  return `byoauth:${tenantId}:${provider}`;
}

/** Per-isolate fallback for environments without `AUTH_CACHE_KV` (unit tests, local
 *  dev). Values carry their own expiry because a Map has no TTL. */
const memoryAlerts = new Map<string, { alert: ProviderAuthAlert; until: number }>();

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
  await Promise.all(alerts.map(async (alert) => {
    const key = alertKey(tenantId, alert.provider);
    memoryAlerts.set(key, { alert, until: alert.at + ALERT_TTL_SECONDS * 1000 });
    // Drop the read-through entry so the settings page reflects a fresh rejection
    // on its next poll instead of serving a cached "healthy" for up to a minute.
    await invalidateCached(env as unknown as Env, key).catch(() => { /* advisory */ });
    if (!env.AUTH_CACHE_KV) return;
    try {
      await env.AUTH_CACHE_KV.put(key, JSON.stringify(alert), { expirationTtl: ALERT_TTL_SECONDS });
    } catch { /* alerting is advisory — never surface a storage failure */ }
  }));
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
  const key = alertKey(tenantId, provider);
  return getOrSetCached<ProviderAuthAlert | null>(
    env as unknown as Env,
    key,
    async () => {
      if (env.AUTH_CACHE_KV) {
        try {
          const raw = await env.AUTH_CACHE_KV.get(key);
          if (raw) {
            const parsed = JSON.parse(raw) as ProviderAuthAlert;
            if (isSupportedProvider(parsed.provider)) return parsed;
          }
          return null;
        } catch { /* fall through to the in-memory copy */ }
      }
      const local = memoryAlerts.get(key);
      if (!local) return null;
      if (Date.now() >= local.until) { memoryAlerts.delete(key); return null; }
      return local.alert;
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
  const key = alertKey(tenantId, provider);
  memoryAlerts.delete(key);
  await invalidateCached(env as unknown as Env, key).catch(() => { /* advisory */ });
  if (!env.AUTH_CACHE_KV) return;
  try { await env.AUTH_CACHE_KV.delete(key); } catch { /* advisory */ }
}
