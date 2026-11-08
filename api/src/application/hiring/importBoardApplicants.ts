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
 * board's posting id, its order, and optionally a cursor param). The call goes through
 * `executeConnectorAction` — credentialled, SSRF-guarded, audited — and each item is read
 * by `mapApplicant`. Adding a board's import is a manifest edit.
 *
 * ── GUARDED ──────────────────────────────────────────────────────────────────────
 * Every item that names the job it is for (`postingIdField`) is compared to this
 * publication's job. A board that ignores the filter param and answers with everyone's
 * applicants would otherwise import other requisitions' people onto this one; such items
 * are DROPPED and counted (`mismatched`).
 *
 * ── IDEMPOTENT ───────────────────────────────────────────────────────────────────
 * The candidate ref identifies the PERSON (`boardCandidate.ts`), and the application row
 * carries the board's application id in `external_id`, arbitrated by the 1324 partial
 * unique index, so a re-run finds the same candidate and the same application: nothing is
 * appended, and `applied_at` is not reset.
 *
 * ── PII ──────────────────────────────────────────────────────────────────────────
 * Name and email are stored only in the candidate role's `attrs` (cleared on erasure).
 * No lawful basis is asserted. An erased person is never re-admitted, under any ref they
 * could have arrived with — checked once per page, not once per applicant.
 *
 * ── BOUNDED, AND WHAT CATCHES UP ─────────────────────────────────────────────────
 * Work is bounded three ways: pages per board ({@link MAX_PAGES_PER_BOARD}), applicants
 * per board per run, and a GLOBAL applicant budget per request ({@link SWEEP_APPLICANT_BUDGET}
 * for the sweep, {@link MANUAL_APPLICANT_BUDGET} for a press of the button). All are counted
 * per ITEM, stop mid-page, and report `more`.
 *
 * A board is read by its declared ORDER, and the order decides what a capped run proves:
 *   • ASCENDING (oldest first) — everything before the newest person seen has been seen,
 *     so the cursor moves to it after EVERY run, capped or not. A backlog bigger than one
 *     run is worked off across runs. A page-less board (one `limit` per call) sets `more`
 *     on a full page and is not treated as exhausted.
 *   • DESCENDING (newest first) — a capped run has seen only the newest. The cursor may
 *     not move until a walk reaches the old cursor, so an unfinished walk saves a RESUME
 *     page and the newest person seen so far, and the next run continues from that page.
 *     A descending board with no page number cannot resume: it re-reads its newest
 *     `limit` every run, sets `more` when that page is full, and is caught up only when
 *     the backlog fits in one page.
 *   • No cursor declared — every run re-reads the board's newest page(s); nothing is
 *     saved, and the result says `more` whenever a cap stopped it.
 * A person whose OWN write fails does not pin the cursor forever: the cursor advances to
 * just before the oldest such person, they are retried on later runs, and after
 * {@link QUARANTINE_AFTER} failures (counted on the publication) they are skipped.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveConnector } from '../connectors/connectorRegistry';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { mapApplicant } from '../connectors/connectorApplicantMapping';
import type { ConnectorAction, ConnectorApplicantMapping } from '../connectors/connectorManifest';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordApplication } from './applications';
import { admitBoardCandidate, boardCandidateRefs, candidateRefKey, loadRoleIndex } from './boardCandidate';
import { LIST_APPLICANTS_ACTIONS } from './postingActionKeys';
import { readPostingBoardCatalog } from './postingDistributionStore';
import {
  listPostedDistributionsForSweep,
  readPostedDistributions,
  saveImportState,
  touchPostedDistribution,
  type ImportFailures,
  type PostedDistribution,
} from './postingDistributionSweepStore';
import { requirePosting } from './postingDistributionSupport';
import {
  belongsToPosting,
  cursorPosition,
  decodePending,
  encodePending,
  failurePin,
  formatPosition,
  marginOf,
  newestPosition,
  nextCursor,
  pageInput,
  type Positioned,
} from './importCursor';
import { resolveDistributionUrl, runUrlResolutionPass } from './resolveBoardUrls';

export const MAX_PAGES_PER_BOARD = 5;
/** Applicants per board per run (counted per item). */
export const MAX_APPLICANTS_PER_BOARD = 500;
/** Applicants ALL boards together may import in one scheduled sweep. */
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

/** A budget shared by every board in one request; drained per applicant. */
export interface ImportBudget { remaining: number }

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

/** The list action a manifest imports through, or null. */
export function importAction(actions: readonly ConnectorAction[]): (ConnectorAction & { applicants: ConnectorApplicantMapping }) | null {
  for (const key of LIST_APPLICANTS_ACTIONS) {
    const action = actions.find((candidate) => candidate.key === key);
    if (action?.applicants) return action as ConnectorAction & { applicants: ConnectorApplicantMapping };
  }
  return null;
}

/** The built-in boards that CAN be imported from — the sweep's worklist filter, so a board
 *  with nothing to import never spends its budget. */
export const IMPORTABLE_BOARD_KEYS: readonly string[] = HIRING_CONNECTORS
  .filter((manifest) => importAction(manifest.actions))
  .map((manifest) => manifest.key);

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
    const mapping = action.applicants;
    const pageSize = mapping.page?.size ?? mapping.limit?.size ?? 0;
    const hasPageNumber = Boolean(mapping.page);
    const descending = mapping.order === 'desc';
    // Loaded ONCE for the whole run — the source is folded against it per applicant.
    const boards = await readPostingBoardCatalog(db, row.tenantId, row.postingId, env);
    const refKey = candidateRefKey(env, row.tenantId);

    const failures: ImportFailures = { ...row.importFailures };
    const seen: Positioned[] = [];
    const failedNow: Positioned[] = [];
    const startPage = descending && hasPageNumber && row.importResumePage ? row.importResumePage : 1;
    let exhausted = false;
    let nextPage = startPage;

    pages: for (let page = startPage; page < startPage + MAX_PAGES_PER_BOARD; page += 1) {
      // Where a walk resumes if it stops on THIS page: the page itself, because it may be
      // only partly processed (re-reading it is idempotent; skipping it is not).
      nextPage = page;
      const result = await deps.execute({
        db, env,
        tenantId: row.tenantId,
        connectorKey: row.connectorKey,
        actionKey: action.key,
        input: pageInput(mapping, row.externalId, page, row.importCursor),
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
        if (run.budget.remaining <= 0 || outcome.fetched >= run.maxPerBoard) { outcome.more = true; break pages; }
        if (!applicant) continue;
        outcome.fetched += 1;
        run.budget.remaining -= 1;
        if (!belongsToPosting(mapping, item, row.externalId)) { outcome.mismatched += 1; continue; }
        seen.push(applicant);
        if ((failures[applicant.externalId] ?? 0) >= QUARANTINE_AFTER) { outcome.quarantined += 1; continue; }
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
      // A short page is the last one. A board with no page NUMBER reads one page per run,
      // so a FULL page there means more are waiting — it is not exhausted.
      if (pageSize && result.data.length >= pageSize) {
        if (!hasPageNumber) { outcome.more = true; break; }
        nextPage = page + 1; // this page was read to the end
        if (page === startPage + MAX_PAGES_PER_BOARD - 1) outcome.more = true;
        continue;
      }
      exhausted = true;
      break;
    }

    await persistImportState(db, row, mapping, {
      descending, hasPageNumber, exhausted, errored: outcome.error !== null, nextPage, failures, seen, failedNow,
    });
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

/** Save what the run proved (see the header) — the cursor, the resume point, the failure counts. */
async function persistImportState(
  db: Db,
  row: PostedDistribution,
  mapping: ConnectorApplicantMapping,
  run: {
    descending: boolean; hasPageNumber: boolean; exhausted: boolean; errored: boolean; nextPage: number;
    failures: ImportFailures; seen: readonly Positioned[]; failedNow: readonly Positioned[];
  },
): Promise<void> {
  const stored = cursorPosition(mapping, row.importCursor);
  let cursor: string | undefined;
  let resumePage: number | null = null;
  let pendingCursor: string | null = null;

  if (mapping.cursorParam && !run.descending) {
    // ASCENDING: everything before the newest person seen has been seen, so the cursor
    // moves after every run — capped, errored or not — but never backwards.
    const next = nextCursor(mapping, run.seen, run.failedNow);
    if (next !== null && (stored === null || cursorPosition(mapping, next)! > stored)) cursor = next;
  } else if (mapping.cursorParam) {
    // DESCENDING: only a walk that reached the end may move the cursor; until then it
    // carries the newest person seen and the first failure's pin to the next run.
    const before = decodePending(row.importPendingCursor);
    const newest = [before.newest, newestPosition(mapping, run.seen)].reduce<number | null>(
      (best, value) => (value === null ? best : best === null ? value : Math.max(best, value)), null);
    const thisPin = failurePin(mapping, run.failedNow);
    const pin = thisPin === 'blocked' ? 0
      : [before.pin, thisPin].reduce<number | null>((low, value) => (value === null ? low : low === null ? value : Math.min(low, value)), null);
    if (run.exhausted && !run.errored) {
      if (newest !== null) {
        const candidate = Math.min(newest - marginOf(mapping), pin ?? Number.POSITIVE_INFINITY);
        if (stored === null || candidate > stored) cursor = formatPosition(mapping, candidate);
      }
    } else if (run.hasPageNumber && !run.errored) {
      resumePage = run.nextPage;
      pendingCursor = encodePending(newest, pin);
    } else if (!run.errored) {
      // No page number to resume from: the next run starts over, and nothing is carried.
      pendingCursor = null;
    } else {
      // An error keeps the walk where it was.
      resumePage = row.importResumePage;
      pendingCursor = row.importPendingCursor;
    }
  }

  const unchanged = cursor === undefined
    && resumePage === row.importResumePage
    && pendingCursor === row.importPendingCursor
    && JSON.stringify(run.failures) === JSON.stringify(row.importFailures);
  if (unchanged) return;
  await saveImportState(db, row, { ...(cursor !== undefined ? { cursor } : {}), resumePage, pendingCursor, failures: run.failures });
}

/**
 * Import applicants for every board a posting is confirmed live on.
 *
 * `postingId` is verified to belong to the tenant first (a 404 otherwise), so the route
 * can pass what the caller sent. The request shares ONE budget of
 * {@link MANUAL_APPLICANT_BUDGET} applicants across its boards; a board the budget did not
 * reach is reported `more`, not silently dropped. Link-finding is bounded to
 * {@link MAX_MANUAL_URL_RESOLUTIONS} rows — the scheduled pass handles the rest.
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
  const budget: ImportBudget = { remaining: MANUAL_APPLICANT_BUDGET };
  const boards: BoardImportOutcome[] = [];
  let resolutions = 0;
  for (const row of rows) {
    if (budget.remaining <= 0) {
      boards.push({ ...emptyOutcome(row.connectorKey), more: true });
      continue;
    }
    // Touched FIRST: a crash mid-import must not leave this row at the front of the queue.
    await touchPostedDistribution(db, row);
    // A press of "Import" is also a chance to find a link the create call could not give.
    if (!row.url && resolutions < MAX_MANUAL_URL_RESOLUTIONS) {
      resolutions += 1;
      await resolveDistributionUrl(db, env, row, undefined, 'user');
    }
    boards.push(await importFromDistribution(db, env, row, { budget, maxPerBoard: MANUAL_APPLICANT_BUDGET, actorKind: 'user' }, deps));
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
  /** True when the sweep's applicant budget ran out before its worklist did. */
  more: boolean;
}

/** The scheduled import: one bounded, rotating batch across workspaces, under ONE global
 *  applicant budget, then the lightweight pass that finds links for confirmed rows without one. */
export async function runApplicantImportSweep(db: Db, env: Env, deps: ImportDeps = DEFAULT_DEPS): Promise<ImportSweepResult> {
  const result: ImportSweepResult = { checked: 0, imported: 0, failed: 0, linked: 0, more: false };
  const budget: ImportBudget = { remaining: SWEEP_APPLICANT_BUDGET };
  const rows = await listPostedDistributionsForSweep(db, MAX_DISTRIBUTIONS_PER_SWEEP, { connectorKeys: IMPORTABLE_BOARD_KEYS });
  for (const row of rows) {
    // Out of budget: stop cleanly. The untouched rows are still at the front of the queue.
    if (budget.remaining <= 0) { result.more = true; break; }
    // Rotate FIRST, whatever happens next: a row that crashes the run, or keeps failing,
    // is already at the back of the queue and cannot starve the others.
    await touchPostedDistribution(db, row);
    const outcome = await importFromDistribution(db, env, row, { budget, maxPerBoard: MAX_APPLICANTS_PER_BOARD, actorKind: 'system' }, deps);
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
