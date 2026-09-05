import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * BYO LLM provider keys — a tenant stores its own vendor credential so the
 * gateway can proxy model calls with the tenant's auth and meter usage.
 *
 * Two credential shapes per provider, discriminated by the `auth_type` column
 * (migration 0198):
 *   • api_key — a static key (e.g. `sk-ant-…`); `key_enc` is the encrypted key.
 *   • oauth   — a connected Claude Pro/Max SUBSCRIPTION; `key_enc` is an encrypted
 *               JSON blob `{access, refresh, expires}`. The gateway calls Anthropic
 *               with `Authorization: Bearer` + the oauth beta header instead of
 *               `x-api-key`. POLICY: a subscription token is the tenant's OWN
 *               personal credential — never resold/shared across tenants.
 *
 * Nothing plaintext leaves this module's setters/getters: secrets are encrypted
 * at rest with AES-GCM via the MFA storage helpers. As of the credential-crypto
 * hardening, NEW writes use the versioned v2 scheme — PBKDF2 (100k) with a PER-TENANT
 * salt, keyed off a DEDICATED secret (`CREDENTIAL_ENCRYPTION_SECRET`, falling back to
 * `INTEGRATION_ENCRYPTION_SECRET` then `JWT_SECRET`) rather than reusing `JWT_SECRET`.
 * Per-tenant derivation means one tenant's ciphertext can't be unsealed with another
 * tenant's key; the dedicated secret means a JWT leak no longer decrypts credentials.
 * Rows written under the OLD scheme (single unsalted SHA-256 of `JWT_SECRET`) still
 * decrypt via the helpers' versioned dual-read and upgrade in place on their next write —
 * so `env.JWT_SECRET` is threaded as the `legacySecret` fallback on every read.
 * Backed by the `tenant_llm_provider_keys` table (migrations 0088 + 0198),
 * queried through the Drizzle query builder (`tenantLlmProviderKeys`).
 */

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { tenantLlmProviderKeys, tenantMembers } from '../../infrastructure/database/schema';
import { encryptSecretForStorage, decryptSecretFromStorage } from '../../infrastructure/auth/MfaService';
import { credentialSecret } from '../integrations/credentialCrypto';
import { refreshAnthropicToken, OAUTH_SAFETY_MARGIN_MS, type AnthropicOAuthTokens } from './anthropicOAuth';
import { refreshOpenAICodexToken, type OpenAICodexOAuthTokens } from './openaiCodexOAuth';
import { refreshXaiToken, type XaiOAuthTokens } from './xaiOAuth';
import { refreshKimiOAuth, type KimiOAuthTokens } from './kimiOAuth';
import {
  listOpenRouterConnections,
  resolveOpenRouterConnectionKeys,
  connectionModelRefs,
  type OpenRouterConnection,
} from './openRouterConnectionService';
// The provider catalog (which providers exist, which vendor each dispatches on) lives
// in a LEAF module so `providerAuthAlerts` can share it without closing a cycle back
// through this service — which now imports the alerts to resolve the tenant's
// known-broken accounts. Re-exported so every existing importer of these symbols is
// unchanged and there is still exactly one definition of each.
import {
  SUPPORTED_PROVIDERS,
  PROVIDER_VENDOR_MAP,
  isSupportedProvider,
  byoVendorIdFor,
  type LlmProvider,
  type ProviderAuthType,
} from './llmProviderCatalog';
import { loadAlertedByoVendors } from './providerAuthAlerts';

export {
  SUPPORTED_PROVIDERS,
  PROVIDER_VENDOR_MAP,
  isSupportedProvider,
  byoVendorIdFor,
  type LlmProvider,
  type ProviderAuthType,
};

type Env = HonoEnv['Bindings'];

/** A tenant's resolved BYO API keys keyed by provider (decrypted, api_key mode
 *  only — the Anthropic subscription/OAuth token is resolved separately). Passed
 *  into the LLM proxy so vendorEnv overlays them onto the operator env and marks
 *  the vendor tenant-funded (byo). */
export type TenantVendorKeys = Partial<Record<LlmProvider, string>>;

/** A tenant's resolved Anthropic credential — discriminated by auth type. */
export type AnthropicAuth =
  | { mode: 'api_key'; key: string }
  | { mode: 'oauth'; accessToken: string };

/** One configured provider + how it authenticates (no secrets). */
/**
 * The subset of a stored credential that ROUTING derives from: which provider, how
 * it authenticates, and where the owner ranked it.
 *
 * Segregated from {@link ProviderKeySummary} because the pure derivations
 * (`byoModelsFor`, `byoVendorPriorityOrder`, `byoVendorIdsFromSummaries`) answer
 * "which models/vendors does this connection reach" and have no business knowing a
 * credential's surrogate identity. Keeping them on the narrow type also means a test
 * or a probe can describe a hypothetical connection without inventing a uuid for a
 * row that does not exist.
 */
export interface ProviderRouteSpec {
  provider: LlmProvider;
  authType: ProviderAuthType;
  /** Tenant-set BYO precedence — LOWER = tried FIRST. `null` = unset. */
  priority: number | null;
}

export interface ProviderKeySummary extends ProviderRouteSpec {
  /** Surrogate identity of THIS key instance (0953) — re-minted on every rotation,
   *  so it names the credential that actually paid rather than the slot it sits in.
   *  Stamped onto usage rows as `llm_usage_log.byo_credential_id`. */
  id: string;
}

/** The gateway vendor ids a tenant can serve from their CONFIGURED provider rows —
 *  the catalog/picker view (what they connected), auth-type aware via
 *  {@link byoVendorIdFor}. For the DISPATCH view (what actually resolved this call)
 *  use {@link byoVendorIdsFromCredentials}. */
export function byoVendorIdsFromSummaries(summaries: readonly ProviderRouteSpec[]): Set<string> {
  return new Set(summaries.map((s) => byoVendorIdFor(s.provider, s.authType)));
}

/** Just the resolved-credential fields the BYO vendor-id derivation needs — so the
 *  proxy (which holds the fields, not a credentials object) shares the one helper. */
export interface ResolvedByoCredentials {
  anthropicOAuthToken?: string | null;
  openaiCodexAuth?: { accessToken: string; accountId: string } | null;
  xaiOAuthToken?: string | null;
  vendorKeys?: TenantVendorKeys | null;
}

/**
 * The gateway vendor ids a tenant can serve from their OWN connected account THIS call —
 * an api-key overlay per provider plus each connected subscription on its OAuth vendor.
 *
 * THE single source for: the BYO auto-seed (`byoAutoSeedModels`), the proxy's BYO
 * execution boundary (`LlmProxyService.connectedByoVendors`), the free-plan model-choice
 * gate, and the strict-pin gate — so what the gateway SEEDS can never name a vendor the
 * gateway then FILTERS OUT.
 */
/**
 * THE list of providers that can be connected as a consumer SUBSCRIPTION (OAuth), and how to
 * tell whether that subscription resolved on a given credential set.
 *
 * One list, four readers (`resolvedAuthTypeFor`, `byoVendorIdsFromCredentials`,
 * `providersFromCredentials`, and the `unsupported-auth` classification in
 * {@link resolveTenantLlmCredentials}). Each reader used to re-spell the same three
 * `provider === … && creds.<field>` lines, so wiring a FOURTH OAuth provider meant finding
 * every copy — and the copy that got missed would silently drop that tenant's subscription.
 */
const OAUTH_RESOLVERS: ReadonlyArray<{
  provider: LlmProvider;
  resolved: (creds: ResolvedByoCredentials) => boolean;
}> = [
  { provider: 'anthropic', resolved: (creds) => Boolean(creds.anthropicOAuthToken) },
  { provider: 'openai', resolved: (creds) => Boolean(creds.openaiCodexAuth) },
  { provider: 'xai', resolved: (creds) => Boolean(creds.xaiOAuthToken) },
];

/** Providers a tenant can connect as an OAuth subscription. A row stored `auth_type='oauth'`
 *  for anything else has no resolver and can never produce a credential — see
 *  {@link ByoUnresolvedReason}'s `unsupported-auth`. */
export const OAUTH_CAPABLE_PROVIDERS: ReadonlySet<LlmProvider> = new Set(OAUTH_RESOLVERS.map((r) => r.provider));

/** How a provider authenticates in a RESOLVED credential set — `oauth` when its
 *  subscription token resolved this call, `api_key` otherwise. Pair with
 *  {@link byoVendorIdFor} when you need the dispatch vendor for ONE provider. */
export function resolvedAuthTypeFor(provider: LlmProvider, creds: ResolvedByoCredentials): ProviderAuthType {
  const entry = OAUTH_RESOLVERS.find((r) => r.provider === provider);
  return entry?.resolved(creds) ? 'oauth' : 'api_key';
}

export function byoVendorIdsFromCredentials(creds: ResolvedByoCredentials): Set<string> {
  const set = new Set<string>();
  const keys = creds.vendorKeys ?? {};
  for (const p of Object.keys(keys) as LlmProvider[]) {
    if (keys[p]) set.add(byoVendorIdFor(p, 'api_key'));
  }
  for (const { provider, resolved } of OAUTH_RESOLVERS) {
    if (resolved(creds)) set.add(byoVendorIdFor(provider, 'oauth'));
  }
  return set;
}

/** The connected providers implied by a resolved credential set — the api-keys
 *  present plus every live subscription. */
export function providersFromCredentials(creds: TenantLlmCredentials): LlmProvider[] {
  const set = new Set<LlmProvider>((Object.keys(creds.vendorKeys) as LlmProvider[]).filter((p) => creds.vendorKeys[p]));
  for (const { provider, resolved } of OAUTH_RESOLVERS) {
    if (resolved(creds)) set.add(provider);
  }
  return [...set];
}

/** Store (or replace) a tenant's provider API key, encrypted at rest. */
export async function setTenantProviderKey(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  plaintextKey: string,
  userId: string | null,
): Promise<void> {
  const keyEnc = await encryptSecretForStorage(plaintextKey, credentialSecret(env), { tenantId });
  const db = buildDatabase(env);
  await db
    .insert(tenantLlmProviderKeys)
    .values({ tenantId, provider, keyEnc, authType: 'api_key', createdByUserId: userId })
    .onConflictDoUpdate({
      target: [tenantLlmProviderKeys.tenantId, tenantLlmProviderKeys.provider],
      // A NEW `id` on every write, because this row is upserted IN PLACE: without it a
      // rotated key is indistinguishable from the key it replaced, and last month's
      // spend silently re-attributes to a credential that never incurred it. Minting
      // here retires the old instance — historical usage keeps naming it — and starts
      // a new one. See migration 0953.
      set: { id: sql`gen_random_uuid()`, keyEnc, authType: 'api_key', updatedAt: sql`NOW()` },
    });
}

/** Store (or replace) a tenant's OAuth subscription tokens, encrypted at rest. */
/**
 * What any subscription connect stores. Named because the connect flow, the
 * storage call and the resolvers all need to agree on it, and an inline union
 * repeated at three call sites is how a fourth provider gets forgotten at one.
 */
export type SubscriptionOAuthTokens = AnthropicOAuthTokens | OpenAICodexOAuthTokens | XaiOAuthTokens | KimiOAuthTokens;

export async function setTenantProviderOAuth(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  tokens: SubscriptionOAuthTokens,
  userId: string | null,
): Promise<void> {
  const keyEnc = await encryptSecretForStorage(JSON.stringify(tokens), credentialSecret(env), { tenantId });
  const db = buildDatabase(env);
  await db
    .insert(tenantLlmProviderKeys)
    .values({ tenantId, provider, keyEnc, authType: 'oauth', createdByUserId: userId })
    .onConflictDoUpdate({
      target: [tenantLlmProviderKeys.tenantId, tenantLlmProviderKeys.provider],
      // Same instance-identity rule as the api-key setter above: reconnecting an
      // account replaces the credential, so it is a new instance (0953).
      set: { id: sql`gen_random_uuid()`, keyEnc, authType: 'oauth', updatedAt: sql`NOW()` },
    });
}

export interface OpenAICodexResolution {
  auth: { accessToken: string; accountId: string } | null;
  reason?: ByoUnresolvedReason;
}

/** Resolve and rotate a tenant's ChatGPT/Codex subscription credential. */
export async function resolveOpenAICodexResolution(env: Env, tenantId: number): Promise<OpenAICodexResolution> {
  const row = await loadProviderRow(env, tenantId, 'openai');
  if (row?.lookup_failed) return { auth: null, reason: 'lookup_failed' };
  if (!row?.key_enc || (row.auth_type ?? 'api_key') !== 'oauth') return { auth: null };
  let tokens: OpenAICodexOAuthTokens;
  try {
    tokens = JSON.parse(await decryptSecretFromStorage(row.key_enc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET })) as OpenAICodexOAuthTokens;
  } catch { return { auth: null, reason: 'undecryptable' }; }
  if (!tokens.access || !tokens.refresh || !tokens.accountId) return { auth: null, reason: 'undecryptable' };
  if (Date.now() < tokens.expires) return { auth: { accessToken: tokens.access, accountId: tokens.accountId } };
  try {
    const refreshed = await refreshOpenAICodexToken(tokens.refresh);
    await setTenantProviderOAuth(env, tenantId, 'openai', refreshed, null);
    return { auth: { accessToken: refreshed.access, accountId: refreshed.accountId } };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return { auth: null, reason: 'revoked' };
    if (Date.now() < tokens.expires + OAUTH_SAFETY_MARGIN_MS) return { auth: { accessToken: tokens.access, accountId: tokens.accountId } };
    return { auth: null, reason: 'expired' };
  }
}

export interface XaiOAuthResolution { token: string | null; reason?: ByoUnresolvedReason }

export async function resolveXaiOAuthResolution(env: Env, tenantId: number): Promise<XaiOAuthResolution> {
  const row = await loadProviderRow(env, tenantId, 'xai');
  if (row?.lookup_failed) return { token: null, reason: 'lookup_failed' };
  if (!row?.key_enc || (row.auth_type ?? 'api_key') !== 'oauth') return { token: null };
  let tokens: XaiOAuthTokens;
  try { tokens = JSON.parse(await decryptSecretFromStorage(row.key_enc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET })) as XaiOAuthTokens; }
  catch { return { token: null, reason: 'undecryptable' }; }
  if (!tokens.access || !tokens.refresh) return { token: null, reason: 'undecryptable' };
  if (Date.now() < tokens.expires) return { token: tokens.access };
  try {
    const refreshed = await refreshXaiToken(tokens.refresh);
    await setTenantProviderOAuth(env, tenantId, 'xai', refreshed, null);
    return { token: refreshed.access };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) return { token: null, reason: 'revoked' };
    if (Date.now() < tokens.expires + OAUTH_SAFETY_MARGIN_MS) return { token: tokens.access };
    return { token: null, reason: 'expired' };
  }
}

export interface KimiOAuthResolution { token: string | null; reason?: ByoUnresolvedReason }

/**
 * Resolve and rotate a tenant's Kimi Code subscription credential.
 *
 * Deliberately the same shape as {@link resolveXaiOAuthResolution}, with one difference
 * that matters downstream: the resolved token is delivered as the `kimi` VENDOR KEY
 * rather than threaded as its own field. Kimi's access token is an ordinary Bearer for
 * the same `kimi-code` endpoint an API key would have used, so dispatch, the local-egress
 * relay and the credential probe all keep working with no new wiring — an OAuth Kimi and
 * an api-key Kimi are indistinguishable by the time they reach a vendor.
 *
 * Refresh is not an edge case here. Kimi's access tokens live FIFTEEN minutes, so this
 * rotates on nearly every resolution, and the rotated refresh token must be stored or the
 * next call presents one the server has already retired.
 */
export async function resolveKimiOAuthResolution(env: Env, tenantId: number): Promise<KimiOAuthResolution> {
  const row = await loadProviderRow(env, tenantId, 'kimi');
  if (row?.lookup_failed) return { token: null, reason: 'lookup_failed' };
  if (!row?.key_enc || (row.auth_type ?? 'api_key') !== 'oauth') return { token: null };
  let tokens: KimiOAuthTokens;
  try { tokens = JSON.parse(await decryptSecretFromStorage(row.key_enc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET })) as KimiOAuthTokens; }
  catch { return { token: null, reason: 'undecryptable' }; }
  if (!tokens.access || !tokens.refresh) return { token: null, reason: 'undecryptable' };
  if (Date.now() < tokens.expires) return { token: tokens.access };
  try {
    const refreshed = await refreshKimiOAuth(tokens.refresh);
    await setTenantProviderOAuth(env, tenantId, 'kimi', refreshed, null);
    return { token: refreshed.access };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) return { token: null, reason: 'revoked' };
    // A refresh that failed for a transient reason must not disconnect a working account:
    // inside the safety margin the existing token is still worth trying.
    if (Date.now() < tokens.expires + OAUTH_SAFETY_MARGIN_MS) return { token: tokens.access };
    return { token: null, reason: 'expired' };
  }
}

interface ProviderKeyRow {
  key_enc?: string;
  auth_type?: string;
  lookup_failed?: boolean;
}

async function loadProviderRow(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
): Promise<ProviderKeyRow | null> {
  // Defensive: a BYO-credential lookup is an ENRICHMENT on the hot completion path
  // — a transient DB error (or an env without NEON bound) must degrade to "no BYO
  // credential" (the cascade keeps its operator-key floor), never 500 the request.
  try {
    const db = buildDatabase(env);
    const rows = await db
      .select({ keyEnc: tenantLlmProviderKeys.keyEnc, authType: tenantLlmProviderKeys.authType })
      .from(tenantLlmProviderKeys)
      .where(and(
        eq(tenantLlmProviderKeys.tenantId, tenantId),
        eq(tenantLlmProviderKeys.provider, provider),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // Drizzle hands back camelCase; the callers below read the snake_case column
    // names this row shape has always exposed — map back rather than rename them.
    return { key_enc: row.keyEnc ?? undefined, auth_type: row.authType ?? undefined };
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/tenantProviderKeyService.ts', operation: 'loadProviderRow', context: { tenantId, provider } });
    return { lookup_failed: true };
  }
}

/**
 * Why a CONNECTED provider (a stored credential row exists) could NOT be resolved to a
 * usable credential this call — surfaced so a "should have used my own account" run is
 * actionable, not a silent shared-pool degrade:
 *   • `revoked`         — the OAuth refresh returned 401/403; the token is dead → reconnect.
 *   • `expired`         — past real expiry and the refresh failed transiently (retryable).
 *   • `undecryptable`   — the stored blob won't decrypt/parse (key rotation / corruption).
 *   • `unsupported-auth`— the row is stored `auth_type='oauth'` for a provider that has no
 *                         OAuth resolver ({@link OAUTH_CAPABLE_PROVIDERS}), so it can never
 *                         resolve however intact the blob is → re-enter it as an API key.
 *                         Distinct from `undecryptable` on purpose: that one sends the owner
 *                         to re-save a credential that was never the problem.
 *   • `other-workspace` — NOT connected in THIS tenant, but the SAME user has it connected
 *                         under a DIFFERENT workspace they belong to (a tenant mismatch —
 *                         they connected it somewhere else). Detected separately, per-user.
 */
export type ByoUnresolvedReason = 'revoked' | 'expired' | 'undecryptable' | 'unsupported-auth' | 'other-workspace' | 'lookup_failed';

/** Result of resolving a tenant's Anthropic credential: the usable auth (or null) plus,
 *  when a credential ROW exists but couldn't be used, WHY. `reason` is undefined both when
 *  it resolved fine and when nothing is connected (no row) — only set on a real failure. */
export interface AnthropicResolution {
  auth: AnthropicAuth | null;
  reason?: ByoUnresolvedReason;
}

/**
 * Resolve a tenant's Anthropic credential to a ready-to-use auth, refreshing and
 * re-persisting the OAuth subscription token when it has expired — AND reporting a
 * {@link ByoUnresolvedReason} when a stored credential can't be used. Hardening: a
 * transient refresh failure (5xx/429/network) does NOT force the tenant off their own
 * account while the access token is still within its REAL validity (the stored `expires`
 * already subtracted {@link OAUTH_SAFETY_MARGIN_MS}); we reuse the existing access token
 * and only give up (reason `revoked`/`expired`) once it's genuinely past expiry.
 */
export async function resolveAnthropicResolution(
  env: Env,
  tenantId: number,
): Promise<AnthropicResolution> {
  const row = await loadProviderRow(env, tenantId, 'anthropic');
  if (row?.lookup_failed) return { auth: null, reason: 'lookup_failed' };
  if (!row?.key_enc) return { auth: null }; // nothing connected — not a failure
  const authType = (row.auth_type ?? 'api_key') as ProviderAuthType;

  let decrypted: string;
  try {
    decrypted = await decryptSecretFromStorage(row.key_enc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET });
  } catch {
    return { auth: null, reason: 'undecryptable' };
  }

  if (authType === 'api_key') {
    return { auth: { mode: 'api_key', key: decrypted } };
  }

  // OAuth subscription: decode, refresh if expired, persist the rotated tokens.
  let tokens: AnthropicOAuthTokens;
  try {
    tokens = JSON.parse(decrypted) as AnthropicOAuthTokens;
  } catch {
    return { auth: null, reason: 'undecryptable' };
  }
  if (!tokens.access || !tokens.refresh) return { auth: null, reason: 'undecryptable' };

  if (Date.now() < tokens.expires) {
    return { auth: { mode: 'oauth', accessToken: tokens.access } };
  }

  try {
    const refreshed = await refreshAnthropicToken(tokens.refresh);
    await setTenantProviderOAuth(env, tenantId, 'anthropic', refreshed, null);
    return { auth: { mode: 'oauth', accessToken: refreshed.access } };
  } catch (e) {
    const status = (e as { status?: number } | undefined)?.status;
    // A revoked/expired refresh token (401/403) is terminal — reconnect required.
    if (status === 401 || status === 403) return { auth: null, reason: 'revoked' };
    // Transient refresh failure (5xx/429/network): if the access token is still within
    // its REAL validity window, keep using it rather than degrading to the shared pool.
    if (Date.now() < tokens.expires + OAUTH_SAFETY_MARGIN_MS) {
      return { auth: { mode: 'oauth', accessToken: tokens.access } };
    }
    return { auth: null, reason: 'expired' };
  }
}

/**
 * Resolve a tenant's Anthropic credential to a ready-to-use auth (or null). Thin
 * projection of {@link resolveAnthropicResolution} kept for call sites that only need
 * the auth (e.g. the /v1/messages direct-Claude branch).
 */
export async function resolveAnthropicAuth(
  env: Env,
  tenantId: number,
): Promise<AnthropicAuth | null> {
  return (await resolveAnthropicResolution(env, tenantId)).auth;
}

/**
 * Resolve a tenant's Claude SUBSCRIPTION access token for the gateway cascade,
 * refreshing if expired. Returns null when the tenant has no Anthropic credential
 * OR it's an API key (the cascade keeps its operator-key floor for that case).
 * Thin wrapper over {@link resolveAnthropicAuth} so the proxy call sites share one
 * "give me a subscription token or nothing" entry point.
 */
export async function resolveAnthropicOAuthToken(env: Env, tenantId: number): Promise<string | null> {
  const auth = await resolveAnthropicAuth(env, tenantId);
  return auth?.mode === 'oauth' ? auth.accessToken : null;
}

/**
 * Resolve ALL of a tenant's BYO api-key credentials in ONE query — decrypted and
 * keyed by provider — for the LLM proxy's vendorEnv overlay. Only `api_key`-mode
 * rows are returned; the Anthropic subscription (oauth) is threaded separately as
 * the OAuth token. Best-effort: a DB/decrypt error degrades to "no BYO keys" (the
 * cascade keeps its operator-key floor), never throws on the hot completion path.
 *
 * Secrets are decrypted per call (cheap AES-GCM) and never cached to KV — the one
 * PK-indexed read here replaces what would otherwise be a per-provider fan-out.
 */
export async function resolveTenantVendorKeys(env: Env, tenantId: number): Promise<TenantVendorKeys> {
  let rows: Array<{ provider?: string; key_enc?: string; auth_type?: string }> = [];
  try {
    const db = buildDatabase(env);
    const selected = await db
      .select({
        provider: tenantLlmProviderKeys.provider,
        keyEnc: tenantLlmProviderKeys.keyEnc,
        authType: tenantLlmProviderKeys.authType,
      })
      .from(tenantLlmProviderKeys)
      .where(eq(tenantLlmProviderKeys.tenantId, tenantId));
    // Keep the snake_case row shape the loop below has always read.
    rows = selected.map((r) => ({
      provider: r.provider ?? undefined,
      key_enc: r.keyEnc ?? undefined,
      auth_type: r.authType ?? undefined,
    }));
  } catch {
    return {};
  }
  const out: TenantVendorKeys = {};
  for (const row of rows) {
    if (!row.provider || !isSupportedProvider(row.provider)) continue;
    if ((row.auth_type ?? 'api_key') !== 'api_key' || !row.key_enc) continue;
    try {
      out[row.provider] = await decryptSecretFromStorage(row.key_enc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET });
    } catch (error) { /* skip an undecryptable row — never fail the batch */ 
      reportCaughtError(error, { source: "application/llm/tenantProviderKeyService.ts", operation: "resolveTenantVendorKeys" });
    }
  }
  return out;
}

/** A tenant's full LLM credential set, resolved together for the completion path:
 *  the Anthropic subscription token (OAuth, auto-refreshed) AND the BYO api-keys
 *  (OpenAI/Google/Anthropic). */
export interface TenantLlmCredentials {
  anthropicOAuthToken: string | null;
  openaiCodexAuth?: { accessToken: string; accountId: string } | null;
  xaiOAuthToken?: string | null;
  vendorKeys: TenantVendorKeys;
  /** Every provider the tenant has a stored credential ROW for — regardless of whether
   *  it could be RESOLVED this call. A provider that is `configured` but absent from the
   *  resolved token/keys is "connected but unusable" (expired subscription whose refresh
   *  failed, an undecryptable key, or a credential stored under a different tenant) — the
   *  gateway surfaces that so a BYO turn that degraded to the shared pool is never SILENT.
   *  See {@link providersFromCredentials} for the resolved (usable) set. */
  configuredProviders: LlmProvider[];
  /** For each CONFIGURED-but-UNRESOLVED provider, WHY it couldn't be used this call
   *  ({@link ByoUnresolvedReason}) — so the gateway can surface an actionable message
   *  ("token revoked — reconnect" vs "transient — retry") instead of a bare provider id.
   *  Only populated for a provider that has a row but produced no usable credential. */
  unresolvedReasons: Partial<Record<LlmProvider, ByoUnresolvedReason>>;
  /** Tenant-set BYO precedence as ordered gateway vendor ids (most-preferred first) —
   *  the order the auto-select cloud pin leads its connected flagships by (empty when
   *  no precedence is set → catalog-tier ordering). See {@link byoVendorPriorityOrder}. */
  vendorPriority: string[];
  /** Gateway vendor ids whose underlying tenant account is currently KNOWN-BROKEN —
   *  a 401/403/out-of-budget recorded by {@link providerAuthAlerts} for THIS tenant.
   *  Threaded into routing's `demotedVendors` so a rejected account stops LEADING the
   *  BYO seed: without it a workspace with two connected providers burns an upstream
   *  attempt on the dead one on every single request until the owner notices.
   *  DEMOTED, never removed — a `capacity` alert self-heals when the billing period
   *  rolls over, and removal would silently change the funding source to our pool.
   *  Absent/empty for the overwhelming majority of tenants — optional for the same
   *  reason `providerPriorities` is: it is an advisory ROUTING ORDER hint, so a
   *  hand-built credentials object in a test or a degraded path that omits it must
   *  keep working (it just doesn't demote), never fail to compile. */
  alertedVendors?: string[];
  /** Provider ranks with their original shared integer positions preserved, so
   * OpenRouter connections can interleave with them in one routing seed. */
  providerPriorities?: Array<{ vendor: string; priority: number | null }>;
  /** The tenant's OpenRouter CONNECTIONS (0382), most-preferred first — named model sets
   *  routed through our gateway. Distinct from the provider rows above because a connection
   *  contributes an OPERATOR-CHOSEN list of ids, not one implicit frontier flagship. Empty
   *  for the overwhelming majority of tenants, and cached, so this costs nothing to carry.
   *  See {@link openRouterConnectionService}. */
  openRouterConnections?: OpenRouterConnection[];
  /** Bare OpenRouter model id → the tenant's OWN OpenRouter key, for connections that bound
   *  one. Threaded to the vendor so it resolves a PER-MODEL key: two connections may carry
   *  two different OpenRouter accounts, and a single request-wide key would bill the wrong
   *  one. Empty when no connection is keyed (then everything rides the operator key). */
  openRouterModelKeys?: Record<string, string>;
  /** All registered OpenRouter refs, used to validate explicit cloud pins. */
  registeredOpenRouterModels?: string[];
  /** Registered model that currently leads the shared provider/connection rank. */
  preferredOpenRouterModel?: string;
}

/**
 * Resolve the Anthropic subscription token, the BYO api-keys, AND the set of
 * configured providers in ONE round-trip (the reads run in parallel). The single
 * entry point for the gateway + cloud completion paths so they don't each duplicate
 * the lookups. Credential decoding is best-effort, while failure to read the
 * authoritative configured-provider list is fatal: silently treating a DB outage as
 * "no BYO account" would spend from the operator pool without telling the tenant.
 * Each configured-but-unresolved provider still shows up in `configuredProviders` (with a
 * configured-but-unresolved provider still shows up in `configuredProviders` (with a
 * WHY in `unresolvedReasons`) so the degrade to the shared pool is never silent.
 */
export async function resolveTenantLlmCredentials(env: Env, tenantId: number): Promise<TenantLlmCredentials> {
  const [anthropicRes, openaiRes, xaiRes, kimiRes, vendorKeys, configured, openRouterConnections] = await Promise.all([
    resolveAnthropicResolution(env, tenantId).catch(() => ({ auth: null }) as AnthropicResolution),
    resolveOpenAICodexResolution(env, tenantId).catch(() => ({ auth: null }) as OpenAICodexResolution),
    resolveXaiOAuthResolution(env, tenantId).catch(() => ({ token: null }) as XaiOAuthResolution),
    resolveKimiOAuthResolution(env, tenantId).catch(() => ({ token: null }) as KimiOAuthResolution),
    resolveTenantVendorKeys(env, tenantId),
    listTenantProviderKeys(env, tenantId),
    listOpenRouterConnections(env, tenantId).catch(() => [] as OpenRouterConnection[]),
  ]);
  // A connected Kimi SUBSCRIPTION becomes the `kimi` vendor key. Kimi's OAuth access
  // token is a plain Bearer against the same endpoint an api key would have used, so
  // delivering it here — rather than as another threaded field — is what lets every
  // downstream consumer (dispatch, the local-egress relay, the health probe) treat the
  // two connection styles identically. `resolveTenantVendorKeys` only reads api-key rows,
  // so there is nothing to overwrite: a tenant has one or the other, never both.
  if (kimiRes.token) vendorKeys.kimi = kimiRes.token;
  // Decrypt the connections' OWN OpenRouter keys only when the (cached) metadata says at least
  // one exists — a tenant with no keyed connection never pays for that read, and neither does
  // one with no connections at all.
  const openRouterModelKeys = openRouterConnections.some((c) => c.hasKey)
    ? await resolveOpenRouterConnectionKeys(env, tenantId).catch(() => ({}))
    : {};
  const anthropicOAuthToken = anthropicRes.auth?.mode === 'oauth' ? anthropicRes.auth.accessToken : null;
  const creds: TenantLlmCredentials = {
    openRouterConnections,
    openRouterModelKeys,
    anthropicOAuthToken,
    openaiCodexAuth: openaiRes.auth,
    xaiOAuthToken: xaiRes.token,
    vendorKeys,
    // `configured` is already ordered by tenant-set precedence (listTenantProviderKeys),
    // so both the provider list and the vendor-priority order read straight off it.
    configuredProviders: configured.map((p) => p.provider),
    unresolvedReasons: {},
    vendorPriority: byoVendorPriorityOrder(configured),
    // Filled in below — the alert read needs the vendor ids this object derives.
    alertedVendors: [],
    providerPriorities: configured.map((p) => ({
      vendor: byoVendorIdFor(p.provider, p.authType),
      priority: p.priority,
    })),
  };
  // Attach a reason to each configured-but-unusable provider: Anthropic gets the precise
  // reason from its resolver; an api-key provider that's configured but decrypted to
  // nothing is `undecryptable` (the only api-key failure mode `resolveTenantVendorKeys`
  // can hit). Computed against the resolved (usable) set so a working provider is skipped.
  const usable = new Set(providersFromCredentials(creds));
  creds.registeredOpenRouterModels = connectionModelRefs(openRouterConnections);
  // Which of the tenant's OWN vendors are known-broken right now. Resolved HERE, where
  // `tenantId` is already in scope and every consumer of `vendorPriority` picks it up
  // for free, rather than at each of the five seams that thread routing options — the
  // cycle that used to block this is gone (the provider catalog is a leaf now).
  // Degrades to "none alerted": failing to read a warning must never demote a working
  // account, which would be a worse failure than the one this prevents.
  creds.alertedVendors = [
    ...await loadAlertedByoVendors(env, tenantId, byoVendorIdsFromSummaries(configured))
      .catch(() => new Set<string>()),
  ];
  const usableProviderRanks = configured
    .filter((p) => usable.has(p.provider))
    .map((p) => p.priority ?? Number.POSITIVE_INFINITY);
  const leadingConnection = openRouterConnections[0];
  const connectionRank = leadingConnection?.priority ?? Number.POSITIVE_INFINITY;
  const providerRank = usableProviderRanks.length
    ? Math.min(...usableProviderRanks)
    : Number.POSITIVE_INFINITY;
  if (leadingConnection && (usableProviderRanks.length === 0 || connectionRank < providerRank)) {
    creds.preferredOpenRouterModel = connectionModelRefs([leadingConnection])[0];
  }
  const storedAuthTypes = new Map(configured.map((p) => [p.provider, p.authType]));
  for (const p of creds.configuredProviders) {
    if (usable.has(p)) continue;
    // A row stored as a SUBSCRIPTION for a provider with no OAuth resolver is skipped by
    // `resolveTenantVendorKeys` (api-key rows only) and has no resolver to report a reason,
    // so the old catch-all blamed the ciphertext. It reads fine — the auth TYPE is wrong.
    if (storedAuthTypes.get(p) === 'oauth' && !OAUTH_CAPABLE_PROVIDERS.has(p)) {
      creds.unresolvedReasons[p] = 'unsupported-auth';
      continue;
    }
    creds.unresolvedReasons[p] = p === 'anthropic'
      ? (anthropicRes.reason ?? 'undecryptable')
      : p === 'openai' ? (openaiRes.reason ?? 'undecryptable')
      : p === 'xai' ? (xaiRes.reason ?? 'undecryptable') : 'undecryptable';
  }
  return creds;
}

/** The connected providers a tenant has CONFIGURED but that could NOT be resolved to a
 *  usable credential this call (expired/revoked/undecryptable) — the difference between
 *  what they connected and what actually served. Empty when every configured provider
 *  resolved (or none is configured). */
export function unresolvedProviders(creds: TenantLlmCredentials): LlmProvider[] {
  const usable = new Set(providersFromCredentials(creds));
  return creds.configuredProviders.filter((p) => !usable.has(p));
}

/**
 * The `x-builderforce-byo-unresolved` header value: each unresolved provider as
 * `provider:reason` (e.g. `anthropic:revoked`), comma-separated. Merges any
 * cross-workspace hits (a provider the SAME user connected under a DIFFERENT tenant —
 * reason `other-workspace`) the caller resolved separately. Empty string when nothing
 * is unresolved. The SINGLE encoder both the gateway and its clients agree on.
 */
export function formatByoUnresolvedHeader(
  creds: TenantLlmCredentials,
  otherWorkspace: LlmProvider[] = [],
): string {
  const parts = new Map<string, ByoUnresolvedReason>();
  for (const p of unresolvedProviders(creds)) parts.set(p, creds.unresolvedReasons[p] ?? 'undecryptable');
  // A provider connected in ANOTHER workspace isn't configured here, so it isn't in
  // `unresolvedProviders`; add it (don't overwrite a same-tenant reason if both apply).
  for (const p of otherWorkspace) if (!parts.has(p)) parts.set(p, 'other-workspace');
  return [...parts].map(([p, reason]) => `${p}:${reason}`).join(',');
}

/**
 * Cross-workspace detection: of `providers`, which does the SAME user have connected
 * under a DIFFERENT active tenant than `tenantId`? This is the "you connected Claude in
 * another workspace" case — a BYO credential is tenant-scoped (never shared), so a run in
 * the wrong workspace silently falls back. Returns the subset connected elsewhere.
 *
 * ONE indexed query over the user's OTHER active tenant memberships (bounded, PK/idx
 * joins). Callers gate it to the rare case (this tenant has NO usable credential) so it
 * never runs on the common connected path, and cache the result per user.
 */
export async function providersConnectedInOtherWorkspaces(
  env: Env,
  userId: string,
  tenantId: number,
  providers: readonly LlmProvider[],
): Promise<LlmProvider[]> {
  if (!userId || providers.length === 0) return [];
  try {
    const db = buildDatabase(env);
    const rows = await db
      .selectDistinct({ provider: tenantLlmProviderKeys.provider })
      .from(tenantLlmProviderKeys)
      .innerJoin(tenantMembers, eq(tenantMembers.tenantId, tenantLlmProviderKeys.tenantId))
      .where(and(
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.isActive, true),
        ne(tenantLlmProviderKeys.tenantId, tenantId),
        inArray(tenantLlmProviderKeys.provider, providers as readonly string[] as string[]),
      ));
    return rows.map((r) => r.provider).filter(isSupportedProvider);
  } catch {
    return [];
  }
}

/** List which providers a tenant has configured + how each authenticates (no secrets).
 *  Ordered by tenant-set BYO precedence (`priority` ascending; unset rows last), then
 *  provider id — so the caller can read the precedence straight off the array order. */
export async function listTenantProviderKeys(
  env: Env,
  tenantId: number,
): Promise<ProviderKeySummary[]> {
  const db = buildDatabase(env);
  const selected = await db
    .select({
      id: tenantLlmProviderKeys.id,
      provider: tenantLlmProviderKeys.provider,
      authType: tenantLlmProviderKeys.authType,
      priority: tenantLlmProviderKeys.priority,
    })
    .from(tenantLlmProviderKeys)
    .where(eq(tenantLlmProviderKeys.tenantId, tenantId))
    // `priority` NULL = unset and MUST sort last (a set precedence always wins).
    .orderBy(sql`${tenantLlmProviderKeys.priority} ASC NULLS LAST`, asc(tenantLlmProviderKeys.provider));
  const rows: Array<{ id: string; provider: string; auth_type?: string; priority?: number | null }> = selected.map((r) => ({
    id: r.id,
    provider: r.provider,
    auth_type: r.authType ?? undefined,
    priority: r.priority,
  }));
  return rows
    .filter((r) => isSupportedProvider(r.provider))
    .map((r) => ({
      id: r.id,
      provider: r.provider as LlmProvider,
      authType: ((r.auth_type ?? 'api_key') === 'oauth' ? 'oauth' : 'api_key') as ProviderAuthType,
      priority: typeof r.priority === 'number' ? r.priority : null,
    }));
}

/**
 * Stamp the provider half of the tenant's BYO PRECEDENCE.
 *
 * `ranks` maps a provider to its position in the shared precedence integer space (LOWER =
 * tried first) or to `null` for "unset → catalog-tier fallback". Every provider absent from
 * the map is left ALONE, because the ranks it must not disturb belong to the OTHER table in
 * the same space (`tenant_openrouter_connections`). The caller that owns the whole ordering —
 * {@link byoPrecedence.setByoPrecedence} — always passes an entry for every connected
 * provider, so "absent" never means "silently retains a stale rank" in practice.
 *
 * Only rows that already exist (a connected provider) are updated; ordering an un-connected
 * provider is a no-op.
 *
 * ONE statement, not one UPDATE per provider: neon-http has no interactive transaction, so a
 * per-provider loop that failed midway left the precedence HALF-APPLIED — two providers
 * sharing a rank, or a tenant's #1 stamped while the rest kept the old order. A single
 * `CASE` update either lands entirely or not at all, and the drag-to-reorder UI issues one
 * of these on every drop.
 */
export async function setTenantProviderPriorityRanks(
  env: Env,
  tenantId: number,
  ranks: ReadonlyMap<LlmProvider, number | null>,
): Promise<void> {
  const entries = [...ranks].filter(([provider]) => isSupportedProvider(provider));
  if (entries.length === 0) return;
  const db = buildDatabase(env);
  // `::int` on each arm so a NULL rank ("unset → catalog-tier fallback") doesn't leave
  // Postgres inferring the CASE result type from an untyped parameter.
  const cases = sql.join(
    entries.map(([provider, priority]) => sql`WHEN ${provider} THEN ${priority}::int`),
    sql` `,
  );
  await db
    .update(tenantLlmProviderKeys)
    .set({
      priority: sql`CASE ${tenantLlmProviderKeys.provider} ${cases} ELSE ${tenantLlmProviderKeys.priority} END`,
      updatedAt: sql`NOW()`,
    })
    .where(and(
      eq(tenantLlmProviderKeys.tenantId, tenantId),
      inArray(tenantLlmProviderKeys.provider, entries.map(([provider]) => provider)),
    ));
}

/**
 * The tenant's connected providers as ordered GATEWAY VENDOR IDS (most-preferred
 * first) — the precedence {@link byoAutoSeedModels} sorts its flagship seeds by.
 * Only providers with a set `priority` are included (unset providers fall back to
 * catalog-tier ordering inside the seed). Maps each provider → its DISPATCH vendor id
 * via {@link byoVendorIdFor} ('google' → 'googleai', an OAuth xAI → 'xai-oauth') so the
 * ids line up with `vendorForModel(flagship)` — otherwise the tenant's chosen order
 * silently ranks every subscription-connected provider last.
 */
export function byoVendorPriorityOrder(summaries: readonly ProviderRouteSpec[]): string[] {
  return summaries
    .filter((s) => s.priority !== null)
    .map((s) => byoVendorIdFor(s.provider, s.authType));
}

/** Remove a tenant's provider credential (API key or OAuth subscription). */
export async function deleteTenantProviderKey(env: Env, tenantId: number, provider: LlmProvider): Promise<void> {
  const db = buildDatabase(env);
  await db
    .delete(tenantLlmProviderKeys)
    .where(and(
      eq(tenantLlmProviderKeys.tenantId, tenantId),
      eq(tenantLlmProviderKeys.provider, provider),
    ));
}
