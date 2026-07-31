/**
 * Line-ending-tolerant, EOL-PRESERVING in-place string edit — the shared core of the
 * `edit_file` tool for the disk-backed capability providers (VS Code local + cloud).
 *
 * Why this exists: agents routinely emit `\n` line endings in `oldString` even when the
 * file on disk uses `\r\n` (Windows / CRLF). A naive `content.indexOf(oldString)` then
 * never matches and the edit fails with "oldString not found in file" — the "it tried
 * to change code and couldn't" failure seen when an agent repeatedly re-attempts the
 * same surgical edit against a CRLF file and gives up.
 *
 * Unlike the on-prem node provider's `applyEdit` (which normalizes the WHOLE file to LF
 * before writing — fine for a throwaway sandbox, but it would rewrite every line ending
 * in a user's working tree and produce a massive spurious diff), this matches tolerantly
 * yet writes back with the file's ORIGINAL line endings untouched: only the edited span
 * changes, using whichever EOL style actually matched.
 */

/** Result of {@link applyStringEdit}. `content` is the new file text when `ok`. */
export interface StringEditResult {
  ok: boolean;
  /** The full new file content — present only when `ok`. */
  content?: string;
  /** How many occurrences were replaced. */
  replaced?: number;
  /** Failure reason — present only when `!ok`. */
  error?: string;
}

const toLF = (s: string): string => s.replace(/\r\n/g, "\n");
const toCRLF = (s: string): string => toLF(s).replace(/\n/g, "\r\n");

/**
 * Replace `oldString` with `newString` in `content`. Tries the literal text first, then
 * (only when the literal misses) EOL-normalized variants so an LF `oldString` still
 * matches a CRLF file and vice-versa. `newString` is rewritten to the SAME EOL style as
 * the variant that matched, so the edited region stays consistent with the file and the
 * rest of the file is left byte-for-byte intact. Pure/testable.
 *
 * Uniqueness is enforced on the matched variant: without `replaceAll`, a non-unique
 * `oldString` is an error (the caller must add context) — identical to the native edit
 * tool semantics the other providers use.
 */
export function applyStringEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): StringEditResult {
  if (typeof oldString !== "string" || oldString.length === 0) {
    return { ok: false, error: "oldString is required" };
  }
  // Candidate (search, replacement) pairs, most-specific first: the literal text, then
  // the file's dominant EOL style, then the other. Deduped so a single-line edit (no
  // newlines → every variant equal) collapses to exactly one literal attempt.
  const fileIsCRLF = content.includes("\r\n");
  const ordered = fileIsCRLF
    ? [
        { oldS: oldString, newS: newString },
        { oldS: toCRLF(oldString), newS: toCRLF(newString) },
        { oldS: toLF(oldString), newS: toLF(newString) },
      ]
    : [
        { oldS: oldString, newS: newString },
        { oldS: toLF(oldString), newS: toLF(newString) },
        { oldS: toCRLF(oldString), newS: toCRLF(newString) },
      ];
  const candidates = ordered.filter(
    (c, i) => ordered.findIndex((d) => d.oldS === c.oldS) === i,
  );

  for (const { oldS, newS } of candidates) {
    const first = content.indexOf(oldS);
    if (first === -1) continue;
    if (!replaceAll && content.indexOf(oldS, first + oldS.length) !== -1) {
      return {
        ok: false,
        error: "oldString is not unique; add more surrounding context or set replaceAll",
      };
    }
    const next = replaceAll ? content.split(oldS).join(newS) : content.replace(oldS, newS);
    const replaced = replaceAll ? content.split(oldS).length - 1 : 1;
    return { ok: true, content: next, replaced };
  }
  return {
    ok: false,
    error: "oldString not found in file — read_file and copy the exact text (including indentation)",
  };
}
