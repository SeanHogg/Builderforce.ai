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
 * at rest with AES-GCM using `JWT_SECRET` (reusing the MFA storage helpers), the
 * same scheme as tenant MCP secrets. Backed by the raw-SQL `tenant_llm_provider_keys`
 * table (migrations 0088 + 0198), queried via neon.
 */

import { neon } from '@neondatabase/serverless';
import type { HonoEnv } from '../../env';
import { encryptSecretForStorage, decryptSecretFromStorage } from '../../infrastructure/auth/MfaService';
import { refreshAnthropicToken, type AnthropicOAuthTokens } from './anthropicOAuth';

type Env = HonoEnv['Bindings'];

export type LlmProvider = 'anthropic';
export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = ['anthropic'];

export type ProviderAuthType = 'api_key' | 'oauth';

/** A tenant's resolved Anthropic credential — discriminated by auth type. */
export type AnthropicAuth =
  | { mode: 'api_key'; key: string }
  | { mode: 'oauth'; accessToken: string };

/** One configured provider + how it authenticates (no secrets). */
export interface ProviderKeySummary {
  provider: LlmProvider;
  authType: ProviderAuthType;
}

export function isSupportedProvider(p: string): p is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

/** Store (or replace) a tenant's provider API key, encrypted at rest. */
export async function setTenantProviderKey(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  plaintextKey: string,
  userId: string | null,
): Promise<void> {
  const keyEnc = await encryptSecretForStorage(plaintextKey, env.JWT_SECRET);
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
  tokens: AnthropicOAuthTokens,
  userId: string | null,
): Promise<void> {
  const keyEnc = await encryptSecretForStorage(JSON.stringify(tokens), env.JWT_SECRET);
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`
    INSERT INTO tenant_llm_provider_keys (tenant_id, provider, key_enc, auth_type, created_by_user_id)
    VALUES (${tenantId}, ${provider}, ${keyEnc}, 'oauth', ${userId})
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET key_enc = ${keyEnc}, auth_type = 'oauth', updated_at = NOW()
  `;
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
 * Resolve a tenant's Anthropic credential to a ready-to-use auth, refreshing and
 * re-persisting the OAuth subscription token when it has expired. Returns null
 * when the tenant has no Anthropic credential (or it can't be decrypted/refreshed).
 */
export async function resolveAnthropicAuth(
  env: Env,
  tenantId: number,
): Promise<AnthropicAuth | null> {
  const row = await loadProviderRow(env, tenantId, 'anthropic');
  if (!row?.key_enc) return null;
  const authType = (row.auth_type ?? 'api_key') as ProviderAuthType;

  let decrypted: string;
  try {
    decrypted = await decryptSecretFromStorage(row.key_enc, env.JWT_SECRET);
  } catch {
    return null;
  }

  if (authType === 'api_key') {
    return { mode: 'api_key', key: decrypted };
  }

  // OAuth subscription: decode, refresh if expired, persist the rotated tokens.
  let tokens: AnthropicOAuthTokens;
  try {
    tokens = JSON.parse(decrypted) as AnthropicOAuthTokens;
  } catch {
    return null;
  }
  if (!tokens.access || !tokens.refresh) return null;

  if (Date.now() < tokens.expires) {
    return { mode: 'oauth', accessToken: tokens.access };
  }

  try {
    const refreshed = await refreshAnthropicToken(tokens.refresh);
    await setTenantProviderOAuth(env, tenantId, 'anthropic', refreshed, null);
    return { mode: 'oauth', accessToken: refreshed.access };
  } catch {
    return null;
  }
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

/** List which providers a tenant has configured + how each authenticates (no secrets). */
export async function listTenantProviderKeys(
  env: Env,
  tenantId: number,
): Promise<ProviderKeySummary[]> {
  const sql = neon(env.NEON_DATABASE_URL);
  const rows = (await sql`
    SELECT provider, auth_type FROM tenant_llm_provider_keys WHERE tenant_id = ${tenantId}
  `) as Array<{ provider: string; auth_type?: string }>;
  return rows
    .filter((r) => isSupportedProvider(r.provider))
    .map((r) => ({
      provider: r.provider as LlmProvider,
      authType: ((r.auth_type ?? 'api_key') === 'oauth' ? 'oauth' : 'api_key') as ProviderAuthType,
    }));
}

/** Remove a tenant's provider credential (API key or OAuth subscription). */
export async function deleteTenantProviderKey(env: Env, tenantId: number, provider: LlmProvider): Promise<void> {
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`DELETE FROM tenant_llm_provider_keys WHERE tenant_id = ${tenantId} AND provider = ${provider}`;
}
