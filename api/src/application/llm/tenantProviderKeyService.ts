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
import {
  listOpenRouterConnections,
  resolveOpenRouterConnectionKeys,
  connectionModelRefs,
  type OpenRouterConnection,
} from './openRouterConnectionService';

type Env = HonoEnv['Bindings'];

export type LlmProvider = 'anthropic' | 'openai' | 'google' | 'meta' | 'kimi' | 'qwen' | 'minimax' | 'xai';
export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = ['anthropic', 'openai', 'google', 'meta', 'kimi', 'qwen', 'minimax', 'xai'];

export type ProviderAuthType = 'api_key' | 'oauth';

/** A BYO provider → the gateway vendor id + operator env-var name its tenant key
 *  overrides. `oauth` marks the provider that ALSO supports a connected
 *  subscription (Anthropic today) — the OAuth path is resolved separately via
 *  {@link resolveAnthropicOAuthToken}, so it isn't part of the api-key overlay. */
export const PROVIDER_VENDOR_MAP: Record<LlmProvider, { vendorId: string; envKey: 'CLAUDE_API_KEY' | 'OPENAI_API_KEY' | 'GOOGLE_API_KEY' | 'META_API_KEY' | 'MOONSHOT_API_KEY' | 'QWEN_API_KEY' | 'MINIMAX_API_KEY' | 'XAI_API_KEY'; oauth: boolean }> = {
  anthropic: { vendorId: 'anthropic', envKey: 'CLAUDE_API_KEY', oauth: true },
  openai:    { vendorId: 'openai',    envKey: 'OPENAI_API_KEY', oauth: true },
  google:    { vendorId: 'googleai',  envKey: 'GOOGLE_API_KEY', oauth: false },
  meta:      { vendorId: 'meta',      envKey: 'META_API_KEY',   oauth: false },
  kimi:      { vendorId: 'moonshot',  envKey: 'MOONSHOT_API_KEY', oauth: false },
  qwen:      { vendorId: 'qwen',      envKey: 'QWEN_API_KEY', oauth: false },
  minimax:   { vendorId: 'minimax',   envKey: 'MINIMAX_API_KEY', oauth: false },
  xai:       { vendorId: 'xai',       envKey: 'XAI_API_KEY', oauth: true },
};

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
export interface ProviderKeySummary {
  provider: LlmProvider;
  authType: ProviderAuthType;
  /** Tenant-set BYO precedence — LOWER = tried FIRST by the auto-select cloud pin.
   *  `null` = unset → the provider falls back to catalog-tier ordering. */
  priority: number | null;
}

export function isSupportedProvider(p: string): p is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

/**
 * The gateway vendor a connected provider actually DISPATCHES on — which depends on
 * HOW it authenticates, not just which provider it is.
 *
 * A connected SUBSCRIPTION (OAuth) rides its own vendor because the transport differs
 * from the api-key one: ChatGPT/Codex → `openai-codex`, SuperGrok → `xai-oauth`. Only
 * Anthropic shares one vendor across both modes (the `anthropic` vendor prefers the
 * OAuth token when bound). Mapping an OAuth provider to its api-key vendor id
 * (`openai` / `xai`) yields a vendor the tenant has NO credential for: the seed picks a
 * `direct/<vendor>/…` flagship that can't dispatch, the tenant's BYO precedence stops
 * matching (`vendorForModel` returns the oauth id), and the proxy's BYO boundary filter
 * drops it — the "connected accounts were never tried" failure. THE single mapping;
 * derive every vendor-id set from it.
 */
export function byoVendorIdFor(provider: LlmProvider, authType: ProviderAuthType): string {
  if (authType === 'oauth') {
    if (provider === 'openai') return 'openai-codex';
    if (provider === 'xai') return 'xai-oauth';
  }
  return PROVIDER_VENDOR_MAP[provider].vendorId;
}

/** The gateway vendor ids a tenant can serve from their CONFIGURED provider rows —
 *  the catalog/picker view (what they connected), auth-type aware via
 *  {@link byoVendorIdFor}. For the DISPATCH view (what actually resolved this call)
 *  use {@link byoVendorIdsFromCredentials}. */
export function byoVendorIdsFromSummaries(summaries: readonly ProviderKeySummary[]): Set<string> {
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
/** How a provider authenticates in a RESOLVED credential set — `oauth` when its
 *  subscription token resolved this call, `api_key` otherwise. Pair with
 *  {@link byoVendorIdFor} when you need the dispatch vendor for ONE provider. */
export function resolvedAuthTypeFor(provider: LlmProvider, creds: ResolvedByoCredentials): ProviderAuthType {
  if (provider === 'anthropic' && creds.anthropicOAuthToken) return 'oauth';
  if (provider === 'openai' && creds.openaiCodexAuth) return 'oauth';
  if (provider === 'xai' && creds.xaiOAuthToken) return 'oauth';
  return 'api_key';
}

export function byoVendorIdsFromCredentials(creds: ResolvedByoCredentials): Set<string> {
  const set = new Set<string>();
  const keys = creds.vendorKeys ?? {};
  for (const p of Object.keys(keys) as LlmProvider[]) {
    if (keys[p]) set.add(byoVendorIdFor(p, 'api_key'));
  }
  if (creds.anthropicOAuthToken) set.add(byoVendorIdFor('anthropic', 'oauth'));
  if (creds.openaiCodexAuth) set.add(byoVendorIdFor('openai', 'oauth'));
  if (creds.xaiOAuthToken) set.add(byoVendorIdFor('xai', 'oauth'));
  return set;
}

/** The connected providers implied by a resolved credential set — the api-keys
 *  present plus a live Anthropic subscription. */
export function providersFromCredentials(creds: TenantLlmCredentials): LlmProvider[] {
  const set = new Set<LlmProvider>((Object.keys(creds.vendorKeys) as LlmProvider[]).filter((p) => creds.vendorKeys[p]));
  if (creds.anthropicOAuthToken) set.add('anthropic');
  if (creds.openaiCodexAuth) set.add('openai');
  if (creds.xaiOAuthToken) set.add('xai');
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
      set: { keyEnc, authType: 'api_key', updatedAt: sql`NOW()` },
    });
}

/** Store (or replace) a tenant's OAuth subscription tokens, encrypted at rest. */
export async function setTenantProviderOAuth(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  tokens: AnthropicOAuthTokens | OpenAICodexOAuthTokens | XaiOAuthTokens,
  userId: string | null,
): Promise<void> {
  const keyEnc = await encryptSecretForStorage(JSON.stringify(tokens), credentialSecret(env), { tenantId });
  const db = buildDatabase(env);
  await db
    .insert(tenantLlmProviderKeys)
    .values({ tenantId, provider, keyEnc, authType: 'oauth', createdByUserId: userId })
    .onConflictDoUpdate({
      target: [tenantLlmProviderKeys.tenantId, tenantLlmProviderKeys.provider],
      set: { keyEnc, authType: 'oauth', updatedAt: sql`NOW()` },
    });
}

export interface OpenAICodexResolution {
  auth: { accessToken: string; accountId: string } | null;
  reason?: ByoUnresolvedReason;
}

/** Resolve and rotate a tenant's ChatGPT/Codex subscription credential. */
export async function resolveOpenAICodexResolution(env: Env, tenantId: number): Promise<OpenAICodexResolution> {
  const row = await loadProviderRow(env, tenantId, 'openai');
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

interface ProviderKeyRow {
  key_enc?: string;
  auth_type?: string;
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
  } catch {
    return null;
  }
}

/**
 * Why a CONNECTED provider (a stored credential row exists) could NOT be resolved to a
 * usable credential this call — surfaced so a "should have used my own account" run is
 * actionable, not a silent shared-pool degrade:
 *   • `revoked`         — the OAuth refresh returned 401/403; the token is dead → reconnect.
 *   • `expired`         — past real expiry and the refresh failed transiently (retryable).
 *   • `undecryptable`   — the stored blob won't decrypt/parse (key rotation / corruption).
 *   • `other-workspace` — NOT connected in THIS tenant, but the SAME user has it connected
 *                         under a DIFFERENT workspace they belong to (a tenant mismatch —
 *                         they connected it somewhere else). Detected separately, per-user.
 */
export type ByoUnresolvedReason = 'revoked' | 'expired' | 'undecryptable' | 'other-workspace';

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
 * the lookups. Best-effort — each part independently degrades to null/empty, and a
 * configured-but-unresolved provider still shows up in `configuredProviders` (with a
 * WHY in `unresolvedReasons`) so the degrade to the shared pool is never silent.
 */
export async function resolveTenantLlmCredentials(env: Env, tenantId: number): Promise<TenantLlmCredentials> {
  const [anthropicRes, openaiRes, xaiRes, vendorKeys, configured, openRouterConnections] = await Promise.all([
    resolveAnthropicResolution(env, tenantId).catch(() => ({ auth: null }) as AnthropicResolution),
    resolveOpenAICodexResolution(env, tenantId).catch(() => ({ auth: null }) as OpenAICodexResolution),
    resolveXaiOAuthResolution(env, tenantId).catch(() => ({ token: null }) as XaiOAuthResolution),
    resolveTenantVendorKeys(env, tenantId),
    listTenantProviderKeys(env, tenantId).catch(() => [] as ProviderKeySummary[]),
    listOpenRouterConnections(env, tenantId).catch(() => [] as OpenRouterConnection[]),
  ]);
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
  for (const p of creds.configuredProviders) {
    if (usable.has(p)) continue;
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
      provider: tenantLlmProviderKeys.provider,
      authType: tenantLlmProviderKeys.authType,
      priority: tenantLlmProviderKeys.priority,
    })
    .from(tenantLlmProviderKeys)
    .where(eq(tenantLlmProviderKeys.tenantId, tenantId))
    // `priority` NULL = unset and MUST sort last (a set precedence always wins).
    .orderBy(sql`${tenantLlmProviderKeys.priority} ASC NULLS LAST`, asc(tenantLlmProviderKeys.provider));
  const rows: Array<{ provider: string; auth_type?: string; priority?: number | null }> = selected.map((r) => ({
    provider: r.provider,
    auth_type: r.authType ?? undefined,
    priority: r.priority,
  }));
  return rows
    .filter((r) => isSupportedProvider(r.provider))
    .map((r) => ({
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
 */
export async function setTenantProviderPriorityRanks(
  env: Env,
  tenantId: number,
  ranks: ReadonlyMap<LlmProvider, number | null>,
): Promise<void> {
  if (ranks.size === 0) return;
  const db = buildDatabase(env);
  for (const [provider, priority] of ranks) {
    if (!isSupportedProvider(provider)) continue;
    await db
      .update(tenantLlmProviderKeys)
      .set({ priority, updatedAt: sql`NOW()` })
      .where(and(
        eq(tenantLlmProviderKeys.tenantId, tenantId),
        eq(tenantLlmProviderKeys.provider, provider),
      ));
  }
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
export function byoVendorPriorityOrder(summaries: readonly ProviderKeySummary[]): string[] {
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
