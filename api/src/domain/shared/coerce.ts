/**
 * Request-field coercion for the routes that read an untyped JSON body field by
 * field. One definition, so "is this a number" and "what does a bad id say" cannot
 * drift between route files. Refusals are {@link ValidationError}s (400) that reach
 * `app.onError`.
 */
import { ValidationError } from './errors';

/** The value when it is a string, else `undefined`. */
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The value when it is a finite number, else `undefined`. */
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A positive integer row id from a path parameter. */
export const rowId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('That is not an id.');
  return Math.floor(id);
};

const toDate = (s: string): Date => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ValidationError('That is not a date.');
  return d;
};

/** A date field where empty means "not set" → `undefined`. */
export const whenOrUndefined = (s: string | null | undefined): Date | undefined => (s ? toDate(s) : undefined);

/** A date field where empty / non-string means "no date" → `null`. */
export const whenOrNull = (v: unknown): Date | null => {
  const s = str(v);
  return s ? toDate(s) : null;
};

/** A PATCH date: `null` clears, absent (or non-string) leaves unchanged. */
export const whenPatch = (v: unknown): Date | null | undefined => {
  if (v === null) return null;
  const s = str(v);
  return s === undefined ? undefined : toDate(s);
};
