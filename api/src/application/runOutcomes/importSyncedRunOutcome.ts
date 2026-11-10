/**
 * PRD 41 §D1 — import one synced `run-outcome` record: a run's frozen features, its per-run
 * commit attribution and its outcome labels, written to the run-outcomes tables (the ONE
 * owner; nothing else keeps a copy).
 *
 * The tables live on the operational endpoint, so — like the usage ledger — the write cannot
 * ride the push's unit of work: it goes through {@link SyncRunOutcomeStore}, whose unique keys
 * make a retried event a no-op (features `ON CONFLICT DO NOTHING`, attributions and labels
 * upserted). A write that FAILS is answered pending — retried, never applied.
 *
 * RULES
 *   • A payload that is not a `RunOutcomeRecordValue` (the device-only gate-ledger rows share
 *     the entity type and are never journaled) is refused, as is any field out of bounds.
 *   • Features are frozen: a write whose digest differs from the stored vector is a conflict.
 *   • A device may not report a run in the cloud's id space (`cloud:`).
 *   • Delete is refused: a device dropping its local record does not erase training data
 *     (erasure is the tenant-delete cascade).
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import { parseRunOutcomeRecord, RETRYABLE_RUN_OUTCOME_REFUSALS, type ParsedRunOutcome } from '../../domain/runOutcomes/runOutcomeRecord';
import type { SyncEventInput, SyncImportContext, SyncStoreSet } from '../sync/syncPorts';
import {
  appliedExisting,
  appliedNew,
  conflict,
  mutateGate,
  pending,
  preludeRejection,
  rejected,
  type BoundedImportOutcome,
} from '../sync/importers/index';
import { runOutcomesDatabase, writeRunOutcome, type RunOutcomeWrite } from './runOutcomeStore';

export const RUN_OUTCOME_ENTITY_TYPE = 'run-outcome';

/** The run-outcomes tables as the importer sees them (operational endpoint, own dedupe). */
export interface SyncRunOutcomeStore {
  /** THROWS when the write fails, so the importer answers it as retryable. */
  write(tenantId: number, projectId: number | null, record: ParsedRunOutcome): Promise<RunOutcomeWrite>;
}

/** Composition — the production store over the request's core handle. */
export function syncRunOutcomeStore(core: Db): SyncRunOutcomeStore {
  return {
    write: (tenantId, projectId, record) => writeRunOutcome(runOutcomesDatabase(core), tenantId, projectId, record),
  };
}

/** The destination's project, when it names one this tenant owns. */
async function projectOf(ctx: SyncImportContext): Promise<number | null> {
  const destination = ctx.destination;
  if (destination.kind !== 'bound' || !destination.projectId) return null;
  return ctx.resolveProjectId(destination.projectId);
}

export async function importSyncedRunOutcome(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  store: SyncRunOutcomeStore,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== RUN_OUTCOME_ENTITY_TYPE) return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  if (event.operation === 'delete') return rejected('run_outcome_delete_unsupported');
  if (event.operation !== 'create' && event.operation !== 'import' && event.operation !== 'update') {
    return rejected('operation_unsupported');
  }
  const parsed = parseRunOutcomeRecord(event.payload, ctx.now);
  // A newer client's schema waits (the device keeps the event pending and resends it after the deploy).
  if (!parsed.ok) return RETRYABLE_RUN_OUTCOME_REFUSALS.has(parsed.detail) ? pending(parsed.detail) : rejected(parsed.detail);

  const tenantId = ctx.auth.tenantId;
  const mapping = await stores.findMapping(tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'update') {
    const gate = mutateGate(event, ctx, mapping);
    if (gate) return gate;
  } else if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (mapping.payloadHash !== event.payloadHash) return conflict(mapping, 'entity_already_imported');
  }
  if (mapping && mapping.payloadHash === event.payloadHash) return appliedExisting(mapping, event.payload);

  let written: RunOutcomeWrite;
  try {
    written = await store.write(tenantId, await projectOf(ctx), parsed.value);
  } catch (error) {
    reportCaughtError(error, { source: 'application/runOutcomes/importSyncedRunOutcome.ts', operation: 'importSyncedRunOutcome' });
    return pending('run_outcome_write_failed');
  }
  if (!written.ok) return mapping ? conflict(mapping, written.detail) : rejected(written.detail);
  return mapping
    ? appliedNew(mapping.serverId, mapping.serverVersion + 1, ctx.destinationKey, event.payload)
    : appliedNew(event.clientEntityId, 1, ctx.destinationKey, event.payload);
}
