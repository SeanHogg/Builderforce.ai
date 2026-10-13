/**
 * The daily `proof-verdicts` sweep (PRD 33 §5.3.2): every live, measured, ungraded
 * proof is synced once, so a proof whose window closed overnight is graded at its
 * window's end even when nobody opens it. The sync itself decides — this only finds
 * the candidates (across workspaces, a declared scheduled sweep) and isolates each
 * one, so one bad proof never stops the rest.
 */

import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { realizations } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { syncRealizationVerdict } from './realizationVerdict';

/** Most proofs one run syncs; the oldest first, so a backlog drains in order. */
export const PROOF_SWEEP_LIMIT = 500;

export interface ProofVerdictSweepResult {
  checked: number;
  graded: number;
  failed: number;
}

export async function runProofVerdictSweep(env: Env, db: Db, now: Date = new Date()): Promise<ProofVerdictSweepResult> {
  const rows = await db
    .select()
    .from(realizations)
    .where(acrossTenants(realizations, 'scheduled_sweep', and(
      eq(realizations.status, 'built'),
      isNotNull(realizations.projectId),
      isNotNull(realizations.measure),
      isNull(realizations.verdict),
    )))
    .orderBy(asc(realizations.createdAt))
    .limit(PROOF_SWEEP_LIMIT);

  const result: ProofVerdictSweepResult = { checked: rows.length, graded: 0, failed: 0 };
  for (const row of rows) {
    try {
      const synced = await syncRealizationVerdict(env, db, row.tenantId, row, { now });
      if (synced.verdict === 'met' || synced.verdict === 'missed') result.graded += 1;
    } catch (error) {
      result.failed += 1;
      reportCaughtError(error, { source: 'application/realization/proofVerdictSweep.ts', operation: 'sync', context: { realizationId: row.id } });
    }
  }
  return result;
}
