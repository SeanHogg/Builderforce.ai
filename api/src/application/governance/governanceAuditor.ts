/**
 * governanceAuditor — the scheduled governance-auditor sweep (PRD 08 §10): the second pair of eyes
 * on the DevSecOps layer, checking that the automation actually ran.
 *
 * It raises two kinds of GAP into `governance_audit_gaps` (migration 1322), which the SOC 2 page
 * shows next to the evidence:
 *
 *   merged_pr_unscanned   a pull request merged in the last 90 days with no COMPLETED secret/SAST scan
 *   merged_pr_unreviewed  ... with no COMPLETED security review
 *   control_no_evidence   an in-scope SOC 2 control with no evidence in the last 90 days
 *
 * A gap's `detail` is DATA only (`PR #12`, `CC8.1`) - the page words the gap in the viewer's language.
 * A gap is an open question, not evidence, so it is kept out of `soc_evidence` (the evidence export
 * would otherwise hand an auditor a gap as proof). The sweep is IDEMPOTENT and SELF-HEALING: one row
 * per (segment, gap type, subject); a closed gap is marked `resolved` (evidence arrived, the scan was
 * run late) and a recurring one is reopened, so the page always shows the current set.
 *
 * Set-based on purpose: one statement per gap type across every tenant, capped, rather than a loop of
 * per-tenant round trips (every statement is a Neon round trip). Tenancy is carried by the rows
 * themselves: a gap is written under the PR's / control's own (tenant, segment).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { resultRows } from '../kernel/metricRollup';
import { DAY_MS } from '../../domain/shared/time';
import { purgeStaleDsrExports } from './dsrExportPurge';

export const AUDITOR_WINDOW_DAYS = 90;
/** Per-statement cap — a backlog drains over successive sweeps instead of one unbounded write. */
export const AUDITOR_BATCH_CAP = 500;

export const GAP_TYPES = ['merged_pr_unscanned', 'merged_pr_unreviewed', 'control_no_evidence'] as const;
export type GovernanceGapType = (typeof GAP_TYPES)[number];

export interface GovernanceAuditorResult {
  opened: Record<GovernanceGapType, number>;
  resolved: number;
  /** Undelivered data-subject exports older than the retention window that were deleted from storage. */
  exportsPurged: number;
}

/** One gap statement: select candidate subjects, upsert them open, reopening a resolved one. */
async function raise(db: Db, candidates: ReturnType<typeof sql>): Promise<number> {
  const rows = resultRows(await db.execute(sql`
    INSERT INTO governance_audit_gaps (tenant_id, segment_id, gap_type, subject_ref, control_id, detail)
    ${candidates}
    ON CONFLICT (tenant_id, segment_id, gap_type, subject_ref) DO UPDATE
      SET status = 'open', resolved_at = NULL, detected_at = NOW(), updated_at = NOW()
      WHERE governance_audit_gaps.status = 'resolved'
    RETURNING id
  `));
  return rows.length;
}

export async function runGovernanceAuditor(db: Db, now: Date = new Date(), uploads?: R2Bucket): Promise<GovernanceAuditorResult> {
  const cutoff = new Date(now.getTime() - AUDITOR_WINDOW_DAYS * DAY_MS).toISOString();

  const unscanned = await raise(db, sql`
    SELECT pr.tenant_id, pr.segment_id, 'merged_pr_unscanned', pr.id::text, NULL::uuid,
           'PR #' || COALESCE(pr.number::text, '?')
      FROM pull_requests pr
     WHERE pr.status = 'merged' AND pr.segment_id IS NOT NULL AND pr.merged_at > ${cutoff}
       AND NOT EXISTS (SELECT 1 FROM vulnerability_scans s
                        WHERE s.pull_request_id = pr.id AND s.scan_type IN ('SECRET', 'SAST') AND s.status = 'completed')
       AND NOT EXISTS (SELECT 1 FROM governance_audit_gaps g
                        WHERE g.tenant_id = pr.tenant_id AND g.segment_id = pr.segment_id
                          AND g.gap_type = 'merged_pr_unscanned' AND g.subject_ref = pr.id::text AND g.status = 'open')
     LIMIT ${AUDITOR_BATCH_CAP}
  `);

  const unreviewed = await raise(db, sql`
    SELECT pr.tenant_id, pr.segment_id, 'merged_pr_unreviewed', pr.id::text, NULL::uuid,
           'PR #' || COALESCE(pr.number::text, '?')
      FROM pull_requests pr
     WHERE pr.status = 'merged' AND pr.segment_id IS NOT NULL AND pr.merged_at > ${cutoff}
       AND NOT EXISTS (SELECT 1 FROM vulnerability_scans s
                        WHERE s.pull_request_id = pr.id AND s.scan_type = 'REVIEW' AND s.status = 'completed')
       AND NOT EXISTS (SELECT 1 FROM governance_audit_gaps g
                        WHERE g.tenant_id = pr.tenant_id AND g.segment_id = pr.segment_id
                          AND g.gap_type = 'merged_pr_unreviewed' AND g.subject_ref = pr.id::text AND g.status = 'open')
     LIMIT ${AUDITOR_BATCH_CAP}
  `);

  const noEvidence = await raise(db, sql`
    SELECT c.tenant_id, c.segment_id, 'control_no_evidence', c.id::text, c.id,
           c.control_ref
      FROM soc_controls c
     WHERE c.status <> 'out_of_scope' AND c.segment_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM soc_evidence e WHERE e.control_id = c.id AND e.created_at > ${cutoff})
       AND NOT EXISTS (SELECT 1 FROM governance_audit_gaps g
                        WHERE g.tenant_id = c.tenant_id AND g.segment_id = c.segment_id
                          AND g.gap_type = 'control_no_evidence' AND g.subject_ref = c.id::text AND g.status = 'open')
     LIMIT ${AUDITOR_BATCH_CAP}
  `);

  // Close what no longer holds: the scan/review arrived late, or evidence was attached.
  const closed = resultRows(await db.execute(sql`
    UPDATE governance_audit_gaps g SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE g.status = 'open' AND (
       (g.gap_type = 'merged_pr_unscanned' AND EXISTS (SELECT 1 FROM vulnerability_scans s
          WHERE s.pull_request_id::text = g.subject_ref AND s.scan_type IN ('SECRET', 'SAST') AND s.status = 'completed'))
       OR (g.gap_type = 'merged_pr_unreviewed' AND EXISTS (SELECT 1 FROM vulnerability_scans s
          WHERE s.pull_request_id::text = g.subject_ref AND s.scan_type = 'REVIEW' AND s.status = 'completed'))
       OR (g.gap_type = 'control_no_evidence' AND EXISTS (SELECT 1 FROM soc_evidence e
          WHERE e.control_id = g.control_id AND e.created_at > ${cutoff}))
     )
    RETURNING g.id
  `));

  // Personal data is not kept indefinitely: an export nobody marked delivered expires.
  const exportsPurged = await purgeStaleDsrExports(db, uploads, now);

  return {
    opened: { merged_pr_unscanned: unscanned, merged_pr_unreviewed: unreviewed, control_no_evidence: noEvidence },
    resolved: closed.length,
    exportsPurged,
  };
}
