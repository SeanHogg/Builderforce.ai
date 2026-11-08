/**
 * The import's request and cursor arithmetic — pure, no I/O.
 *
 * Split from `importBoardApplicants.ts`, which runs the import (calls, writes, budgets).
 * Everything here is a function of a manifest's `applicants` mapping and some values, so
 * it is asserted directly: what a page request looks like, whether an item belongs to
 * the job being imported, and where a run proved the cursor may move to. The header of
 * `importBoardApplicants.ts` explains WHY ascending and descending boards differ; this is
 * the arithmetic that header describes.
 */

import { firstOf } from '../connectors/connectorResponseMapping';
import type { ConnectorApplicantMapping } from '../connectors/connectorManifest';
import type { MappedApplicant } from '../connectors/connectorApplicantMapping';

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
  } else if (mapping.limit) {
    input[mapping.limit.param] = mapping.limit.size;
  }
  const value = cursorValue(mapping, cursor);
  if (mapping.cursorParam && value !== null) input[mapping.cursorParam] = value;
  return input;
}

/**
 * Whether an item belongs to this publication's job. An item that names a DIFFERENT job
 * does not; one that names none cannot contradict the filter and is kept.
 */
export function belongsToPosting(mapping: ConnectorApplicantMapping, item: unknown, boardPostingId: string): boolean {
  if (!mapping.postingIdField?.length) return true;
  const named = firstOf({ data: item }, mapping.postingIdField);
  return named === null || named === boardPostingId;
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
