/**
 * The api key a batch call runs on — resolved at the tick, per provider batch, never
 * stored on a job. BYO = the tenant's decrypted api key for that provider (the same
 * `resolveTenantVendorKeys` overlay the synchronous gateway uses); platform = the
 * operator key the synchronous vendor module reads.
 */
import type { Env } from '../../../env';
import { resolveTenantVendorKeys } from '../tenantProviderKeyService';
import type { BatchFunding, BatchVendor } from './batchTypes';

/** The operator env key per batch provider — the api KEY, never a subscription token
 *  (`CLAUDE_OAUTH_TOKEN` cannot drive the Batches API). */
const OPERATOR_KEYS: Readonly<Record<BatchVendor, (env: Env) => string | null | undefined>> = {
  anthropic: (env) => env.CLAUDE_API_KEY,
  openai: (env) => env.OPENAI_API_KEY,
};

export function operatorBatchKey(env: Env, vendor: BatchVendor): string | null {
  return OPERATOR_KEYS[vendor](env)?.trim() || null;
}

export async function resolveBatchApiKey(
  env: Env,
  tenantId: number,
  vendor: BatchVendor,
  funding: BatchFunding,
): Promise<string | null> {
  if (funding === 'platform') return operatorBatchKey(env, vendor);
  return (await resolveTenantVendorKeys(env, tenantId))[vendor]?.trim() || null;
}
