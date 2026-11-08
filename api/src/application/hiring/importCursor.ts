/**
 * The import's request and cursor arithmetic — pure, no I/O.
 *
 * Split from `importBoardApplicants.ts`, which runs the import (calls, writes, budgets).
 * Everything here is a function of a manifest's `applicants` mapping and some values, so
 * it is asserted directly: what a page request looks like, whether an item belongs to
 * the job being imported, and — {@link planImportState} — what a run proved and so what
 * the publication may remember. The header of `importBoardApplicants.ts` explains WHY
 * ascending and descending boards differ; this is the arithmetic that header describes.
 */

import { allOf } from '../connectors/connectorResponseMapping';
import type { ConnectorApplicantMapping } from '../connectors/connectorManifest';
import type { MappedApplicant } from '../connectors/connectorApplicantMapping';
import type { ImportFailures, ImportStateWrite, PostedDistribution } from './postingDistributionSweepStore';
import { MAX_TRACKED_FAILURES } from './importBudget';

/** The cursor is kept this far behind the newest applicant seen, so a board whose
 *  `created_after` is exclusive, or whose clock is coarse, cannot skip a tie. */
const CURSOR_MARGIN_MS = 1000;

/**
 * The cursor as the board wants it written, or null (no cursor declared / none saved).
 * Epoch milliseconds go as a NUMBER: a JSON-bodied board (Ashby) rejects `"1790…"` where it
 * wants `1790…`, and a query-string board stringifies it the same either way.
 */
export function cursorValue(mapping: ConnectorApplicantMapping, stored: string | null): string | number | null {
  if (!mapping.cursorParam || !stored) return null;
  if (mapping.cursorFormat === 'epochMs') {
    const ms = Date.parse(stored);
    return Number.isNaN(ms) ? null : ms;
  }
  return stored;
}

/**
 * The request input for page `page` (1-based) of one board's list action. `filterId` is
 * the id the board filters by (the stored publication id unless `filterIdFrom` resolved
 * another); `token` is the board's own paging token for a token-paged walk.
 */
export function pageInput(
  mapping: ConnectorApplicantMapping,
  filterId: string,
  page: number,
  cursor: string | null = null,
  token: string | null = null,
): Record<string, unknown> {
  const input: Record<string, unknown> = { [mapping.postingParam]: filterId };
  if (mapping.page) {
    input[mapping.page.param] = page;
    if (mapping.page.sizeParam && mapping.page.size) input[mapping.page.sizeParam] = mapping.page.size;
  } else if (mapping.limit) {
    input[mapping.limit.param] = mapping.limit.size;
  }
  const value = cursorValue(mapping, cursor);
  if (mapping.cursorParam && value !== null) input[mapping.cursorParam] = value;
  if (mapping.nextToken && token) input[mapping.nextToken.param] = token;
  return input;
}

/**
 * The board's token for the NEXT page, from the body fields the call captured, or null.
 * A token that is a URL the board built yields only the one query param the manifest names
 * (`fromQuery`) — the URL itself is never requested.
 */
export function nextTokenOf(mapping: ConnectorApplicantMapping, bodyFields: Record<string, string> | undefined): string | null {
  const spec = mapping.nextToken;
  if (!spec) return null;
  for (const path of spec.select) {
    const raw = bodyFields?.[path];
    if (!raw) continue;
    if (!spec.fromQuery) return raw;
    try {
      return new URL(raw).searchParams.get(spec.fromQuery) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Whether an item belongs to this publication's job. An item that names a DIFFERENT job
 * does not; one that names none cannot contradict the filter and is kept. A selector with
 * a `*` segment (`jobs.*.id`) names SEVERAL jobs, and the item belongs if ANY of them is ours.
 */
export function belongsToPosting(mapping: ConnectorApplicantMapping, item: unknown, filterId: string): boolean {
  if (!mapping.postingIdField?.length) return true;
  const named = allOf(item, mapping.postingIdField);
  return named.length === 0 || named.includes(filterId);
}

export type Positioned = Pick<MappedApplicant, 'externalId' | 'appliedAt'>;

/** Where a person sits on the cursor's axis: epoch ms of `appliedAt`, or the numeric id. */
export function positionOf(mapping: ConnectorApplicantMapping, applicant: Positioned): number | null {
  if (mapping.cursorFrom === 'id') {
    const id = Number(applicant.externalId);
    return Number.isFinite(id) ? id : null;
  }
  return applicant.appliedAt ? applicant.appliedAt.getTime() : null;
}

/** A saved cursor back to a position, or null. */
export function cursorPosition(mapping: ConnectorApplicantMapping, stored: string | null): number | null {
  if (!stored) return null;
  const value = mapping.cursorFrom === 'id' ? Number(stored) : Date.parse(stored);
  return Number.isFinite(value) ? value : null;
}

/** A position as the string we save: an ISO instant, or the id. */
export function formatPosition(mapping: ConnectorApplicantMapping, position: number): string {
  return mapping.cursorFrom === 'id' ? String(position) : new Date(position).toISOString();
}

export const marginOf = (mapping: ConnectorApplicantMapping): number => (mapping.cursorFrom === 'id' ? 0 : CURSOR_MARGIN_MS);

/** The newest position among `seen`, or null. */
export function newestPosition(mapping: ConnectorApplicantMapping, seen: readonly Positioned[]): number | null {
  const positions = seen.flatMap((entry) => { const p = positionOf(mapping, entry); return p === null ? [] : [p]; });
  return positions.length ? Math.max(...positions) : null;
}

/**
 * The position a cursor must not pass because a person at or after it has not been
 * imported: just before the OLDEST failed person. `'blocked'` when a failed person has no
 * position at all (no date), because then nothing proves where they sit; null when
 * nobody failed.
 */
export function failurePin(mapping: ConnectorApplicantMapping, failed: readonly Positioned[]): number | null | 'blocked' {
  if (!failed.length) return null;
  const positions = failed.map((entry) => positionOf(mapping, entry));
  if (positions.some((position) => position === null)) return 'blocked';
  return Math.min(...(positions as number[])) - 1;
}

/**
 * The cursor a run that has read everything up to its newest person should save: the
 * newest position seen (less the margin), held back to just before the oldest failed
 * person. Null when the board declares no cursor, nothing was seen, or a failed person
 * blocks any movement.
 */
export function nextCursor(
  mapping: ConnectorApplicantMapping,
  seen: readonly Positioned[],
  failed: readonly Positioned[] = [],
): string | null {
  if (!mapping.cursorParam) return null;
  const newest = newestPosition(mapping, seen);
  if (newest === null) return null;
  const pin = failurePin(mapping, failed);
  if (pin === 'blocked') return null;
  const candidate = Math.min(newest - marginOf(mapping), pin ?? Number.POSITIVE_INFINITY);
  return formatPosition(mapping, candidate);
}

/** A newest-first walk's unfinished state: `<newest position>|<pin or empty>`. */
export function encodePending(newest: number | null, pin: number | null): string | null {
  return newest === null ? null : `${newest}|${pin === null ? '' : pin}`;
}

export function decodePending(stored: string | null): { newest: number | null; pin: number | null } {
  if (!stored) return { newest: null, pin: null };
  const [newest, pin] = stored.split('|');
  const n = Number(newest);
  const p = pin === undefined || pin === '' ? null : Number(pin);
  return { newest: Number.isFinite(n) ? n : null, pin: p !== null && Number.isFinite(p) ? p : null };
}

/**
 * Keep the failure counts to {@link MAX_TRACKED_FAILURES} without ever keeping the WRONG
 * ones. Truncating to the first N kept the OLDEST entries, so past the cap a newly failing
 * person was never recorded — never quarantined, pinning the cursor forever.
 *
 * Only when over the cap: first drop every entry the cursor has PASSED (a person seen this
 * run whose position is before `cursorPos` can no longer be fetched, so their count can
 * never matter again); then, if still over, keep the most recent: people seen this run,
 * newest first, then the rest by how often they failed.
 */
export function pruneFailures(
  mapping: ConnectorApplicantMapping,
  failures: ImportFailures,
  seen: readonly Positioned[],
  cursorPos: number | null,
  max: number = MAX_TRACKED_FAILURES,
): ImportFailures {
  const all = Object.entries(failures);
  if (all.length <= max) return failures; // nothing to make room for: keep every count as is
  const position = new Map<string, number | null>(seen.map((entry) => [entry.externalId, positionOf(mapping, entry)]));
  const live = all.filter(([id]) => {
    const at = position.get(id);
    return !(cursorPos !== null && at !== undefined && at !== null && at < cursorPos);
  });
  if (live.length <= max) return Object.fromEntries(live);
  const rank = ([id, count]: [string, number]): [number, number] => {
    const at = position.get(id);
    return [at === undefined || at === null ? Number.NEGATIVE_INFINITY : at, count];
  };
  live.sort((a, b) => { const [pa, ca] = rank(a); const [pb, cb] = rank(b); return pb - pa || cb - ca; });
  return Object.fromEntries(live.slice(0, max));
}

/** What one run's walk proved — the input of {@link planImportState}. */
export interface WalkOutcome {
  descending: boolean;
  hasPageNumber: boolean;
  /** The board pages by an opaque token (`applicants.nextToken`). */
  hasToken: boolean;
  /** The walk reached the end of the board's list (a short page, or no next token). */
  exhausted: boolean;
  errored: boolean;
  /** The page a resume re-reads (page-numbered boards). */
  nextPage: number;
  /** The token a resume re-reads from (token-paged boards); null = the first page. */
  nextToken: string | null;
  failures: ImportFailures;
  seen: readonly Positioned[];
  failedNow: readonly Positioned[];
}

type SavedWalk = Pick<PostedDistribution, 'importCursor' | 'importResumePage' | 'importPendingCursor' | 'importFailures'>
  & { importResumeToken?: string | null };

/**
 * What a run proved, and so what the publication may remember — or null when nothing
 * changed. See the header of `importBoardApplicants.ts` for the rules this implements.
 *
 * STALLS. An ascending cursor is kept `margin` behind the newest person, so a FULL page
 * whose people all share one second leaves `newest − margin` at or before the saved
 * cursor: the cursor cannot move, and the next run would read the same page forever. When
 * a run stopped short of the end and the cursor did not move, the walk falls back to the
 * board's own paging for that walk — the page number, or the token, is saved and resumed
 * (the cursor stays, so the resumed pages are the same result set). A board with neither
 * has only the cursor to move, so it moves to the newest position itself (no margin):
 * a tie beyond that one page is the price of not stalling.
 */
export function planImportState(
  mapping: ConnectorApplicantMapping,
  row: SavedWalk,
  run: WalkOutcome,
): ImportStateWrite | null {
  const stored = cursorPosition(mapping, row.importCursor);
  const resumable = run.hasPageNumber || run.hasToken;
  let cursor: string | undefined;
  let resumePage: number | null = null;
  let resumeToken: string | null = null;
  let pendingCursor: string | null = null;
  const keepWalk = (): void => {
    resumePage = row.importResumePage;
    resumeToken = row.importResumeToken ?? null;
    pendingCursor = row.importPendingCursor;
  };
  const resumeHere = (): void => {
    resumePage = run.hasPageNumber ? run.nextPage : null;
    resumeToken = run.hasToken ? run.nextToken : null;
  };

  if (mapping.cursorParam && !run.descending) {
    // ASCENDING: everything before the newest person seen has been seen, so the cursor
    // moves after every run — capped, errored or not — but never backwards.
    const next = nextCursor(mapping, run.seen, run.failedNow);
    if (next !== null && (stored === null || cursorPosition(mapping, next)! > stored)) {
      cursor = next;
    } else if (run.errored) {
      keepWalk();
    } else if (!run.exhausted && run.seen.length > 0 && run.failedNow.length === 0) {
      if (resumable) {
        resumeHere();
      } else {
        const newest = newestPosition(mapping, run.seen);
        if (newest !== null && (stored === null || newest > stored)) cursor = formatPosition(mapping, newest);
      }
    }
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
    } else if (resumable && !run.errored) {
      resumeHere();
      pendingCursor = encodePending(newest, pin);
    } else if (run.errored) {
      keepWalk(); // an error keeps the walk where it was
    } // else: nothing to resume from — the next run starts over, and nothing is carried.
  }

  const cursorAfter = cursor !== undefined ? cursorPosition(mapping, cursor) : stored;
  const failures = pruneFailures(mapping, run.failures, run.seen, cursorAfter);
  const unchanged = cursor === undefined
    && resumePage === row.importResumePage
    && resumeToken === (row.importResumeToken ?? null)
    && pendingCursor === row.importPendingCursor
    && JSON.stringify(failures) === JSON.stringify(row.importFailures);
  if (unchanged) return null;
  return { ...(cursor !== undefined ? { cursor } : {}), resumePage, resumeToken, pendingCursor, failures };
}
