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
