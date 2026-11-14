/**
 * PRD 41 §C14 — "Cloud runs": the run delta a CLOUD run produces is computed by the SAME
 * `@builderforce/run-delta` engine the VSIX runs (the container sandbox executes the package with
 * the same analyzers), then persisted server-side and synced to the workspace like a local run's.
 * This module is the persistence half the host (finalizeCloudRun) calls:
 *
 *   1. Store the full delta (evidence included) as a content-addressed blob in R2, keyed by its
 *      digest — the same `runDeltaEvidence` store the sync importer writes. Write-once, canonical.
 *   2. Upsert the `run_deltas` / `run_delta_dimensions` / `run_delta_findings` rows under the run's
 *      (tenant, run, repo key): a retried finalize converges (revises to this digest), it never
 *      wedges on the unique key. The first write wins per (run, repo key).
 *   3. Emit the `run-delta` mirror record so a PULL syncs it to the workspace: one `sync_records`
 *      projection (the FULL payload, the 2026-11-10 mirror decision) + one `sync_changes` row,
 *      under the canonical client id `runDeltaClientId(runId, repoKey)` — the SAME id a device that
 *      ran locally would push, so a workspace that also ran this repo does not double-store. Server
 *      originated, so `provenance.source` is `platform` and there is no client event journal (a
 *      replay is keyed by a pushing (device, eventId); no device pushed this).
 *
 * The delta is handed in already computed (by the sandbox through the shared engine); this module
 * never computes. Strictly best-effort at the call site: a failed persist is reported and must not
 * change the run's own outcome (the finalize contract), but the rows/blob/record commit or roll
 * back together so a partial delta is never visible.
 */

import type { Db } from '../../infrastructure/database/connection';
import { inTransaction } from '../../infrastructure/database/connection';
import { syncChanges, syncRecords } from '../../infrastructure/database/schema/sync';
import type { RunDelta } from '@builderforce/run-delta';
import type { Env } from '../../env';
import { cloudRunId } from '../../domain/execution/cloudRunId';
import { repositoryIdentityOf } from '../../domain/runOutcomes/repositoryIdentity';
import { readRunDeltaRecord, runDeltaClientId, type ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';
import { destinationKey } from '@builderforce/local-first';
import { hashSyncPayload } from '../../domain/sync/syncProtocol';
import { CLIENT_REPORTED_EVIDENCE } from '../../domain/sync/occurredAtGate';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { runDeltaWriter } from './runDeltaStore';
import { runDeltaEvidenceStore } from './runDeltaEvidence';
import { bumpRunDeltaReads } from './runDeltaReads';

/** A `run-delta` record is mirrored with schema version 1 (the `run-delta` local record contract). */
const RUN_DELTA_SCHEMA_VERSION = 1;
/** The device id a server-originated record is attributed to (no client pushed it). */
const CLOUD_DEVICE_ID = 'cloud-finalize';

export interface PersistCloudRunDeltaArgs {
  tenantId: number;
  executionId: number;
  taskId: number;
  repoCtx: TicketRepoContext;
  /** The delta the sandbox computed through the shared `@builderforce/run-delta` engine. */
  delta: RunDelta;
  /** The chat whose run it was, when the run was chat-driven (else the record carries no chat link). */
  chatId?: number | null;
  mode?: 'interactive' | 'autonomous';
  now?: Date;
  env?: Env;
}

/**
 * Persist a cloud run's delta: evidence blob, `run_deltas` rows, and the `run-delta` mirror record
 * (projection + change row) that a pull serves to the workspace. Returns the mirror record's UUID,
 * or null when the delta could not be stored (the caller reports and continues the finalize).
 */
export async function persistCloudRunDelta(db: Db, args: PersistCloudRunDeltaArgs): Promise<string | null> {
  const { tenantId, executionId, repoCtx, delta } = args;
  const now = args.now ?? new Date();
  const runId = cloudRunId(executionId);
  const repository = repositoryIdentityOf(repoCtx);
  // The same repository key a device derives (its remote URL, else a `local:` hash); a cloud run's
  // repo is always a remote, so the URL is the key. Bounded to the `repo_key` column (128 bytes).
  const repoKey = repository.slice(0, 128);
  const recordId = runDeltaClientId(runId, repoKey);
  const destination = { kind: 'bound', accountId: String(tenantId), projectId: String(repoCtx.projectId) } as const;
  const destinationKeyValue = destinationKey(destination);

  // The payload the mirror record carries: the same shape a device pushes (`readRunDeltaRecord`
  // round-trips it), so the card a device renders from the pulled record is the full delta.
  const payload = {
    runId,
    repoKey,
    repository,
    changeSetId: `cloud:${executionId}`,
    chatId: args.chatId ?? null,
    mode: args.mode ?? 'autonomous',
    delta,
    computedMs: 0,
    projectId: repoCtx.projectId,
    surface: 'cloud',
    computedAt: now.toISOString(),
  };
  const parsed = readRunDeltaRecord(payload, recordId, now.toISOString(), () => now);
  if (!parsed.ok) return null;
  const imported: ImportedRunDelta = parsed.value;
  const projectId = repoCtx.projectId;

  // 1. Evidence blob FIRST, outside the row transaction: content-addressed and write-once, so a
  //    retry rewrites nothing and a rollback leaves only a harmless orphan. A failed write aborts
  //    the persist (a row without its evidence would be a delta nobody can open).
  const evidence = runDeltaEvidenceStore(args.env);
  try {
    await evidence.put(tenantId, delta);
  } catch {
    return null;
  }

  try {
    await inTransaction(db, async (tx) => {
      // 2. The 3NF rows, under the (run, repo key). `upsert` converges a retried finalize: an
      //    existing row is revised to THIS digest, a missing one is inserted; a different digest
      //    already stored under the key is left alone (the first write wins).
      const written = await runDeltaWriter(tx).upsert?.(tenantId, projectId, imported);
      if (!written) throw new Error('run_delta_writer_no_upsert');

      // 3. The mirror record: one `sync_records` projection (the FULL payload) + one `sync_changes`
      //    row, so a pull of this destination syncs the delta to the workspace. A retry (same
      //    canonical client id) upserts the same projection instead of a duplicate.
      await upsertCloudRunDeltaMirror(tx, {
        tenantId,
        recordId,
        payload,
        destinationKey: destinationKeyValue,
        destination,
        occurredAt: imported.summary.computedAt,
        now,
      });
    });
  } catch {
    return null;
  }

  // Bump the run-delta read caches only after the rows committed.
  await bumpRunDeltaReads(args.env, tenantId).catch(() => undefined);
  return recordId;
}

/** One `sync_records` row + one `sync_changes` row, server-originated (provenance.source `platform`). */
async function upsertCloudRunDeltaMirror(
  tx: Parameters<Parameters<typeof inTransaction>[1]>[0],
  args: {
    tenantId: number;
    recordId: string;
    payload: Record<string, unknown>;
    destinationKey: string;
    destination: Record<string, unknown>;
    occurredAt: string;
    now: Date;
  },
): Promise<void> {
  const { tenantId, recordId, payload, destinationKey, destination, occurredAt, now } = args;
  const serverId = recordId; // a run-delta's server id is its record UUID (no integer SyncId space)
  const payloadHash = hashSyncPayload(payload);
  const occurred = new Date(occurredAt);
  const provenance = {
    actorId: 'platform',
    deviceId: CLOUD_DEVICE_ID,
    source: 'platform',
    evidence: CLIENT_REPORTED_EVIDENCE,
  };
  const record = {
    id: recordId,
    entityType: 'run-delta',
    schemaVersion: RUN_DELTA_SCHEMA_VERSION,
    version: 1,
    destination,
    occurredAt,
    updatedAt: now.toISOString(),
    payload,
    provenance,
  };

  await tx.insert(syncRecords).values({
    tenantId,
    entityType: 'run-delta',
    clientEntityId: recordId,
    serverId,
    schemaVersion: RUN_DELTA_SCHEMA_VERSION,
    version: 1,
    destinationKey,
    occurredAt: occurred,
    receivedAt: now,
    updatedAt: now,
    deletedAt: null,
    payload,
    provenance,
    payloadHash,
  }).onConflictDoUpdate({
    target: [syncRecords.tenantId, syncRecords.entityType, syncRecords.clientEntityId],
    set: { destinationKey, occurredAt: occurred, updatedAt: now, payload, provenance, payloadHash },
  });

  await tx.insert(syncChanges).values({
    tenantId,
    entityType: 'run-delta',
    clientEntityId: recordId,
    serverId,
    operation: 'create',
    version: 1,
    destinationKey,
    record: record as unknown as Record<string, unknown>,
    occurredAt: occurred,
    deviceId: CLOUD_DEVICE_ID,
    // Deterministic: a retried finalize appends no duplicate change row.
    eventId: recordId,
  });

  // No `sync_events` journal row and no `sync_entity_mappings` row: those are keyed by a pushing
  // (device, eventId) and gate a client push's idempotency; a server-originated record has neither.
  // The projection + change row are what a pull serves.
}
