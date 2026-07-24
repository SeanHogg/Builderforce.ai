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
 * Backed by the raw-SQL `tenant_llm_provider_keys` table (migrations 0088 + 0198),
 * queried via neon.
 */

import { neon } from '@neondatabase/serverless';
import type { HonoEnv } from '../../env';
import { encryptSecretForStorage, decryptSecretFromStorage } from '../../infrastructure/auth/MfaService';
import { credentialSecret } from '../integrations/credentialCrypto';
import { refreshAnthropicToken, OAUTH_SAFETY_MARGIN_MS, type AnthropicOAuthTokens } from './anthropicOAuth';
import { refreshOpenAICodexToken, type OpenAICodexOAuthTokens } from './openaiCodexOAuth';
import { refreshXaiToken, type XaiOAuthTokens } from './xaiOAuth';

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

/** The gateway vendor ids a tenant can serve from their OWN connected providers.
 *  A free tenant may freely pick / strict-pin any model owned by one of these
 *  (they pay their own provider) — the single source both the models endpoint and
 *  the model-choice gates use so "connected providers ⇒ model choice" stays
 *  consistent across surfaces. */
export function byoVendorIdSet(providers: readonly LlmProvider[]): Set<string> {
  return new Set(providers.map((p) => PROVIDER_VENDOR_MAP[p].vendorId));
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
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`
    INSERT INTO tenant_llm_provider_keys (tenant_id, provider, key_enc, auth_type, created_by_user_id)
    VALUES (${tenantId}, ${provider}, ${keyEnc}, 'api_key', ${userId})
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET key_enc = ${keyEnc}, auth_type = 'api_key', updated_at = NOW()
  `;
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
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`
    INSERT INTO tenant_llm_provider_keys (tenant_id, provider, key_enc, auth_type, created_by_user_id)
    VALUES (${tenantId}, ${provider}, ${keyEnc}, 'oauth', ${userId})
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET key_enc = ${keyEnc}, auth_type = 'oauth', updated_at = NOW()
  `;
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
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = (await sql`
      SELECT key_enc, auth_type FROM tenant_llm_provider_keys
      WHERE tenant_id = ${tenantId} AND provider = ${provider} LIMIT 1
    `) as ProviderKeyRow[];
    return rows[0] ?? null;
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
    const sql = neon(env.NEON_DATABASE_URL);
    rows = (await sql`
      SELECT provider, key_enc, auth_type FROM tenant_llm_provider_keys WHERE tenant_id = ${tenantId}
    `) as typeof rows;
  } catch {
    return {};
  }
  const out: TenantVendorKeys = {};
  for (const row of rows) {
    if (!row.provider || !isSupportedProvider(row.provider)) continue;
    if ((row.auth_type ?? 'api_key') !== 'api_key' || !row.key_enc) continue;
    try {
      out[row.provider] = await decryptSecretFromStorage(row.key_enc, credentialSecret(env), { tenantId, legacySecret: env.JWT_SECRET });
    } catch { /* skip an undecryptable row — never fail the batch */ }
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
  const [anthropicRes, openaiRes, xaiRes, vendorKeys, configured] = await Promise.all([
    resolveAnthropicResolution(env, tenantId).catch(() => ({ auth: null }) as AnthropicResolution),
    resolveOpenAICodexResolution(env, tenantId).catch(() => ({ auth: null }) as OpenAICodexResolution),
    resolveXaiOAuthResolution(env, tenantId).catch(() => ({ token: null }) as XaiOAuthResolution),
    resolveTenantVendorKeys(env, tenantId),
    listTenantProviderKeys(env, tenantId).catch(() => [] as ProviderKeySummary[]),
  ]);
  const anthropicOAuthToken = anthropicRes.auth?.mode === 'oauth' ? anthropicRes.auth.accessToken : null;
  const creds: TenantLlmCredentials = {
    anthropicOAuthToken,
    openaiCodexAuth: openaiRes.auth,
    xaiOAuthToken: xaiRes.token,
    vendorKeys,
    // `configured` is already ordered by tenant-set precedence (listTenantProviderKeys),
    // so both the provider list and the vendor-priority order read straight off it.
    configuredProviders: configured.map((p) => p.provider),
    unresolvedReasons: {},
    vendorPriority: byoVendorPriorityOrder(configured),
  };
  // Attach a reason to each configured-but-unusable provider: Anthropic gets the precise
  // reason from its resolver; an api-key provider that's configured but decrypted to
  // nothing is `undecryptable` (the only api-key failure mode `resolveTenantVendorKeys`
  // can hit). Computed against the resolved (usable) set so a working provider is skipped.
  const usable = new Set(providersFromCredentials(creds));
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
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = (await sql`
      SELECT DISTINCT k.provider
      FROM tenant_llm_provider_keys k
      JOIN tenant_members m ON m.tenant_id = k.tenant_id
      WHERE m.user_id = ${userId} AND m.is_active = true
        AND k.tenant_id <> ${tenantId}
        AND k.provider = ANY(${providers as unknown as string[]})
    `) as Array<{ provider: string }>;
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
  const sql = neon(env.NEON_DATABASE_URL);
  const rows = (await sql`
    SELECT provider, auth_type, priority FROM tenant_llm_provider_keys
    WHERE tenant_id = ${tenantId}
    ORDER BY priority ASC NULLS LAST, provider ASC
  `) as Array<{ provider: string; auth_type?: string; priority?: number | null }>;
  return rows
    .filter((r) => isSupportedProvider(r.provider))
    .map((r) => ({
      provider: r.provider as LlmProvider,
      authType: ((r.auth_type ?? 'api_key') === 'oauth' ? 'oauth' : 'api_key') as ProviderAuthType,
      priority: typeof r.priority === 'number' ? r.priority : null,
    }));
}

/**
 * Set the tenant's BYO provider PRECEDENCE from an ordered provider list (most-
 * preferred first). Each provider's `priority` is stamped with its index, so the
 * auto-select cloud pin ({@link byoAutoSeedModels}) leads with the owner's chosen
 * account (e.g. Meta first) before failing over across the rest in that order.
 * Only rows that already exist (a connected provider) are updated — ordering an
 * un-connected provider is a no-op. Providers absent from `order` are reset to
 * unset (NULL → catalog-tier fallback), so the list is the single source.
 */
export async function setTenantProviderPriority(
  env: Env,
  tenantId: number,
  order: readonly LlmProvider[],
): Promise<void> {
  const sql = neon(env.NEON_DATABASE_URL);
  const ranked = order.filter(isSupportedProvider);
  // Clear any provider NOT in the new order back to unset, then stamp the ranked ones.
  // Empty order → clear ALL (a plain UPDATE; `= ANY('{}')` can't infer its element type).
  if (ranked.length === 0) {
    await sql`UPDATE tenant_llm_provider_keys SET priority = NULL, updated_at = NOW() WHERE tenant_id = ${tenantId}`;
    return;
  }
  await sql`
    UPDATE tenant_llm_provider_keys SET priority = NULL, updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND NOT (provider = ANY(${ranked as unknown as string[]}))
  `;
  for (let i = 0; i < ranked.length; i++) {
    await sql`
      UPDATE tenant_llm_provider_keys SET priority = ${i}, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND provider = ${ranked[i]}
    `;
  }
}

/**
 * The tenant's connected providers as ordered GATEWAY VENDOR IDS (most-preferred
 * first) — the precedence {@link byoAutoSeedModels} sorts its flagship seeds by.
 * Only providers with a set `priority` are included (unset providers fall back to
 * catalog-tier ordering inside the seed). Maps each provider → its gateway vendor
 * id ('google' → 'googleai') so the ids line up with `vendorForModel(flagship)`.
 */
export function byoVendorPriorityOrder(summaries: readonly ProviderKeySummary[]): string[] {
  return summaries
    .filter((s) => s.priority !== null)
    .map((s) => s.provider === 'openai' && s.authType === 'oauth'
      ? 'openai-codex'
      : s.provider === 'xai' && s.authType === 'oauth'
        ? 'xai-oauth'
        : PROVIDER_VENDOR_MAP[s.provider].vendorId);
}

/** Remove a tenant's provider credential (API key or OAuth subscription). */
export async function deleteTenantProviderKey(env: Env, tenantId: number, provider: LlmProvider): Promise<void> {
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`DELETE FROM tenant_llm_provider_keys WHERE tenant_id = ${tenantId} AND provider = ${provider}`;
}
