/**
 * Pull the people a job board delivered into the ATS.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────────
 * Four boards declared a "list applications" action and nothing ever called one, so a
 * posting that was live on Greenhouse showed "0 applicants" however many people applied
 * there. `job_applications` had one producer (applying on the platform); this is the
 * second, and it is the same writer — `recordApplication` — so an imported applicant is
 * on the posting's pipeline board like any other.
 *
 * ── ONE CODE PATH, NO VENDOR NAMES ───────────────────────────────────────────────
 * A board is importable when its list action declares an `applicants` mapping
 * (selectors for id / job / person id / name / email / date, the param that carries the
 * board's posting id, its order, and optionally a cursor, a paging token and a filter-id
 * lookup). The call goes through `executeConnectorAction` — credentialled, SSRF-guarded,
 * audited — and each item is read by `mapApplicant`. Adding a board's import is a manifest edit.
 *
 * ── GUARDED ──────────────────────────────────────────────────────────────────────
 * Every item that names the job it is for (`postingIdField`) is compared to the id the
 * board filters by (`importFilterId.ts`). A board that ignores the filter param and answers
 * with everyone's applicants would otherwise import other requisitions' people onto this
 * one; such items are DROPPED and counted (`mismatched`).
 *
 * ── IDEMPOTENT ───────────────────────────────────────────────────────────────────
 * The candidate ref identifies the PERSON (`boardCandidate.ts`), and the application row
 * carries the board's application id in `external_id`, arbitrated by the 1324 partial
 * unique index, so a re-run finds the same candidate and the same application: nothing is
 * appended, `applied_at` is not reset, and `updated_at` moves only if a field changed.
 *
 * ── PII ──────────────────────────────────────────────────────────────────────────
 * Name and email are stored only in the candidate role's `attrs` (cleared on erasure).
 * No lawful basis is asserted. An erased person is never re-admitted, under any ref they
 * could have arrived with — checked once per page, not once per applicant.
 *
 * ── BOUNDED, AND WHAT CATCHES UP ─────────────────────────────────────────────────
 * Work is bounded by pages per board ({@link MAX_PAGES_PER_BOARD}), applicants per board
 * per run, a GLOBAL applicant budget per request, and a QUERY budget (`importBudget.ts`,
 * which has the Worker-subrequest arithmetic). All stop mid-page and report `more`.
 *
 * A board is read by its declared ORDER, and the order decides what a capped run proves:
 *   • ASCENDING (oldest first) — everything before the newest person seen has been seen,
 *     so the cursor moves after EVERY run. If it cannot move (a whole page shares one
 *     second), the walk falls back to the board's page number / token.
 *   • DESCENDING (newest first) — a capped run has seen only the newest. The cursor may
 *     not move until a walk reaches the old cursor, so an unfinished walk saves a RESUME
 *     point (page number, or the board's own token) and the newest person seen so far.
 *     A descending board with neither re-reads its newest page every run.
 *   • No cursor declared — every run re-reads the board's newest page(s).
 * A person whose OWN write fails does not pin the cursor forever: it advances to just
 * before the oldest such person, they are retried, and after {@link QUARANTINE_AFTER}
 * failures (counted on the publication) they are skipped. `importCursor.ts` has the arithmetic.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveConnector } from '../connectors/connectorRegistry';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { mapApplicant } from '../connectors/connectorApplicantMapping';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordApplication } from './applications';
import { admitBoardCandidate, boardCandidateRefs, candidateRefKey, loadRoleIndex } from './boardCandidate';
import { readPostingBoardCatalog } from './postingDistributionStore';
import {
  readPostedDistributions,
  saveImportState,
  touchPostedDistribution,
  type ImportFailures,
  type PostedDistribution,
} from './postingDistributionSweepStore';
import { requirePosting } from './postingDistributionSupport';
import {
  QUERIES_PER_APPLICANT,
  QUERIES_PER_PAGE,
  QUERIES_PER_ROW,
  MANUAL_QUERY_BUDGET,
  SWEEP_QUERY_BUDGET,
  cannotAfford,
  spendQueries,
  type ImportBudget,
} from './importBudget';
import { belongsToPosting, nextTokenOf, pageInput, planImportState, type Positioned } from './importCursor';
import { resolveFilterId } from './importFilterId';
import { IMPORTABLE_BOARD_KEYS, importAction, listImportWorklist } from './importWorklist';
import { resolveDistributionUrl, runUrlResolutionPass } from './resolveBoardUrls';

export { IMPORTABLE_BOARD_KEYS, importAction };
export type { ImportBudget };

export const MAX_PAGES_PER_BOARD = 5;
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
/** A person whose own write has failed this many times is skipped from then on. */
export const QUARANTINE_AFTER = 3;

export interface BoardImportOutcome {
  connectorKey: string;
  /** Items the board returned and this run processed. */
  fetched: number;
  /** New applications written (existing ones are refreshed, not counted). */
  imported: number;
  /** Applicants whose own write failed — counted, never fatal to the board's run. */
  failedApplicants: number;
  /** Items dropped because they named a DIFFERENT job than this publication's. */
  mismatched: number;
  /** Items skipped because they have failed {@link QUARANTINE_AFTER} times. */
  quarantined: number;
  /** Declared-importable but nothing happened: the board has no import action. */
  unsupported: boolean;
  /** A cap or budget stopped the run before the board was exhausted: run again. */
  more: boolean;
  error: string | null;
}

export interface ImportBoardApplicantsResult {
  boards: BoardImportOutcome[];
  imported: number;
  /** True when any board stopped at a cap or the request's budget — "more pending". */
  more: boolean;
}

export interface ImportDeps {
  execute: typeof executeConnectorAction;
}
const DEFAULT_DEPS: ImportDeps = { execute: executeConnectorAction };

interface ImportRun {
  budget: ImportBudget;
  /** Applicants this run may process for ONE board. */
  maxPerBoard: number;
  /** Who the audit log says made the calls. */
  actorKind: 'user' | 'system';
}

const emptyOutcome = (connectorKey: string): BoardImportOutcome => ({
  connectorKey, fetched: 0, imported: 0, failedApplicants: 0, mismatched: 0, quarantined: 0, unsupported: false, more: false, error: null,
});

/** Rotate the row to the back of the queue and take the lease its saved state is checked against. */
async function lease(db: Db, row: PostedDistribution): Promise<PostedDistribution> {
  return { ...row, importLease: await touchPostedDistribution(db, row) };
}

// ── One publication ──────────────────────────────────────────────────────────────────

/** Import for ONE confirmed publication. Never throws: a board failing is its outcome. */
export async function importFromDistribution(
  db: Db,
  env: Env,
  row: PostedDistribution,
  run: ImportRun,
  deps: ImportDeps = DEFAULT_DEPS,
): Promise<BoardImportOutcome> {
  const outcome = emptyOutcome(row.connectorKey);
  try {
    const resolved = await resolveConnector(db, row.tenantId, row.connectorKey, env);
    const action = resolved ? importAction(resolved.manifest.actions) : null;
    if (!action) { outcome.unsupported = true; return outcome; }
    spendQueries(run.budget, QUERIES_PER_ROW);
    const mapping = action.applicants;
    const pageSize = mapping.page?.size ?? mapping.limit?.size ?? 0;
    const hasPageNumber = Boolean(mapping.page);
    const hasToken = Boolean(mapping.nextToken) && !hasPageNumber;
    const resumable = hasPageNumber || hasToken;
    const descending = mapping.order === 'desc';

    // The id the board filters by (Ashby: the job id, looked up once and cached on the row).
    const filter = await resolveFilterId(db, env, row, mapping, deps.execute, run.actorKind);
    if (!filter.ok) { outcome.error = filter.error; return outcome; }

    // Loaded ONCE for the whole run — the source is folded against it per applicant.
    const boards = await readPostingBoardCatalog(db, row.tenantId, row.postingId, env);
    const refKey = await candidateRefKey(db, row.tenantId);

    const failures: ImportFailures = { ...row.importFailures };
    const seen: Positioned[] = [];
    const failedNow: Positioned[] = [];
    // A saved resume point is only ever present when it means something (see planImportState).
    const startPage = hasPageNumber && row.importResumePage ? row.importResumePage : 1;
    let token: string | null = hasToken ? row.importResumeToken ?? null : null;
    let tokenSeen = token !== null; // a saved token proves the board hands them out
    let exhausted = false;
    let nextPage = startPage;

    pages: for (let page = startPage; page < startPage + MAX_PAGES_PER_BOARD; page += 1) {
      // Where a walk resumes if it stops on THIS page: the page itself (or the token that
      // fetched it), because it may be only partly processed — re-reading it is idempotent,
      // skipping it is not.
      nextPage = page;
      if (cannotAfford(run.budget, QUERIES_PER_PAGE)) { outcome.more = true; break; }
      spendQueries(run.budget, QUERIES_PER_PAGE);
      const result = await deps.execute({
        db, env,
        tenantId: row.tenantId,
        connectorKey: row.connectorKey,
        actionKey: action.key,
        input: pageInput(mapping, filter.id, page, row.importCursor, token),
        ...(mapping.nextToken ? { captureBodyPaths: mapping.nextToken.select } : {}),
        ...(row.connectionId ? { connectionId: row.connectionId } : {}),
        actorKind: run.actorKind,
      });
      if (!result.ok) { outcome.error = (result.error ?? `The job board answered ${result.status}.`).slice(0, 600); break; }
      if (!Array.isArray(result.data)) { outcome.error = 'The job board returned its applicants in an unexpected shape.'; break; }

      // The erased check is ONE query for the page, not one per applicant.
      const mapped = result.data.map((item) => ({ item, applicant: mapApplicant(mapping, item) }));
      const refs: string[] = [];
      for (const { applicant } of mapped) {
        if (!applicant) continue;
        refs.push(...(await boardCandidateRefs({
          boardKey: row.connectorKey, applicationId: applicant.externalId, candidateId: applicant.candidateId, email: applicant.email,
        }, refKey)).all);
      }
      const roles = await loadRoleIndex(db, row.tenantId, refs);

      for (const { item, applicant } of mapped) {
        // The caps are per ITEM: a page that would cross one is stopped mid-page.
        if (run.budget.remaining <= 0 || outcome.fetched >= run.maxPerBoard || cannotAfford(run.budget, QUERIES_PER_APPLICANT)) {
          outcome.more = true;
          break pages;
        }
        if (!applicant) continue;
        outcome.fetched += 1;
        run.budget.remaining -= 1;
        if (!belongsToPosting(mapping, item, filter.id)) { outcome.mismatched += 1; continue; }
        seen.push(applicant);
        if ((failures[applicant.externalId] ?? 0) >= QUARANTINE_AFTER) { outcome.quarantined += 1; continue; }
        spendQueries(run.budget, QUERIES_PER_APPLICANT);
        try {
          const candidate = await admitBoardCandidate(db, {
            tenantId: row.tenantId, boardKey: row.connectorKey, applicationId: applicant.externalId,
            candidateId: applicant.candidateId, email: applicant.email, name: applicant.name,
          }, refKey, roles);
          if (!candidate.admitted) continue;
          const recorded = await recordApplication(db, env, {
            tenantId: row.tenantId,
            jobPostingId: row.postingId,
            candidateRef: candidate.candidateRef,
            source: row.connectorKey,
            externalId: applicant.externalId,
            appliedAt: applicant.appliedAt,
            boards,
          });
          if (recorded.created) outcome.imported += 1;
          delete failures[applicant.externalId];
        } catch (error) {
          // One bad applicant (a constraint, a malformed field) never aborts the board.
          outcome.failedApplicants += 1;
          failures[applicant.externalId] = (failures[applicant.externalId] ?? 0) + 1;
          // The third failure quarantines them; until then they hold the cursor back.
          if (failures[applicant.externalId]! < QUARANTINE_AFTER) failedNow.push(applicant);
          if (outcome.failedApplicants === 1) {
            reportCaughtError(error, {
              source: 'application/hiring/importBoardApplicants.ts',
              operation: 'importApplicant',
              context: { tenantId: row.tenantId, connectorKey: row.connectorKey },
            });
          }
        }
      }
      // A short page is the last one. A board with no way to page reads one page per run,
      // so a FULL page there means more are waiting — it is not exhausted.
      if (pageSize && result.data.length >= pageSize) {
        if (!resumable) { outcome.more = true; break; }
        if (hasToken) {
          const next = nextTokenOf(mapping, result.bodyFields);
          if (!next) {
            // A full page and no token. If this board has given us a token in this walk, no
            // token means the last page. If it never has, "no token" may just be a field
            // that drifted — treating that as the end would move the cursor past people not
            // yet read — so it is handled like a board with nothing to resume from.
            if (!tokenSeen) { outcome.more = true; break; }
            exhausted = true;
            break;
          }
          token = next;
          tokenSeen = true;
        } else {
          nextPage = page + 1; // this page was read to the end
        }
        if (page === startPage + MAX_PAGES_PER_BOARD - 1) outcome.more = true;
        continue;
      }
      exhausted = true;
      break;
    }

    const plan = planImportState(mapping, row, {
      descending, hasPageNumber, hasToken, exhausted, errored: outcome.error !== null,
      nextPage, nextToken: token, failures, seen, failedNow,
    });
    if (plan) await saveImportState(db, row, plan);
  } catch (error) {
    outcome.error = (error instanceof Error ? error.message : 'The applicant import failed.').slice(0, 600);
    reportCaughtError(error, {
      source: 'application/hiring/importBoardApplicants.ts',
      operation: 'importFromDistribution',
      context: { tenantId: row.tenantId, connectorKey: row.connectorKey },
    });
  }
  return outcome;
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
  deps: ImportDeps = DEFAULT_DEPS,
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
    // A press of "Import" is also a chance to find a link the create call could not give.
    if (!row.url && resolutions < MAX_MANUAL_URL_RESOLUTIONS) {
      resolutions += 1;
      await resolveDistributionUrl(db, env, row, undefined, 'user');
    }
    boards.push(await importFromDistribution(db, env, leased, { budget, maxPerBoard: MANUAL_APPLICANT_BUDGET, actorKind: 'user' }, deps));
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
export async function runApplicantImportSweep(db: Db, env: Env, deps: ImportDeps = DEFAULT_DEPS): Promise<ImportSweepResult> {
  const result: ImportSweepResult = { checked: 0, imported: 0, failed: 0, linked: 0, more: false };
  const budget: ImportBudget = { remaining: SWEEP_APPLICANT_BUDGET, queries: SWEEP_QUERY_BUDGET };
  const rows = await listImportWorklist(db, env, MAX_DISTRIBUTIONS_PER_SWEEP);
  for (const row of rows) {
    // Out of budget: stop cleanly. The untouched rows are still at the front of the queue.
    if (budget.remaining <= 0 || cannotAfford(budget, QUERIES_PER_ROW)) { result.more = true; break; }
    // Rotate FIRST, whatever happens next: a row that crashes the run, or keeps failing,
    // is already at the back of the queue and cannot starve the others.
    const leased = await lease(db, row);
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
