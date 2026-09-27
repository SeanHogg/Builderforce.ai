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
  /** Only on the "not found" failure: where the file most likely holds what the agent
   *  meant — the line matching `oldString`'s first non-empty line (1-based) and that
   *  line ±3 as `n: text`, so the retry copies the real text instead of guessing again.
   *  Absent when no line is similar; never on the "not unique" failure. */
  nearest?: { line: number; excerpt: string };
  /** Only on success: the 1-based line span the FIRST replacement occupies in the new
   *  content, so the caller can point at (or re-read) exactly what changed. */
  region?: { startLine: number; endLine: number };
}

const toLF = (s: string): string => s.replace(/\r\n/g, "\n");
const toCRLF = (s: string): string => toLF(s).replace(/\n/g, "\r\n");
const countNewlines = (s: string): number => s.split("\n").length - 1;

/** Shortest needle the "contains" fallback of {@link findNearest} will try — shorter
 *  text (`}`, `return;`) matches everywhere and would point at noise. */
const MIN_CONTAINS_NEEDLE = 8;
const EXCERPT_RADIUS = 3;

/** The 1-based line span of a replacement at `offset` in `content`, `newS` being what was written there. */
function regionAt(content: string, offset: number, newS: string): { startLine: number; endLine: number } {
  const startLine = countNewlines(content.slice(0, offset)) + 1;
  return { startLine, endLine: startLine + countNewlines(newS) };
}

/** Where `oldString` most likely lives when it did not match — see {@link StringEditResult.nearest}. */
function findNearest(content: string, oldString: string): { line: number; excerpt: string } | undefined {
  const needle = oldString.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!needle) return undefined;
  const lines = content.split(/\r?\n/);
  let index = lines.findIndex((l) => l.trim() === needle);
  if (index === -1 && needle.length >= MIN_CONTAINS_NEEDLE) index = lines.findIndex((l) => l.includes(needle));
  if (index === -1) return undefined;
  const from = Math.max(0, index - EXCERPT_RADIUS);
  const to = Math.min(lines.length, index + EXCERPT_RADIUS + 1);
  const excerpt = lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
  return { line: index + 1, excerpt };
}

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
 *
 * A success carries `region` (where the first replacement landed); a miss carries
 * `nearest` (the most similar line and its neighbourhood) when one exists — the hint an
 * agent needs to stop re-sending the same wrong `oldString`.
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
    return { ok: true, content: next, replaced, region: regionAt(content, first, newS) };
  }
  const nearest = findNearest(content, oldString);
  return {
    ok: false,
    error: "oldString not found in file — read_file and copy the exact text (including indentation)",
    ...(nearest ? { nearest } : {}),
  };
}
