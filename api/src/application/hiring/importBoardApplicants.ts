/**
 * Pull the people a job board delivered into the ATS — the two ways it is started.
 *
 * `importDistribution.ts` runs ONE publication (its header explains what the import
 * guarantees: one code path, guarded, idempotent, bounded, and why ascending and descending
 * boards differ). This file decides WHICH publications to visit and under what budget:
 *   • {@link importBoardApplicants} — a person pressed "Import" on a posting: that posting's
 *     boards, under a small shared budget, and a chance to find a link the create call
 *     could not give;
 *   • {@link runApplicantImportSweep} — the scheduler: one bounded, rotating batch across
 *     workspaces under ONE global applicant and query budget.
 *
 * EVERY visit takes the row's LEASE first (`touchPostedDistribution`): the row is rotated to
 * the back of the queue, and the import is handed the row as it stood AT THAT MOMENT — not
 * the batch snapshot read earlier, which a newer press of the button may already have
 * superseded. Its saved state is written only while that lease still stands.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  readPostedDistribution,
  readPostedDistributions,
  touchPostedDistribution,
  type PostedDistribution,
} from './postingDistributionSweepStore';
import { requirePosting } from './postingDistributionSupport';
import {
  QUERIES_PER_ROW,
  MANUAL_QUERY_BUDGET,
  SWEEP_QUERY_BUDGET,
  cannotAfford,
  type ImportBudget,
} from './importBudget';
import {
  DEFAULT_IMPORT_DEPS,
  emptyOutcome,
  importFromDistribution,
  type BoardImportOutcome,
  type ImportDeps,
} from './importDistribution';
import { listImportWorklist } from './importWorklist';
import { resolveDistributionUrl, runUrlResolutionPass } from './resolveBoardUrls';

export type { ImportBudget };

/** Applicants per board per run (counted per item). */
export const MAX_APPLICANTS_PER_BOARD = 500;
/** Applicants ALL boards together may import in one scheduled sweep (the query budget bites first). */
export const SWEEP_APPLICANT_BUDGET = 500;
/** Applicants ALL boards together may import in one press of the button — a person is waiting. */
export const MANUAL_APPLICANT_BUDGET = 100;
/** Distributions one scheduled sweep considers. */
export const MAX_DISTRIBUTIONS_PER_SWEEP = 60;
/** Rows a press of the button will try to find a link for; the sweep's pass does the rest. */
export const MAX_MANUAL_URL_RESOLUTIONS = 3;

export interface ImportBoardApplicantsResult {
  boards: BoardImportOutcome[];
  imported: number;
  /** True when any board stopped at a cap or the request's budget — "more pending". */
  more: boolean;
}

/**
 * Rotate the row to the back of the queue and take the lease its saved state is checked
 * against. The returned row is the FRESH one the touch wrote (null: the row is gone), so
 * the import never runs on a snapshot older than its lease.
 */
async function lease(db: Db, row: PostedDistribution): Promise<PostedDistribution | null> {
  return touchPostedDistribution(db, row);
}

/**
 * Import applicants for every board a posting is confirmed live on.
 *
 * `postingId` is verified to belong to the tenant first (a 404 otherwise), so the route
 * can pass what the caller sent. The request shares ONE budget of
 * {@link MANUAL_APPLICANT_BUDGET} applicants (and {@link MANUAL_QUERY_BUDGET} operations)
 * across its boards; a board the budget did not reach is reported `more`, not silently
 * dropped. Link-finding is bounded to {@link MAX_MANUAL_URL_RESOLUTIONS} rows — the
 * scheduled pass handles the rest.
 */
export async function importBoardApplicants(
  db: Db,
  env: Env,
  tenantId: number,
  postingId: string,
  deps: ImportDeps = DEFAULT_IMPORT_DEPS,
): Promise<ImportBoardApplicantsResult> {
  await requirePosting(db, tenantId, postingId); // 404s for a posting this workspace does not own
  const rows = await readPostedDistributions(db, tenantId, postingId);
  const budget: ImportBudget = { remaining: MANUAL_APPLICANT_BUDGET, queries: MANUAL_QUERY_BUDGET };
  const boards: BoardImportOutcome[] = [];
  let resolutions = 0;
  for (const row of rows) {
    if (budget.remaining <= 0 || cannotAfford(budget, QUERIES_PER_ROW)) {
      boards.push({ ...emptyOutcome(row.connectorKey), more: true });
      continue;
    }
    // Touched FIRST: a crash mid-import must not leave this row at the front of the queue.
    const leased = await lease(db, row);
    if (!leased) continue; // the publication is gone since it was listed
    let target = leased;
    // A press of "Import" is also a chance to find a link the create call could not give.
    // Finding one REPLACES `external_id` and clears `board_filter_id`, so the row is re-read
    // before it is imported (the lease it holds is kept: the re-read is not a new touch).
    if (!row.url && resolutions < MAX_MANUAL_URL_RESOLUTIONS) {
      resolutions += 1;
      if (await resolveDistributionUrl(db, env, leased, undefined, 'user') === 'linked') {
        const fresh = await readPostedDistribution(db, leased);
        if (!fresh) continue;
        target = { ...fresh, importLease: leased.importLease };
      }
    }
    boards.push(await importFromDistribution(db, env, target, { budget, maxPerBoard: MANUAL_APPLICANT_BUDGET, actorKind: 'user' }, deps));
  }
  return {
    boards,
    imported: boards.reduce((sum, board) => sum + board.imported, 0),
    more: boards.some((board) => board.more),
  };
}

export interface ImportSweepResult {
  checked: number;
  imported: number;
  failed: number;
  /** Public links found for published rows that had none (the pass after the import). */
  linked: number;
  /** True when the sweep's applicant or query budget ran out before its worklist did. */
  more: boolean;
}

/** The scheduled import: one bounded, rotating batch across workspaces, under ONE global
 *  applicant and query budget, then the lightweight pass that finds links for confirmed rows without one. */
export async function runApplicantImportSweep(db: Db, env: Env, deps: ImportDeps = DEFAULT_IMPORT_DEPS): Promise<ImportSweepResult> {
  const result: ImportSweepResult = { checked: 0, imported: 0, failed: 0, linked: 0, more: false };
  const budget: ImportBudget = { remaining: SWEEP_APPLICANT_BUDGET, queries: SWEEP_QUERY_BUDGET };
  const rows = await listImportWorklist(db, env, MAX_DISTRIBUTIONS_PER_SWEEP);
  for (const row of rows) {
    // Out of budget: stop cleanly. The untouched rows are still at the front of the queue.
    if (budget.remaining <= 0 || cannotAfford(budget, QUERIES_PER_ROW)) { result.more = true; break; }
    // Rotate FIRST, whatever happens next: a row that crashes the run, or keeps failing,
    // is already at the back of the queue and cannot starve the others.
    const leased = await lease(db, row);
    if (!leased) continue;
    const outcome = await importFromDistribution(db, env, leased, { budget, maxPerBoard: MAX_APPLICANTS_PER_BOARD, actorKind: 'system' }, deps);
    if (outcome.unsupported) continue;
    result.checked += 1;
    result.imported += outcome.imported;
    if (outcome.more) result.more = true;
    if (outcome.error || outcome.failedApplicants > 0) result.failed += 1;
  }
  result.linked = (await runUrlResolutionPass(db, env)).linked;
  return result;
}

export function describeApplicantImportSweep(result: ImportSweepResult): string | null {
  if (result.checked === 0 && result.linked === 0) return null;
  return `boards=${result.checked} imported=${result.imported} failed=${result.failed} linked=${result.linked}${result.more ? ' more=1' : ''}`;
}
