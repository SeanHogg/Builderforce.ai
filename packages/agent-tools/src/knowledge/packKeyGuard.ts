/**
 * knowledge/packKeyGuard.ts — the ONE definition of "a key the pack wire refuses" (PRD 41 A11 rule 4b).
 *
 * The API refuses a pack whose path, key or ref holds a C0 control character or DEL (`422 bad_pack`: Postgres rejects
 * NUL in `text` and `jsonb`, and the rest only ever mean a corrupt key). The server's validation and the client's pack
 * builder both import this predicate, so the builder skips exactly the rows the server would refuse and one such file
 * can never stall the pump.
 */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** True when `s` holds a C0 control character (U+0000..U+001F) or DEL (U+007F). */
export const hasControlChar = (s: string): boolean => CONTROL.test(s);

// A lone surrogate half: Postgres rejects it in `text` and `jsonb` (a 500), and it only ever means a corrupt string.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when `s` has no lone surrogate (`String.prototype.isWellFormed`, with a regex fallback for older runtimes). */
export const isWellFormedString = (s: string): boolean => {
  const native = (s as string & { isWellFormed?: () => boolean }).isWellFormed;
  return typeof native === 'function' ? native.call(s) : !LONE_SURROGATE.test(s);
};

/** A key, id or ref the pack wire accepts: no control character and no lone surrogate. */
export const isCleanKey = (s: string): boolean => !hasControlChar(s) && isWellFormedString(s);

/** Free text (a fact's content) the pack wire accepts: newlines and tabs are fine, NUL and lone surrogates are not. */
export const isCleanText = (s: string): boolean => !s.includes('\u0000') && isWellFormedString(s);
