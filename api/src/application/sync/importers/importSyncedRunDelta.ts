/**
 * PRD 41 §C14 — the `run-delta` branch of the mirror importer: a run's delta per repository, synced as a
 * mirror record, lands in `run_deltas` / `run_delta_dimensions` / `run_delta_findings`.
 *
 * Still a MIRROR: the payload is projected verbatim (a pull writes it back over the device's record, so the
 * projection must stay the full value the device's card reads), nothing is dispatched, and the only side effect
 * beyond the rows is the content-addressed evidence blob. A computed delta does not change, with ONE exception: its
 * REVISION (`update`), the final delta of a run whose L3 analyzers settled after the static one was stored (PRD 41
 * §6) — a new evidence blob under the new digest (each digest's evidence stays write-once) and the row's pointer moved
 * to it ({@link reviseRunDelta}). An update of a delta never imported is still refused (`run_delta_immutable`).
 *
 * ORDER. The evidence blob is written FIRST, outside the transaction: it is keyed by the RECOMPUTED digest, so a
 * retry rewrites the same object and a rollback leaves only a harmless orphan. A failed blob write is answered
 * `pending` (retried), never applied — a row without its evidence would be a delta nobody can open. The rows ride
 * the push's transaction in their own savepoint; a row the database still refuses (a 22xxx data or 23xxx
 * constraint error the validation did not foresee) is REJECTED, so one bad delta cannot wedge its push chunk.
 * The read caches are bumped only after commit.
 */

import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { readRunDeltaRecord } from '../../../domain/runDelta/runDeltaRecord';
import { pgErrorOf } from '../../../infrastructure/database/uniqueViolation';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { RunDeltaImportPorts } from '../../runDelta/runDeltaPorts';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  clampedClientTime,
  conflict,
  mutateGate,
  pending,
  preludeRejection,
  rejected,
  type BoundedImportOutcome,
} from './index';

const SOURCE = 'application/sync/importers/importSyncedRunDelta.ts';
/** SQLSTATE classes a malformed row raises: 22 data exception, 23 integrity constraint violation. */
const UNSTORABLE = /^2[23]/;

export async function importSyncedRunDelta(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  ports: RunDeltaImportPorts,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'run-delta') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  if (event.operation !== 'create' && event.operation !== 'import' && event.operation !== 'update') return rejected('run_delta_immutable');
  // The push persists an applied event's payload verbatim into `sync_records.payload` (jsonb), which refuses
  // U+0000 anywhere in it — a field the row validation never reads included. Refused here, before any write.
  if (JSON.stringify(event.payload ?? null).includes('\\u0000')) return rejected('run_delta_payload_nul');

  const tenantId = ctx.auth.tenantId;
  const mapping = await stores.findMapping(tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'update') return reviseRunDelta(event, ctx, mapping, ports);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (mapping.payloadHash === event.payloadHash) return appliedExisting(mapping, event.payload);
    return conflict(mapping, 'entity_already_imported');
  }

  const parsed = readRunDeltaRecord(event.payload, event.clientEntityId, event.occurredAt, (raw) => clampedClientTime(raw, ctx.now));
  if (!parsed.ok) return parsed.retry ? pending(parsed.detail) : rejected(parsed.detail);
  const imported = parsed.value;
  // A project the caller cannot use is dropped, not fatal: the delta is still the run's, readable by run id.
  const projectId = imported.projectRef ? await ctx.resolveProjectId(imported.projectRef) : null;

  try {
    await ports.evidence.put(tenantId, imported.delta);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'evidence.put' });
    return pending('run_delta_evidence_write_failed');
  }

  let written: Awaited<ReturnType<RunDeltaImportPorts['writer']['insert']>>;
  try {
    written = await ports.writer.insert(tenantId, projectId, imported);
  } catch (error) {
    if (!UNSTORABLE.test(pgErrorOf(error)?.code ?? '')) throw error; // transient: the push retries the event
    reportCaughtError(error, { source: SOURCE, operation: 'writer.insert', level: 'warning' });
    return rejected('run_delta_unstorable');
  }

  const outcome = appliedNew(event.clientEntityId, 1, ctx.destinationKey, event.payload);
  if (written.status === 'exists') {
    // Another event already stored this (run, repo key): the same delta is that delta, a different one is a conflict.
    if (written.digest === imported.delta.digest) return outcome;
    return { status: 'conflict', detail: 'run_delta_already_stored', serverId: event.clientEntityId, serverVersion: 1, payloadHash: hashSyncPayload(event.payload), destinationKey: ctx.destinationKey };
  }
  ctx.afterCommit(() => ports.invalidate(tenantId));
  return imported.projectRef && projectId === null && outcome.status === 'applied' ? { ...outcome, detail: 'project_unresolved' } : outcome;
}

/**
 * A REVISION (`update`, PRD 41 §6): a run's FINAL delta superseding the one stored with its L3 analyzers pending. Only
 * a delta already imported may be revised (no mapping: `run_delta_immutable`, as before), under the usual base-version
 * gate. The new delta's evidence is written under ITS digest (evidence stays write-once and content-addressed: the
 * superseded digest's blob is kept), then the row's pointer moves to it and its dimension/finding rows are replaced.
 */
async function reviseRunDelta(
  event: SyncEventInput, ctx: SyncImportContext, mapping: SyncEntityMappingRow | null, ports: RunDeltaImportPorts,
): Promise<BoundedImportOutcome> {
  if (!mapping || !ports.writer.revise) return rejected('run_delta_immutable');
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  if (mapping.payloadHash === event.payloadHash) return appliedExisting(mapping, event.payload);
  const parsed = readRunDeltaRecord(event.payload, event.clientEntityId, event.occurredAt, (raw) => clampedClientTime(raw, ctx.now));
  if (!parsed.ok) return parsed.retry ? pending(parsed.detail) : rejected(parsed.detail);
  const imported = parsed.value;
  const tenantId = ctx.auth.tenantId;
  const projectId = imported.projectRef ? await ctx.resolveProjectId(imported.projectRef) : null;
  try {
    await ports.evidence.put(tenantId, imported.delta);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'evidence.put' });
    return pending('run_delta_evidence_write_failed');
  }
  let written: { status: 'revised' } | { status: 'missing' } | { status: 'inserted' } | { status: 'exists'; digest: string };
  try {
    written = await ports.writer.revise(tenantId, projectId, imported);
    // Mapped but never landed as rows (an import before the tables existed): the revision is its first row.
    if (written.status === 'missing') written = await ports.writer.insert(tenantId, projectId, imported);
  } catch (error) {
    if (!UNSTORABLE.test(pgErrorOf(error)?.code ?? '')) throw error;
    reportCaughtError(error, { source: SOURCE, operation: 'writer.revise', level: 'warning' });
    return rejected('run_delta_unstorable');
  }
  ctx.afterCommit(() => ports.invalidate(tenantId));
  return appliedNew(mapping.serverId, mapping.serverVersion + 1, ctx.destinationKey, event.payload);
}
