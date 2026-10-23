/**
 * WHERE a deferred call runs — provider, model and who pays — decided once at enqueue.
 *
 * The rule that keeps D6 a saving and never a new charge: a call is moved onto a funding
 * source only if its synchronous twin would have been paid from the same place.
 *   • A use case whose synchronous path runs on the tenant's own account
 *     (`tenantFunded`) batches on the tenant's own API KEY for a batch provider. A tenant
 *     whose connection cannot batch (a subscription token, a provider with no batch API)
 *     keeps the synchronous call — moving it onto the operator key would bill us for
 *     work their account was paying for.
 *   • A use case whose synchronous path is platform-funded (`platformFunded`) batches on
 *     the operator key.
 *   • A pinned model (the distillation teacher) batches only on that model's provider.
 *
 * Credentials are NOT read here — only which connections exist (`listTenantProviderKeys`,
 * cached, no secrets). The key itself is resolved at the tick (`batchCredentials.ts`).
 */
import { currentAnthropicModelId } from '@builderforce/model-catalog';
import type { Env } from '../../../env';
import { listTenantProviderKeys, type ProviderKeySummary } from '../tenantProviderKeyService';
import { parseVendorPrefix, vendorForModel } from '../vendors/registry';
import { operatorBatchKey } from './batchCredentials';
import {
  BATCH_VENDORS,
  isBatchVendor,
  type BatchCallbackKind,
  type BatchTarget,
  type BatchVendor,
} from './batchTypes';

export interface BatchUseCaseSpec {
  /** The ledger `use_case` the settled usage row is written under — the synchronous
   *  call's own, so spend per use case reads the same whichever path served it. */
  useCase: string;
  /** The synchronous path runs on the tenant's connected account when they have one. */
  tenantFunded: boolean;
  /** The synchronous path is paid from the operator key when the tenant has none. */
  platformFunded: boolean;
  /** Model per provider for an unpinned call; `null` = the caller always pins one. */
  models: Readonly<Record<BatchVendor, string>> | null;
}

/** Background summarisation: the tier the synchronous Brain call defaults to. */
const SUMMARY_MODELS: Readonly<Record<BatchVendor, string>> = {
  anthropic: currentAnthropicModelId('sonnet'),
  openai: 'gpt-4.1',
};

/** THE per-call-site policy. A new deferred call site is a row here plus a handler. */
export const BATCH_USE_CASES: Readonly<Record<BatchCallbackKind, BatchUseCaseSpec>> = {
  // The classifier's synchronous LLM pass is the FREE shared pool, never the tenant's
  // account — so it is not platform-funded either: batching a free-pool call onto paid
  // Haiku would cost MORE than the call it defers. With neither funding route the job
  // never queues and the classifier keeps its free synchronous pass.
  task_action_type: {
    useCase: 'task_classification',
    tenantFunded: false,
    platformFunded: false,
    models: { anthropic: currentAnthropicModelId('haiku'), openai: 'gpt-4.1-mini' },
  },
  project_memory: { useCase: 'brain_project_memory', tenantFunded: true, platformFunded: true, models: SUMMARY_MODELS },
  agent_host_session_summary: { useCase: 'brain_summary', tenantFunded: true, platformFunded: true, models: SUMMARY_MODELS },
  // The teacher is strict-pinned; BYO first, then the premium pool — as the sync call.
  evermind_teacher: { useCase: 'task_execution', tenantFunded: true, platformFunded: true, models: null },
};

export type BatchTargetResult = { ok: true; target: BatchTarget } | { ok: false; reason: string };

/** A pinned model id → its batch provider and the id that provider knows it by. */
export function pinnedBatchModel(pinned: string): { vendor: BatchVendor; model: string } | { reason: string } {
  const prefixed = parseVendorPrefix(pinned);
  const vendor = prefixed?.vendor ?? vendorForModel(pinned);
  if (!isBatchVendor(vendor)) return { reason: `no_batch_api:${vendor}` };
  return { vendor, model: prefixed?.modelId ?? pinned };
}

/**
 * Pure decision over the tenant's connections and the operator keys bound. Exported for
 * tests; {@link resolveBatchTarget} supplies the inputs.
 */
export function chooseBatchTarget(
  spec: BatchUseCaseSpec,
  connections: readonly ProviderKeySummary[],
  operatorKeyBound: (vendor: BatchVendor) => boolean,
  pinnedModel?: string | null,
): BatchTargetResult {
  let candidates: Array<{ vendor: BatchVendor; model: string }>;
  if (pinnedModel) {
    const pinned = pinnedBatchModel(pinnedModel);
    if ('reason' in pinned) return { ok: false, reason: pinned.reason };
    candidates = [pinned];
  } else if (spec.models) {
    const models = spec.models;
    candidates = BATCH_VENDORS.map((vendor) => ({ vendor, model: models[vendor] }));
  } else {
    return { ok: false, reason: 'no_model' };
  }

  if (spec.tenantFunded) {
    const relevant = pinnedModel
      ? connections.filter((c) => candidates.some((k) => k.vendor === c.provider))
      : connections;
    // `connections` is in the tenant's own precedence order — the first batchable key wins.
    for (const c of relevant) {
      const hit = c.authType === 'api_key' ? candidates.find((k) => k.vendor === c.provider) : undefined;
      if (hit) return { ok: true, target: { ...hit, funding: 'byo' } };
    }
    // Their account serves the synchronous call but cannot batch it: keep it synchronous.
    if (relevant.length > 0) return { ok: false, reason: 'tenant_account_not_batchable' };
  }

  if (spec.platformFunded) {
    const hit = candidates.find((k) => operatorKeyBound(k.vendor));
    if (hit) return { ok: true, target: { ...hit, funding: 'platform' } };
  }
  return { ok: false, reason: 'no_batch_credential' };
}

export async function resolveBatchTarget(
  env: Env,
  tenantId: number,
  kind: BatchCallbackKind,
  pinnedModel?: string | null,
): Promise<BatchTargetResult> {
  const spec = BATCH_USE_CASES[kind];
  // Unreadable connections → the caller stays synchronous; deciding blind could move a
  // tenant-funded call onto the operator key.
  const connections = spec.tenantFunded ? await listTenantProviderKeys(env, tenantId) : [];
  return chooseBatchTarget(spec, connections, (vendor) => !!operatorBatchKey(env, vendor), pinnedModel);
}
