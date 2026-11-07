/**
 * Telemetry for an ACCEPTED client result (PRD 42 Part D1): the server made no model
 * call, but a call happened on the person's device, so it lands as ONE zero-cost
 * `llm_usage_log` row through the canonical ledger writer (`recordUsageRow`) — the same
 * writer and entry-point label the synced local calls use (`importSyncedUsage`). Unlike
 * those, `byo` is deliberately false: these rows carry zero tokens and zero cost, and
 * marking them BYO would pollute the BYO share metrics. Token counts are not part of the
 * contract, so they are 0; the model and engine are the provenance the client stamped.
 *
 * `recordUsageRow` never throws: usage logging must not fail the request it records.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ClientResultProvenance } from './clientResult';
import { recordUsageRow } from './usageLedger';

export const CLIENT_RESULT_USAGE_SOURCE = 'client-result';
export const CLIENT_RESULT_USAGE_ROLE = 'utility';
const MODEL_REF_MAX = 128;

/** `local/<engine>/<model>` with the client-chosen model reduced to a safe charset. */
export function clientResultModelRef(provenance: ClientResultProvenance): string {
  const safe = provenance.model.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return `local/${provenance.engine}/${safe}`.slice(0, MODEL_REF_MAX);
}

export async function recordClientResultUsage(
  db: Db,
  env: Env,
  args: { tenantId: number; userId?: string | null; projectId?: number | null; useCase: string; provenance: ClientResultProvenance },
): Promise<void> {
  await recordUsageRow(db, env, {
    tenantId: args.tenantId,
    userId: args.userId ?? null,
    llmProduct: 'builderforceLLM',
    model: clientResultModelRef(args.provenance),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    metadata: { source: CLIENT_RESULT_USAGE_SOURCE, engine: args.provenance.engine, clientModel: clientResultModelRef(args.provenance) },
    useCase: args.useCase,
    byo: false,
    calls: 1,
    attribution: { role: CLIENT_RESULT_USAGE_ROLE, ...(args.projectId != null ? { projectId: args.projectId } : {}) },
  });
}
