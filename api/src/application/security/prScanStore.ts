/**
 * prScanStore — the `vulnerability_scans` rows that belong to a pull request.
 *
 * One scan row per (pull request, scan type): `SECRET`, `SAST`, `SCA`, `REVIEW`. Re-running the
 * step for the same PR (a retried finalize, a re-scan after a push) REUSES the row, so a PR never
 * accumulates duplicate scans and the findings' `(scan_id, fingerprint)` uniqueness keeps ingestion
 * idempotent. A scan that could not run is recorded as `skipped` / `failed` WITH its reason in
 * `notes` — never left absent, because an absent scan reads as a clean bill of health.
 *
 * Every create is written to the governance mutation-audit envelope.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { vulnerabilityScans } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ActorIdentity } from '../activity/activityLog';
import { recordGovernanceMutation } from '../governance/mutationAudit';

/** Upper-case, matching the scan-type vocabulary of the /vuln-scans tracker (SAST / SCA / SECRET ...). */
export const PR_SCAN_TYPES = ['SECRET', 'SAST', 'SCA', 'REVIEW'] as const;
export type PrScanType = (typeof PR_SCAN_TYPES)[number];

/** Terminal states a PR scan row ends in besides `completed` (set by `ingestScanFindings`). */
export type PrScanEnd = 'skipped' | 'failed';

export interface PrScanScope {
  tenantId: number;
  segmentId: string | null;
  /** The recorded PR; null for a repo/branch scan started by hand (`POST /vuln-scans/run`). */
  pullRequestId: string | null;
  executionId: number | null;
  repoRef: string;
  ref: string;
  triggeredBy: string;
  /** The PR head commit being scanned. Scan rows are keyed on (PR, type, headSha): a push is a new
   *  commit and gets new rows, so the gate can never match old results to new code. Null only for a
   *  hand-started branch scan with no PR. */
  headSha: string | null;
}

export interface PrScanRow { id: string; segmentId: string | null; reused: boolean }

/** Find or create the scan row for (pull request, type); returns its id and resolved segment. */
export async function ensurePrScan(
  env: Env, db: Db, actor: ActorIdentity, scope: PrScanScope, scanType: PrScanType,
): Promise<PrScanRow> {
  const find = async () => (await db
    .select({ id: vulnerabilityScans.id, segmentId: vulnerabilityScans.segmentId })
    .from(vulnerabilityScans)
    .where(and(
      eq(vulnerabilityScans.tenantId, scope.tenantId),
      scope.pullRequestId
        ? eq(vulnerabilityScans.pullRequestId, scope.pullRequestId)
        : and(isNull(vulnerabilityScans.pullRequestId), eq(vulnerabilityScans.repoRef, scope.repoRef.slice(0, 255)), eq(vulnerabilityScans.ref, scope.ref.slice(0, 255)), scope.segmentId ? eq(vulnerabilityScans.segmentId, scope.segmentId) : undefined),
      eq(vulnerabilityScans.scanType, scanType),
      scope.headSha ? eq(vulnerabilityScans.headSha, scope.headSha) : undefined,
    ))
    .limit(1))[0];
  let existing = await find();
  const now = new Date();
  if (!existing) {
    // Creation is race-safe: the unique index (pull_request_id, head_sha, scan_type) is the arbiter, so
    // two finalizes that both found no row cannot both insert one. The loser re-reads the winner's row.
    const [created] = await db.insert(vulnerabilityScans).values({
      tenantId: scope.tenantId,
      segmentId: scope.segmentId,
      pullRequestId: scope.pullRequestId,
      executionId: scope.executionId,
      headSha: scope.headSha,
      repoRef: scope.repoRef.slice(0, 255),
      ref: scope.ref.slice(0, 255),
      scanType,
      status: 'running',
      triggeredBy: scope.triggeredBy.slice(0, 64),
      startedAt: now,
    }).onConflictDoNothing({
      target: [vulnerabilityScans.pullRequestId, vulnerabilityScans.headSha, vulnerabilityScans.scanType],
      where: sql`pull_request_id IS NOT NULL`,
    }).returning({ id: vulnerabilityScans.id, segmentId: vulnerabilityScans.segmentId });
    if (created) {
      await recordGovernanceMutation(env, db, {
        actor, tenantId: scope.tenantId, segmentId: created.segmentId, entity: 'vuln-scans', entityId: created.id, action: 'create',
        after: { scanType, pullRequestId: scope.pullRequestId, executionId: scope.executionId, ref: scope.ref },
      });
      return { id: created.id, segmentId: created.segmentId, reused: false };
    }
    existing = await find();
    if (!existing) throw new Error('vulnerability scan could neither be created nor found');
  }
  if (existing) {
    // A re-scan of the SAME commit (a retried finalize). The row goes back to 'running' - which the
    // gate reads as pending, so nothing merges mid-scan - but its OPEN findings are NOT deleted here:
    // `ingestScanFindings({ replaceOpen: true })` swaps them for the new set in one transaction, so there
    // is never a moment with the old blockers gone and the new ones not yet written.
    await db.update(vulnerabilityScans)
      .set({ status: 'running', truncated: false, startedAt: now, finishedAt: null, notes: null, updatedAt: now })
      .where(scopedToTenant(vulnerabilityScans, scope.tenantId, eq(vulnerabilityScans.id, existing.id)));
    return { id: existing.id, segmentId: existing.segmentId, reused: true };
  }
  throw new Error('unreachable: a scan row exists or was created above');
}

/** Close a scan that produced no findings list: it was skipped or it failed, and says why. */
export async function endPrScan(
  db: Db, tenantId: number, scanId: string, end: PrScanEnd | 'completed', reason: string | null, truncated = false,
): Promise<void> {
  const now = new Date();
  await db.update(vulnerabilityScans)
    .set({ status: end, truncated, finishedAt: now, updatedAt: now, notes: reason ? reason.slice(0, 2_000) : null })
    .where(scopedToTenant(vulnerabilityScans, tenantId, eq(vulnerabilityScans.id, scanId)));
}
