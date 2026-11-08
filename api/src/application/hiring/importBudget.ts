/**
 * What one import request may spend — applicants AND database/subrequest operations.
 *
 * A Cloudflare Worker invocation is limited to 1000 subrequests, and every database query
 * (Neon over HTTP), KV operation and outbound fetch counts. Budgeting only APPLICANTS hid
 * the real limit: one new applicant is several writes, so 500 of them is thousands of
 * queries and the invocation dies half-way through a page. The budget therefore carries a
 * second counter, `queries`, drained by the work actually done; when it runs out the run
 * stops cleanly and reports `more`, exactly as an exhausted applicant budget does.
 *
 * THE ARITHMETIC (worst case, per unit of work):
 *   • per APPLICANT {@link QUERIES_PER_APPLICANT} = 8: candidate role insert 1, up to two
 *     alias inserts 2, application upsert 1, open-entries read 1, pipeline-entry insert 1,
 *     pipeline cache invalidation (KV) 1 — plus 1 spare for the retry-on-person-collision path
 *     that replaces the role insert and the pipeline insert (so 8 bounds both paths);
 *   • per PAGE {@link QUERIES_PER_PAGE} = 6: the board call 1, its audit row 1, the
 *     connection lookup 1–2, the connection freshness touch 1, the page's role index 1;
 *   • per ROW {@link QUERIES_PER_ROW} = 14: rotation touch 1, connector resolve 2, board
 *     catalog 2, candidate-ref salt 1, filter-id lookup (connection 2 + call 2 + save 1) 5,
 *     state save 1.
 *
 * THE SWEEP: {@link SWEEP_QUERY_BUDGET} 700 for the import, plus the worklist (a page of
 * rows 1, the tenant-board listing 1, at most {@link MAX_WORKLIST_TENANTS} cached catalogs
 * × 3 = 75), plus the link-finding pass (`MAX_URL_RESOLUTIONS_PER_SWEEP` 20 rows × 6 =
 * 120): 700 + 77 + 120 = 897 < 1000.
 * THE MANUAL PRESS: {@link MANUAL_QUERY_BUDGET} 900, plus posting check 1, rows 1, up to
 * `MAX_MANUAL_URL_RESOLUTIONS` 3 × 6 = 18 and the rotation touches ≤ 10: 900 + 30 = 930.
 * `MANUAL_APPLICANT_BUDGET` (100) × 8 = 800 fits inside it, so the applicant cap, not the
 * query cap, is what a person normally meets.
 *
 * A budget with no `queries` (a test, a caller that does not care) is unlimited on that axis.
 */

export interface ImportBudget {
  /** Applicants this request may still process, across every board. */
  remaining: number;
  /** Database / KV / fetch operations this request may still spend; absent ⇒ unlimited. */
  queries?: number;
}

/** Failure counts kept on a publication (`import_failures`); see `pruneFailures`. Lives
 *  here, a leaf, so both the pure cursor arithmetic and the store can share it. */
export const MAX_TRACKED_FAILURES = 50;

export const QUERIES_PER_APPLICANT = 8;
export const QUERIES_PER_PAGE = 6;
export const QUERIES_PER_ROW = 14;
export const SWEEP_QUERY_BUDGET = 700;
export const MANUAL_QUERY_BUDGET = 900;
/** Tenants whose catalogs the sweep resolves to find their own importable boards. */
export const MAX_WORKLIST_TENANTS = 25;

/** Charge `count` operations to the budget. */
export function spendQueries(budget: ImportBudget, count: number): void {
  if (budget.queries !== undefined) budget.queries -= count;
}

/** True once the budget cannot cover another unit of `count` operations. */
export function cannotAfford(budget: ImportBudget, count: number): boolean {
  return budget.queries !== undefined && budget.queries < count;
}
