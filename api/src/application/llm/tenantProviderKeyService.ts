/**
 * BYO LLM provider keys — a tenant stores its own vendor API key (e.g. Anthropic)
 * so the gateway can proxy model calls with the tenant's key and meter usage.
 *
 * The plaintext key never leaves this module's setters/getters: it is encrypted
 * at rest with AES-GCM using `JWT_SECRET` (reusing the MFA storage helpers), the
 * same scheme as tenant MCP secrets. Backed by the raw-SQL `tenant_llm_provider_keys`
 * table (migration 0088), queried via neon.
 */

import { neon } from '@neondatabase/serverless';
import type { HonoEnv } from '../../env';
import { encryptSecretForStorage, decryptSecretFromStorage } from '../../infrastructure/auth/MfaService';

type Env = HonoEnv['Bindings'];

export type LlmProvider = 'anthropic';
export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = ['anthropic'];

export function isSupportedProvider(p: string): p is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

/** Store (or replace) a tenant's provider key, encrypted at rest. */
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
    INSERT INTO tenant_llm_provider_keys (tenant_id, provider, key_enc, created_by_user_id)
    VALUES (${tenantId}, ${provider}, ${keyEnc}, ${userId})
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET key_enc = ${keyEnc}, updated_at = NOW()
  `;
}

/** Return the decrypted provider key, or null if none stored / undecryptable. */
export async function getTenantProviderKey(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
): Promise<string | null> {
  const sql = neon(env.NEON_DATABASE_URL);
  const rows = (await sql`
    SELECT key_enc FROM tenant_llm_provider_keys
    WHERE tenant_id = ${tenantId} AND provider = ${provider} LIMIT 1
  `) as Array<{ key_enc?: string }>;
  const enc = rows[0]?.key_enc;
  if (!enc) return null;
  try {
    return await decryptSecretFromStorage(enc, env.JWT_SECRET);
  } catch {
    return null;
  }
}

/** List which providers a tenant has a key configured for (no secrets returned). */
export async function listTenantProviderKeys(env: Env, tenantId: number): Promise<LlmProvider[]> {
  const sql = neon(env.NEON_DATABASE_URL);
  const rows = (await sql`
    SELECT provider FROM tenant_llm_provider_keys WHERE tenant_id = ${tenantId}
  `) as Array<{ provider: string }>;
  return rows.map((r) => r.provider).filter(isSupportedProvider);
}

/** Remove a tenant's provider key. */
export async function deleteTenantProviderKey(env: Env, tenantId: number, provider: LlmProvider): Promise<void> {
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`DELETE FROM tenant_llm_provider_keys WHERE tenant_id = ${tenantId} AND provider = ${provider}`;
}
