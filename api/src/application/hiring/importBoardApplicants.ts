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
 * (selectors for id / person id / name / email / date, the param that carries the
 * board's posting id, and optionally a cursor param). The call goes through
 * `executeConnectorAction` — credentialled, SSRF-guarded, audited — and each item is read
 * by `mapApplicant`. Adding a board's import is a manifest edit.
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
 * could have arrived with ({@link admitBoardCandidate}).
 *
 * ── BOUNDED, AND WHAT CATCHES UP ─────────────────────────────────────────────────
 * Per board per run: at most {@link MAX_PAGES_PER_BOARD} pages and, counted per ITEM
 * (not per page), at most `maxApplicants` applicants ({@link MAX_APPLICANTS_PER_BOARD}
 * for the sweep, {@link MANUAL_MAX_APPLICANTS} for a press of the button).
 *   • A board whose manifest declares a CURSOR (`created_after`, `updated_at_start`…)
 *     catches up: the cursor — saved on the publication after a run that read everything
 *     it asked for and lost no applicant — makes the next run ask only for people newer
 *     than that, so a backlog bigger than one run is worked off across runs.
 *   • A board with NO cursor re-reads the same newest page(s) every run. It imports what
 *     those pages hold and no more; applicants beyond them reach us only when the vendor's
 *     own ordering brings them forward. The result says `more` whenever a cap stopped it.
 * A run that hit a cap, an error or a failed applicant does NOT advance the cursor, so
 * nothing is skipped; the idempotent re-read costs calls, not correctness.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveConnector } from '../connectors/connectorRegistry';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { mapApplicant, type MappedApplicant } from '../connectors/connectorApplicantMapping';
import type { ConnectorAction, ConnectorApplicantMapping } from '../connectors/connectorManifest';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordApplication } from './applications';
import { admitBoardCandidate } from './boardCandidate';
import { LIST_APPLICANTS_ACTIONS } from './postingActionKeys';
import {
  listPostedDistributionsForSweep,
  readPostedDistributions,
  readPostingBoardCatalog,
  saveImportCursor,
  touchPostedDistribution,
  type PostedDistribution,
} from './postingDistributionStore';
import { requirePosting } from './postingDistributionSupport';
import { resolveDistributionUrl, runUrlResolutionPass } from './resolveBoardUrls';

export const MAX_PAGES_PER_BOARD = 5;
/** Applicants per board per run in the scheduled sweep (counted per item). */
export const MAX_APPLICANTS_PER_BOARD = 500;
/** Applicants per board per press of the button — small, because a person is waiting. */
export const MANUAL_MAX_APPLICANTS = 200;
/** Distributions one scheduled sweep imports. */
export const MAX_DISTRIBUTIONS_PER_SWEEP = 60;
/** The cursor is kept this far behind the newest applicant seen, so a board whose
 *  `created_after` is exclusive, or whose clock is coarse, cannot skip a tie. */
const CURSOR_MARGIN_MS = 1000;

export interface BoardImportOutcome {
  connectorKey: string;
  /** Items the board returned and this run processed. */
  fetched: number;
  /** New applications written (existing ones are refreshed, not counted). */
  imported: number;
  /** Applicants whose own write failed — counted, never fatal to the board's run. */
  failedApplicants: number;
  /** Declared-importable but nothing happened: the board has no import action. */
  unsupported: boolean;
  /** A cap stopped the run before the board was exhausted: run again. */
  more: boolean;
  error: string | null;
}

export interface ImportBoardApplicantsResult {
  boards: BoardImportOutcome[];
  imported: number;
  /** True when any board stopped at a cap — "more pending; run again". */
  more: boolean;
}

export interface ImportDeps {
  execute: typeof executeConnectorAction;
}
const DEFAULT_DEPS: ImportDeps = { execute: executeConnectorAction };

interface ImportRun {
  /** Applicants this run may process for ONE board, counted per item. */
  maxApplicants: number;
  /** Who the audit log says made the calls. */
  actorKind: 'user' | 'system';
}

/** The list action a manifest imports through, or null. */
export function importAction(actions: readonly ConnectorAction[]): (ConnectorAction & { applicants: ConnectorApplicantMapping }) | null {
  for (const key of LIST_APPLICANTS_ACTIONS) {
    const action = actions.find((candidate) => candidate.key === key);
    if (action?.applicants) return action as ConnectorAction & { applicants: ConnectorApplicantMapping };
  }
  return null;
}

/** The cursor as the board wants it written, or null (no cursor declared / none saved). */
export function cursorValue(mapping: ConnectorApplicantMapping, stored: string | null): string | null {
  if (!mapping.cursorParam || !stored) return null;
  if (mapping.cursorFormat === 'epochMs') {
    const ms = Date.parse(stored);
    return Number.isNaN(ms) ? null : String(ms);
  }
  return stored;
}

/** The request input for page `page` (1-based) of one board's list action. */
export function pageInput(
  mapping: ConnectorApplicantMapping,
  boardPostingId: string,
  page: number,
  cursor: string | null = null,
): Record<string, unknown> {
  const input: Record<string, unknown> = { [mapping.postingParam]: boardPostingId };
  if (mapping.page) {
    input[mapping.page.param] = page;
    if (mapping.page.sizeParam && mapping.page.size) input[mapping.page.sizeParam] = mapping.page.size;
  }
  const value = cursorValue(mapping, cursor);
  if (mapping.cursorParam && value) input[mapping.cursorParam] = value;
  return input;
}

/**
 * The cursor a COMPLETE run should save: the newest `appliedAt` seen (less the margin),
 * or the greatest numeric board id — per the manifest's `cursorFrom`. Null when the run
 * saw nothing to move it by, or the manifest declares no cursor.
 */
export function nextCursor(mapping: ConnectorApplicantMapping, seen: ReadonlyArray<Pick<MappedApplicant, 'externalId' | 'appliedAt'>>): string | null {
  if (!mapping.cursorParam) return null;
  if (mapping.cursorFrom === 'id') {
    const ids = seen.map((entry) => Number(entry.externalId)).filter((id) => Number.isFinite(id));
    return ids.length ? String(Math.max(...ids)) : null;
  }
  const times = seen.flatMap((entry) => (entry.appliedAt ? [entry.appliedAt.getTime()] : []));
  return times.length ? new Date(Math.max(...times) - CURSOR_MARGIN_MS).toISOString() : null;
}

/** Import for ONE confirmed publication. Never throws: a board failing is its outcome. */
export async function importFromDistribution(
  db: Db,
  env: Env,
  row: PostedDistribution,
  run: ImportRun,
  deps: ImportDeps = DEFAULT_DEPS,
): Promise<BoardImportOutcome> {
  const outcome: BoardImportOutcome = {
    connectorKey: row.connectorKey, fetched: 0, imported: 0, failedApplicants: 0, unsupported: false, more: false, error: null,
  };
  try {
    const resolved = await resolveConnector(db, row.tenantId, row.connectorKey, env);
    const action = resolved ? importAction(resolved.manifest.actions) : null;
    if (!action) { outcome.unsupported = true; return outcome; }
    const mapping = action.applicants;
    const pageSize = mapping.page?.size ?? 0;
    // Loaded ONCE for the whole run — the source is folded against it per applicant.
    const boards = await readPostingBoardCatalog(db, row.tenantId, row.postingId, env);
    const seen: Array<Pick<MappedApplicant, 'externalId' | 'appliedAt'>> = [];
    let exhausted = false;

    pages: for (let page = 1; page <= MAX_PAGES_PER_BOARD; page += 1) {
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

      for (const item of result.data) {
        // The cap is per ITEM: a page that would cross it is stopped mid-page.
        if (outcome.fetched >= run.maxApplicants) { outcome.more = true; break pages; }
        outcome.fetched += 1;
        const applicant = mapApplicant(mapping, item);
        if (!applicant) continue;
        seen.push(applicant);
        try {
          const candidate = await admitBoardCandidate(db, {
            tenantId: row.tenantId, boardKey: row.connectorKey, applicationId: applicant.externalId,
            candidateId: applicant.candidateId, name: applicant.name, email: applicant.email,
          });
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
        } catch (error) {
          // One bad applicant (a constraint, a malformed field) never aborts the board.
          outcome.failedApplicants += 1;
          if (outcome.failedApplicants === 1) {
            reportCaughtError(error, {
              source: 'application/hiring/importBoardApplicants.ts',
              operation: 'importApplicant',
              context: { tenantId: row.tenantId, connectorKey: row.connectorKey },
            });
          }
        }
      }
      // No paging declared, or a short page: that was the last one.
      if (!pageSize || result.data.length < pageSize) { exhausted = true; break; }
      if (page === MAX_PAGES_PER_BOARD) outcome.more = true;
    }

    // Advance the cursor only after a COMPLETE, clean run (see the header).
    if (!outcome.error && !outcome.more && exhausted && outcome.failedApplicants === 0) {
      const cursor = nextCursor(mapping, seen);
      if (cursor) await saveImportCursor(db, row, cursor);
    }
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
 * can pass what the caller sent. The manual run is capped at {@link MANUAL_MAX_APPLICANTS}
 * per board and says `more` when that (or the page cap) stopped it.
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
  const boards: BoardImportOutcome[] = [];
  for (const row of rows) {
    // Touched FIRST: a crash mid-import must not leave this row at the front of the queue.
    await touchPostedDistribution(db, row);
    // A press of "Import" is also a chance to find a link the create call could not give.
    if (!row.url) await resolveDistributionUrl(db, env, row, undefined, 'user');
    boards.push(await importFromDistribution(db, env, row, { maxApplicants: MANUAL_MAX_APPLICANTS, actorKind: 'user' }, deps));
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
}

/** The scheduled import: one bounded, rotating batch across workspaces, then the
 *  lightweight pass that finds links for confirmed rows without one. */
export async function runApplicantImportSweep(db: Db, env: Env, deps: ImportDeps = DEFAULT_DEPS): Promise<ImportSweepResult> {
  const result: ImportSweepResult = { checked: 0, imported: 0, failed: 0, linked: 0 };
  for (const row of await listPostedDistributionsForSweep(db, MAX_DISTRIBUTIONS_PER_SWEEP)) {
    // Rotate FIRST, whatever happens next: a row that crashes the run, or keeps failing,
    // is already at the back of the queue and cannot starve the others.
    await touchPostedDistribution(db, row);
    const outcome = await importFromDistribution(db, env, row, { maxApplicants: MAX_APPLICANTS_PER_BOARD, actorKind: 'system' }, deps);
    if (outcome.unsupported) continue;
    result.checked += 1;
    result.imported += outcome.imported;
    if (outcome.error || outcome.failedApplicants > 0) result.failed += 1;
  }
  result.linked = (await runUrlResolutionPass(db, env)).linked;
  return result;
}

export function describeApplicantImportSweep(result: ImportSweepResult): string | null {
  if (result.checked === 0 && result.linked === 0) return null;
  return `boards=${result.checked} imported=${result.imported} failed=${result.failed} linked=${result.linked}`;
}
