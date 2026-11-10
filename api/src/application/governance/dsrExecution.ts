/**
 * dsrExecution — executing a data subject request for its SEGMENT (PRD 08 §10 "Per-Segment DSR and
 * suppression"). `/api/governance/dsr` was a register; this is what makes a request DO something.
 *
 * SCOPE IS THE SEGMENT. The request governs only the Segment's own data, so every store is reached
 * through a `SubjectStoreAdapter` that is handed the `(tenantId, segmentId)` scope and nothing wider.
 * A store that is only tenant-scoped (e.g. campaign audience members) is deliberately NOT adapted:
 * erasing it from here would reach past the Segment boundary this PRD draws. Those stores are NAMED in
 * {@link UNADAPTED_SUBJECT_STORES} and listed as outstanding on every execution.
 *
 * IDENTITY FIRST. Nothing executes until `verified_at` is set - the subject's identity has been
 * checked - whatever the status says.
 *
 * WHAT EXECUTION DOES, by request type
 *   access, portability   build the subject's export from every adapter, PERSIST it to file storage and
 *                         return a download link. Status stays `processing`, naming the stores that were
 *                         not covered, until a manager marks the request delivered (`markDsrDelivered`,
 *                         a separate audited action). It is never auto-`completed`.
 *   erasure, deletion     enforce do-not-contact (suppression entry - honoured by every outbound send
 *                         seam, see marketing/suppression.ts), run each adapter's `erase`, and report which
 *                         stores have no erase path. `completed` only when an erase path really ran and
 *                         nothing is outstanding; otherwise `processing` with that stated.
 *   objection, opt_out    suppression entry; that IS the full remedy, `completed`.
 *   rectification         needs a person: `processing` with that stated.
 *
 * Idempotent: running it twice adds no second suppression entry. Every execution is written to the
 * governance mutation-audit envelope (digests, never the subject's email).
 */
import { eq, sql } from 'drizzle-orm';
import { deletePrivateObject } from '../assets/tenantAssetStore';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { dataSubjectRequests, dataSuppressionList } from '../../infrastructure/database/schema';
import { sha256Hex } from '../../domain/shared/hash';
import { scopedToSegment } from '../../infrastructure/database/tenantScope';
import type { ActorIdentity } from '../activity/activityLog';
import type { SegmentScope } from '../shared/segmentScope';
import { recordGovernanceMutation } from './mutationAudit';

/** One Segment-scoped store of personal data keyed by the subject's email. */
export interface SubjectStoreAdapter {
  name: string;
  /** Rows held about the subject (export). */
  exportRows(db: Db, scope: SegmentScope, email: string): Promise<unknown[]>;
  /** Erase them; returns the count. Absent (and not `retained`) = this store has NO erase path (reported, not hidden). */
  erase?(db: Db, scope: SegmentScope, email: string): Promise<number>;
  /** Kept on purpose after an erasure (the proof of it): never counted as outstanding. */
  retained?: boolean;
}

const suppressionStore: SubjectStoreAdapter = {
  name: 'suppression_list',
  retained: true,
  async exportRows(db, scope, email) {
    return db.select({
      identifierType: dataSuppressionList.identifierType, reason: dataSuppressionList.reason, createdAt: dataSuppressionList.createdAt,
    }).from(dataSuppressionList).where(scopedToSegment(
      dataSuppressionList, scope.tenantId, scope.segmentId, eq(dataSuppressionList.identifierValue, email),
    ));
  },
  // Deliberately no erase: the suppression entry is the proof the person was erased and must be
  // kept so a re-import cannot resurrect them.
};

const requestRegisterStore: SubjectStoreAdapter = {
  name: 'dsr_register',
  retained: true,
  async exportRows(db, scope, email) {
    return db.select({
      requestType: dataSubjectRequests.requestType, status: dataSubjectRequests.status, createdAt: dataSubjectRequests.createdAt,
    }).from(dataSubjectRequests).where(scopedToSegment(
      dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.subjectEmail, email),
    ));
  },
};

/**
 * The Segment's subject-keyed stores. Add a store by adding an adapter - the executor, its audit
 * and its honest reporting do not change. Today: the two governance registers.
 */
export const SUBJECT_STORES: readonly SubjectStoreAdapter[] = [suppressionStore, requestRegisterStore];

/**
 * Stores KNOWN to hold personal data keyed by contact email that no Segment-scoped adapter covers:
 * they are tenant-scoped (or in another domain), so reaching them from a Segment request would cross
 * the Segment boundary. Named here so a request is never reported as covering them.
 */
export const UNADAPTED_SUBJECT_STORES: readonly string[] = ['marketing_audience_members', 'candidate_records'];

export type DsrDisposition = 'export' | 'suppress_and_erase' | 'suppress' | 'manual';

/** Request type -> what execution does. PURE. */
export function dsrDisposition(requestType: string): DsrDisposition {
  switch (requestType.toLowerCase()) {
    case 'access': case 'portability': return 'export';
    case 'erasure': case 'deletion': return 'suppress_and_erase';
    case 'objection': case 'opt_out': return 'suppress';
    default: return 'manual';
  }
}

export interface DsrExecutionResult {
  status: 'completed' | 'processing';
  disposition: DsrDisposition;
  suppressionAdded: boolean;
  exported: Record<string, number>;
  erased: Record<string, number>;
  /** Stores holding the subject's data that this execution could not cover. */
  outstanding: string[];
  /** File-storage key of the persisted export (access / portability); null when none was written. */
  exportKey: string | null;
  /** Set by `markDsrDelivered`. */
  deliveredAt: string | null;
  note: string | null;
  /** Set by the stale-export purge when deleting the export failed (see `dsrExportPurge.ts`). Internal. */
  exportPurge?: { failures: number; nextAttemptAt: string } | null;
}

/** What a client sees of an execution: the storage key is internal and never leaves the server. */
export type PublicDsrResult = Omit<DsrExecutionResult, 'exportKey'> & { exportUrl: string | null };

export const dsrExportUrl = (dsrId: string): string => `/api/governance/dsr/${dsrId}/export`;

/** Strip the internal storage key; expose only the authenticated, manager-gated download URL. PURE. */
export function toPublicDsrResult(result: DsrExecutionResult, dsrId: string): PublicDsrResult {
  const { exportKey, exportPurge: _purgeState, ...rest } = result;
  return { ...rest, exportUrl: exportKey ? dsrExportUrl(dsrId) : null };
}

/**
 * The `/dsr` tracker's row projector: a request row goes to the client with its `executionResult` in the
 * PUBLIC shape (no storage key, a download URL instead) - the tracker list, create and update responses
 * can no more leak the key than the execute / deliver responses can. The stored column is untouched. PURE.
 */
export function projectDsrRow(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.executionResult;
  if (typeof raw !== 'string' || !raw) return row;
  let parsed: DsrExecutionResult;
  try { parsed = JSON.parse(raw) as DsrExecutionResult; } catch { return { ...row, executionResult: null }; }
  const id = typeof row.id === 'string' ? row.id : '';
  return { ...row, executionResult: JSON.stringify(toPublicDsrResult(parsed, id)) };
}

/** Persists an export package to file storage; returns its key, or null when storage is not available. */
export type PersistExport = (fileName: string, json: string) => Promise<string | null>;

export type ExecuteDsrOutcome =
  | { ok: true; result: DsrExecutionResult }
  | { ok: false; status: 404 | 409; error: string };

/** What executing a request would do - the API's answer, so the client never re-derives it. */
export async function planDataSubjectRequest(db: Db, scope: SegmentScope, dsrId: string) {
  const [dsr] = await db.select().from(dataSubjectRequests)
    .where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).limit(1);
  if (!dsr) return null;
  return { disposition: dsrDisposition(dsr.requestType), verified: dsr.verifiedAt != null, status: dsr.status };
}

/** ONE statement: insert the do-not-contact entry unless it is already there. Returns whether it was added. */
async function ensureSuppression(
  db: Db, scope: SegmentScope, email: string, reason: string, dsrId: string, actorId: string | null,
): Promise<boolean> {
  const hash = await sha256Hex(email);
  const res = await db.execute(sql`
    INSERT INTO data_suppression_list (tenant_id, segment_id, identifier_type, identifier_value, identifier_hash, reason, added_by_user_id, added_by_dsr_id, notes)
    SELECT ${scope.tenantId}, ${scope.segmentId}::uuid, 'email', ${email}, ${hash}, ${reason}, ${actorId}, ${dsrId}::uuid,
           ${`Added by executing data subject request ${dsrId}.`}
     WHERE NOT EXISTS (
       SELECT 1 FROM data_suppression_list
        WHERE tenant_id = ${scope.tenantId} AND segment_id = ${scope.segmentId}::uuid
          AND identifier_type = 'email' AND identifier_value = ${email})
    RETURNING id
  `);
  const rows = (res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
  return Array.isArray(rows) && rows.length > 0;
}

export async function executeDataSubjectRequest(
  env: Env | undefined, db: Db, scope: SegmentScope, dsrId: string, actor: ActorIdentity,
  options: { stores?: readonly SubjectStoreAdapter[]; persistExport?: PersistExport } = {},
): Promise<ExecuteDsrOutcome> {
  const stores = options.stores ?? SUBJECT_STORES;
  const [dsr] = await db.select().from(dataSubjectRequests)
    .where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId)))
    .limit(1);
  if (!dsr) return { ok: false, status: 404, error: 'request not found' };
  if (dsr.status === 'completed' || dsr.status === 'rejected') {
    return { ok: false, status: 409, error: `request is already ${dsr.status}` };
  }
  // Identity must have been verified, whatever the status column says.
  if (!dsr.verifiedAt) return { ok: false, status: 409, error: 'the subject’s identity has not been verified yet' };

  const email = dsr.subjectEmail.trim().toLowerCase();
  const disposition = dsrDisposition(dsr.requestType);
  const result: DsrExecutionResult = {
    status: 'processing', disposition, suppressionAdded: false, exported: {}, erased: {},
    outstanding: [...UNADAPTED_SUBJECT_STORES], exportKey: null, deliveredAt: null, note: null,
  };

  if (disposition === 'export') {
    const pkg: Record<string, unknown[]> = {};
    for (const s of stores) {
      const rows = await s.exportRows(db, scope, email);
      pkg[s.name] = rows;
      result.exported[s.name] = rows.length;
    }
    const json = JSON.stringify({ requestId: dsrId, generatedAt: new Date().toISOString(), coveredStores: stores.map((s) => s.name), notCoveredStores: UNADAPTED_SUBJECT_STORES, data: pkg }, null, 2);
    result.exportKey = options.persistExport ? await options.persistExport(`dsr-${dsrId}.json`, json) : null;
    if (!result.exportKey) result.outstanding.push('export_file_storage');
    // NEVER auto-completed: a manager marks it delivered once the subject has actually received it.
  } else if (disposition === 'suppress' || disposition === 'suppress_and_erase') {
    const reason = disposition === 'suppress_and_erase' ? 'erasure_request' : 'user_opt_out';
    result.suppressionAdded = await ensureSuppression(db, scope, email, reason, dsrId, actor.ref);
    if (disposition === 'suppress') {
      result.status = 'completed';
      result.outstanding = [];
    } else {
      for (const s of stores) {
        if (s.erase) result.erased[s.name] = await s.erase(db, scope, email);
        else if (!s.retained && (await s.exportRows(db, scope, email)).length > 0) result.outstanding.push(s.name);
      }
      // Completed only when an erase path really ran and nothing is outstanding.
      result.status = result.outstanding.length === 0 && Object.keys(result.erased).length > 0 ? 'completed' : 'processing';
    }
  } else {
    result.note = 'Rectification needs a person to correct the record; the request stays in processing.';
  }

  const now = new Date();
  const [updated] = await db.update(dataSubjectRequests).set({
    status: result.status,
    processedByUserId: actor.ref,
    processedAt: result.status === 'completed' ? now : null,
    executionResult: JSON.stringify(result),
    updatedAt: now,
  }).where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).returning();

  await recordGovernanceMutation(env, db, {
    actor, tenantId: scope.tenantId, segmentId: scope.segmentId, entity: 'dsr', entityId: dsrId, action: 'execute',
    before: dsr, after: updated ?? null, note: { disposition, status: result.status, suppressionAdded: result.suppressionAdded },
  });
  return { ok: true, result };
}

export const parseDsrExecutionResult = (raw: string | null): DsrExecutionResult | null => {
  if (!raw) return null;
  try { return JSON.parse(raw) as DsrExecutionResult; } catch { return null; }
};

/**
 * A manager confirms the subject actually received what was prepared. The ONLY way an export request
 * becomes `completed`. Audited as its own action; refused until the request has been executed.
 */
export async function markDsrDelivered(
  env: Env | undefined, db: Db, scope: SegmentScope, dsrId: string, actor: ActorIdentity,
  bucket?: R2Bucket,
): Promise<{ ok: true; result: DsrExecutionResult } | { ok: false; status: 404 | 409; error: string }> {
  const [dsr] = await db.select().from(dataSubjectRequests)
    .where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).limit(1);
  if (!dsr) return { ok: false, status: 404, error: 'request not found' };
  const prior = parseDsrExecutionResult(dsr.executionResult);
  if (!prior) return { ok: false, status: 409, error: 'the request has not been executed yet' };
  if (dsr.status === 'completed') return { ok: false, status: 409, error: 'request is already completed' };

  const now = new Date();
  // Delivered: the personal-data export has served its purpose, so it is DELETED, not left in storage.
  let exportKey = prior.exportKey;
  if (exportKey && (await deletePrivateObject(bucket, exportKey, scope.tenantId))) exportKey = null;
  const result: DsrExecutionResult = { ...prior, status: 'completed', deliveredAt: now.toISOString(), exportKey };
  const [updated] = await db.update(dataSubjectRequests).set({
    status: 'completed', processedByUserId: actor.ref, processedAt: now, executionResult: JSON.stringify(result), updatedAt: now,
  }).where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).returning();
  await recordGovernanceMutation(env, db, {
    actor, tenantId: scope.tenantId, segmentId: scope.segmentId, entity: 'dsr', entityId: dsrId, action: 'deliver',
    before: dsr, after: updated ?? null,
  });
  return { ok: true, result };
}

/**
 * A manager records that the subject's identity has been verified. The ONLY way `verified_at` gets set:
 * the tracker cannot write it (so it cannot be backdated or forged in a PATCH). Moves a request that was
 * waiting on identity to `pending`; audited. Idempotent - a second call keeps the first timestamp.
 */
export async function verifyDsrIdentity(
  env: Env | undefined, db: Db, scope: SegmentScope, dsrId: string, actor: ActorIdentity,
): Promise<{ ok: true; verifiedAt: string; alreadyVerified: boolean } | { ok: false; status: 404; error: string }> {
  const [dsr] = await db.select().from(dataSubjectRequests)
    .where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).limit(1);
  if (!dsr) return { ok: false, status: 404, error: 'request not found' };
  if (dsr.verifiedAt) return { ok: true, verifiedAt: dsr.verifiedAt.toISOString(), alreadyVerified: true };

  const now = new Date();
  const [updated] = await db.update(dataSubjectRequests).set({
    verifiedAt: now, updatedAt: now,
    ...(dsr.status === 'verifying_identity' ? { status: 'pending' } : {}),
  }).where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).returning();
  await recordGovernanceMutation(env, db, {
    actor, tenantId: scope.tenantId, segmentId: scope.segmentId, entity: 'dsr', entityId: dsrId, action: 'update',
    before: dsr, after: updated ?? null, note: { verifiedIdentity: true },
  });
  return { ok: true, verifiedAt: now.toISOString(), alreadyVerified: false };
}

/**
 * What the `/dsr` tracker may NOT do by hand: the execution lifecycle belongs to the execute / deliver /
 * verify-identity actions (each audited), so a PATCH or POST cannot mark a request fulfilled or stamp the
 * identity check. Returns the refusal reason, or null to allow. PURE.
 */
export function guardDsrTrackerWrite(
  _op: 'create' | 'update' | 'delete', _row: Record<string, unknown>, patch: Record<string, unknown> | null,
): string | null {
  if (!patch) return null;
  if ('verifiedAt' in patch) return 'Identity verification is recorded with the verify-identity action, not edited by hand.';
  const status = typeof patch.status === 'string' ? patch.status.toLowerCase() : '';
  if (status === 'completed' || status === 'fulfilled') {
    return 'A request is completed by executing it (and, for an export, marking it delivered), not by editing its status.';
  }
  return null;
}

/** The storage key of a request's persisted export, scoped to the segment; null when there is none. */
export async function dsrExportKey(db: Db, scope: SegmentScope, dsrId: string): Promise<string | null> {
  const [dsr] = await db.select({ executionResult: dataSubjectRequests.executionResult }).from(dataSubjectRequests)
    .where(scopedToSegment(dataSubjectRequests, scope.tenantId, scope.segmentId, eq(dataSubjectRequests.id, dsrId))).limit(1);
  return parseDsrExecutionResult(dsr?.executionResult ?? null)?.exportKey ?? null;
}
