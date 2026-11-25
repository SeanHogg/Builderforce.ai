/**
 * The payload reads every canvas sync importer shares — a record's shape, a board id,
 * a bounded string. One home so the five importers cannot disagree on what a valid
 * board reference is.
 */

import { CREATION_UUID_RE, uuidKey } from '../creationGraphWriter';

export type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

/** The payload as a plain object, or null (an array, a scalar or nothing). */
export function payloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
}

/** The ONE spelling of a canvas row id: a creation UUID, lowercased (Postgres compares `uuid` case-insensitively). */
export function canvasRowId(raw: unknown): string | null {
  return typeof raw === 'string' && CREATION_UUID_RE.test(raw) ? uuidKey(raw) : null;
}

/** `payload.boardId` — the board a child record belongs to. */
export function readBoardId(raw: Record<string, unknown>, invalidDetail: string): Parsed<string> {
  const id = canvasRowId(raw.boardId);
  return id ? { ok: true, value: id } : { ok: false, detail: invalidDetail };
}

/** A string trimmed and bounded, or null when it is not a non-empty string within `max`. */
export function boundedText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text !== '' && text.length <= max ? text : null;
}

/** An optional string column: undefined/null is "absent", a non-string or over-long one is invalid. */
export function optionalText(raw: unknown, max: number): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  return typeof raw === 'string' && raw.length <= max ? { ok: true, value: raw } : { ok: false, detail: 'invalid' };
}
