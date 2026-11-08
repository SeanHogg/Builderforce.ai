/**
 * Pull the people ONE confirmed publication's job board delivered into the ATS.
 *
 * Split from `importBoardApplicants.ts`, which decides WHICH publications to visit (a press
 * of the button, the scheduled sweep), under what budget, and takes each row's lease. This
 * file runs one row: the calls, the writes, the cursor.
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
import { saveImportState, type ImportFailures, type PostedDistribution } from './postingDistributionSweepStore';
import {
  QUERIES_PER_APPLICANT,
  QUERIES_PER_PAGE,
  QUERIES_PER_ROW,
  cannotAfford,
  spendQueries,
  type ImportBudget,
} from './importBudget';
import {
  belongsToPosting,
  nextTokenOf,
  pageInput,
  planImportState,
  tokenCapturePaths,
  tokenListDone,
  type Positioned,
} from './importCursor';
import { resolveFilterId } from './importFilterId';
import { importAction } from './importWorklist';

export type { ImportBudget };

export const MAX_PAGES_PER_BOARD = 5;
/** A person whose own write has failed this many times is skipped from then on. */
export const QUARANTINE_AFTER = 3;
/** Statuses that mean the board refused the request itself, so a saved resume point is dead. */
const RESUME_REFUSED_STATUSES: ReadonlySet<number> = new Set([400, 404, 410, 422]);

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

export interface ImportDeps {
  execute: typeof executeConnectorAction;
}
export const DEFAULT_IMPORT_DEPS: ImportDeps = { execute: executeConnectorAction };

export interface ImportRun {
  budget: ImportBudget;
  /** Applicants this run may process for ONE board. */
  maxPerBoard: number;
  /** Who the audit log says made the calls. */
  actorKind: 'user' | 'system';
}

export const emptyOutcome = (connectorKey: string): BoardImportOutcome => ({
  connectorKey, fetched: 0, imported: 0, failedApplicants: 0, mismatched: 0, quarantined: 0, unsupported: false, more: false, error: null,
});

/** Import for ONE confirmed publication. Never throws: a board failing is its outcome. */
export async function importFromDistribution(
  db: Db,
  env: Env,
  row: PostedDistribution,
  run: ImportRun,
  deps: ImportDeps = DEFAULT_IMPORT_DEPS,
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
    const startedFromSaved = (hasPageNumber && Boolean(row.importResumePage)) || (hasToken && Boolean(row.importResumeToken));
    let token: string | null = hasToken ? row.importResumeToken ?? null : null;
    let tokenSeen = token !== null; // a saved token proves the board hands them out
    let exhausted = false;
    let nextPage = startPage;
    let pagesRead = 0; // pages the board answered usefully
    let firstPageStatus = 0; // the status of a failed first page (0 = none, or a network error)

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
        ...(mapping.nextToken ? { captureBodyPaths: tokenCapturePaths(mapping) } : {}),
        ...(row.connectionId ? { connectionId: row.connectionId } : {}),
        actorKind: run.actorKind,
      });
      if (!result.ok) {
        outcome.error = (result.error ?? `The job board answered ${result.status}.`).slice(0, 600);
        if (pagesRead === 0) firstPageStatus = result.status;
        break;
      }
      if (!Array.isArray(result.data)) { outcome.error = 'The job board returned its applicants in an unexpected shape.'; break; }
      pagesRead += 1;

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
              source: 'application/hiring/importDistribution.ts',
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
          // The board SAYS this is the last page (`nextToken.done`): a full page can be the end.
          if (tokenListDone(mapping, result.bodyFields)) { exhausted = true; break; }
          const next = nextTokenOf(mapping, result.bodyFields);
          // A board that echoes the token that fetched this page has no further page: following
          // it would re-read this page to the cap and save the same token every run.
          if (!next || next === token) {
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
      // A saved page/token the board REFUSES (400/404/410/422) is dropped, not re-sent forever.
      // A throttle (429), a 5xx or a network error says nothing about the token: the walk stays.
      resumePointFailed: outcome.error !== null && pagesRead === 0 && startedFromSaved && RESUME_REFUSED_STATUSES.has(firstPageStatus),
      nextPage, nextToken: token, failures, seen, failedNow,
    });
    if (plan && !(await saveImportState(db, row, plan))) {
      // A newer run took the row's lease, so its state stands and this write was dropped.
      // The applications are idempotent, so nothing is lost — but say so.
      reportCaughtError(new Error('The import state was not saved: a newer run holds this publication.'), {
        source: 'application/hiring/importDistribution.ts',
        operation: 'saveImportState',
        level: 'warning',
        context: { tenantId: row.tenantId, connectorKey: row.connectorKey },
      });
    }
  } catch (error) {
    outcome.error = (error instanceof Error ? error.message : 'The applicant import failed.').slice(0, 600);
    reportCaughtError(error, {
      source: 'application/hiring/importDistribution.ts',
      operation: 'importFromDistribution',
      context: { tenantId: row.tenantId, connectorKey: row.connectorKey },
    });
  }
  return outcome;
}
