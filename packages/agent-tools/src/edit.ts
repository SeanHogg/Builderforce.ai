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
 * changes, and the replacement is written in the file's DOMINANT EOL, so a CRLF file
 * stays pure CRLF. {@link conformToExistingEol} is the same rule for a whole-file write.
 */

import { callWriteEntriesOf } from "./callShape.js";
import { countNewlines, dominantEol, matchEdit, withEol, type MatchTier } from "./edit-match.js";

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
  /** Only on success: that span plus {@link EDIT_EXCERPT_CONTEXT} lines either side,
   *  from the NEW content, as `n: text` — capped at {@link EDIT_EXCERPT_MAX_LINES}.
   *  The agent sees what the file now says, so it does not re-read it to check. */
  excerpt?: string;
  /** Only on success: which matcher tier found `oldString` (`edit-match.ts`) — `exact`,
   *  `crlf` (line endings differed), `unescaped` (the model over-escaped `\"`/`\n`) or
   *  `whitespace` (indentation / trailing whitespace differed). */
  matchedBy?: MatchTier;
}

export { dominantEol, withEol, type Eol, type MatchTier } from "./edit-match.js";

/**
 * Whole-file write that keeps the file's line endings: `next` rewritten to the EOL style
 * `existing` already uses. A new file (`existing` null) or one with no newline is written as
 * given. So `write_file` over a CRLF file cannot turn it into a mixed or LF file.
 */
export function conformToExistingEol(existing: string | null | undefined, next: string): string {
  return existing == null ? next : withEol(next, dominantEol(existing));
}

/** Shortest needle the "contains" fallback of {@link findNearest} will try — shorter
 *  text (`}`, `return;`) matches everywhere and would point at noise. */
const MIN_CONTAINS_NEEDLE = 8;
const EXCERPT_RADIUS = 3;
/** Context lines either side of an edited span in a success excerpt. */
export const EDIT_EXCERPT_CONTEXT = 2;
/** Longest success excerpt; a bigger edit shows its head and tail around a `…` line. */
export const EDIT_EXCERPT_MAX_LINES = 40;

/** `lines[from, to)` as `n: text`, numbered 1-based. */
function numberedLines(lines: readonly string[], from: number, to: number): string {
  return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
}

/**
 * What the file says around an edit, after it — see {@link StringEditResult.excerpt}.
 *
 * Observed (VS Code chat #133): seven edits to one file and thirteen reads of it, each
 * read checking what the edit before it had done, because a success said only
 * `{ ok: true, replaced: 1 }`.
 */
function excerptAfterEdit(content: string, region: { startLine: number; endLine: number }): string {
  const lines = content.split(/\r?\n/);
  const from = Math.max(0, region.startLine - 1 - EDIT_EXCERPT_CONTEXT);
  const to = Math.min(lines.length, region.endLine + EDIT_EXCERPT_CONTEXT);
  if (to - from <= EDIT_EXCERPT_MAX_LINES) return numberedLines(lines, from, to);
  const half = Math.floor(EDIT_EXCERPT_MAX_LINES / 2);
  return `${numberedLines(lines, from, from + half)}\n…\n${numberedLines(lines, to - half, to)}`;
}

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
  return { line: index + 1, excerpt: numberedLines(lines, from, to) };
}

/**
 * Replace `oldString` with `newString` in `content`. The match is EOL-NORMALISED (CRLF and
 * LF compare equal, on both sides), so an LF `oldString` matches a CRLF file, a CRLF one an
 * LF file, and either matches a file that is already mixed. `newString` is ALWAYS written in
 * the file's dominant EOL ({@link dominantEol}) — so a CRLF file stays pure CRLF and a file
 * with no newline gets `newString` as given. The rest of the file is byte-for-byte intact.
 * Pure/testable.
 *
 * Observed (chat #60338): the old matcher tried the LITERAL text first and wrote `newString`
 * as given whenever that hit — so a one-line `oldString` (no newline, so it matched
 * literally) replaced by a two-line LF `newString` put an LF line inside a CRLF file. The
 * model then distrusted its own edit for three turns and ended up with a duplicated line.
 *
 * Uniqueness is enforced on the matched variant: without `replaceAll`, a non-unique
 * `oldString` is an error (the caller must add context) — identical to the native edit
 * tool semantics the other providers use.
 *
 * When the EOL-normalised text misses, tolerant tiers follow (`edit-match.ts`): an
 * over-escaped `oldString` (`\"` for `"`), then a whitespace-tolerant line match — each
 * still unique-or-refused; `matchedBy` names the tier that hit.
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
  const match = matchEdit(content, oldString, newString, replaceAll, dominantEol(content));
  if (match && "ambiguous" in match) {
    return {
      ok: false,
      error: "oldString is not unique; add more surrounding context or set replaceAll",
    };
  }
  if (match) {
    const parts: string[] = [];
    let from = 0;
    for (const { start, end, text } of match.splices) {
      parts.push(content.slice(from, start), text);
      from = end;
    }
    parts.push(content.slice(from));
    const next = parts.join("");
    const first = match.splices[0]!;
    const region = regionAt(content, first.start, first.text);
    return { ok: true, content: next, replaced: match.splices.length, region, excerpt: excerptAfterEdit(next, region), matchedBy: match.tier };
  }
  const nearest = findNearest(content, oldString);
  return {
    ok: false,
    error: "oldString not found in file — read_file and copy the exact text (including indentation)",
    ...(nearest ? { nearest } : {}),
  };
}

/** The model-facing facts of an edit, without the file content. */
export interface EditFacts {
  replaced?: number;
  region?: { startLine: number; endLine: number };
  excerpt?: string;
  error?: string;
  nearest?: { line: number; excerpt: string };
  /** Present only when a tolerant tier (not `exact`) matched — tells the model its text was off. */
  matchedBy?: MatchTier;
}

/**
 * B3 (PRD 45 §4.7): ONE `edit_file` call carrying SEVERAL edits. `edits` is the batch
 * form of the single `{path, old_string, new_string, replace_all}`; each entry applies
 * through {@link applyStringEdit} exactly as a lone call would. ATOMIC: either every
 * edit lands or NONE do — a caller must never be left with half of a refactor applied.
 * On failure the result names the FIRST edit (1-based) that did not match, with that
 * edit's `nearest`/`error` hint so the retry copies the real text.
 */
export interface BatchEditEntry {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * One file a write call changed, read from its ARGUMENTS: the path, and — when the call carries them — the text
 * it replaced (`before`) and the text it put there (`after`). An `edit_file` replacement carries both; a whole-file
 * `write_file` carries only `after` (the bytes it overwrote are not in the call); any other code change (a delete,
 * a rename) carries neither.
 */
export interface EditedFile {
  path: string;
  before?: string;
  after?: string;
}

/**
 * Every file ONE write call changed, from its arguments — THE reading of "what an edit wrote" (the run view's
 * written paths, the post-edit balance note and diagnostics, the `bracket_break` detector).
 *   - `edit_file`: its single `{path, old_string, new_string}` and each `edits[]` entry (an entry with no path
 *     takes the call's), one row per replacement, in order;
 *   - `write_file`: `{ path, after: content }`;
 *   - anything else, or an edit with no readable replacement: the call's path alone.
 * Rows are per replacement, so a path may repeat; callers wanting files dedupe. Pure — success is the caller's.
 * The arguments are read through THE shape reader ({@link callWriteEntriesOf}, `callShape.ts`), which the run guards share.
 */
export function editedFilesOf(toolName: string, args: unknown): EditedFile[] {
  const entries = callWriteEntriesOf(args);
  const top = entries[0] ?? null;
  const out: EditedFile[] = [];
  if (toolName === "edit_file") {
    for (const e of entries) {
      if (!e.path) continue;
      if (e.before !== undefined || e.after !== undefined) {
        out.push({ path: e.path, ...(e.before !== undefined ? { before: e.before } : {}), ...(e.after !== undefined ? { after: e.after } : {}) });
      } else if (e.batched) {
        out.push({ path: e.path });
      }
    }
  } else if (toolName === "write_file" && top?.path) {
    out.push({ path: top.path, ...(top.content !== undefined ? { after: top.content } : {}) });
  }
  if (out.length === 0 && top?.path) out.push({ path: top.path });
  return out;
}

/** The distinct paths {@link editedFilesOf} names, first-seen order. */
export function editedPathsOf(toolName: string, args: unknown): string[] {
  return [...new Set(editedFilesOf(toolName, args).map((f) => f.path))];
}

/** The most edits one `edit_file` call applies in a batch (PRD 45 §4.7 B3). */
export const EDIT_BATCH_MAX = 20;

export interface BatchEditFileOutcome {
  path: string;
  ok: boolean;
  content?: string;
  replaced?: number;
  region?: { startLine: number; endLine: number };
  excerpt?: string;
  error?: string;
  nearest?: { line: number; excerpt: string };
  /** As {@link EditFacts.matchedBy}: present only when a tolerant tier matched. */
  matchedBy?: MatchTier;
}

export interface BatchEditPlan {
  edits: BatchEditEntry[];
  /** A structural problem that refuses the whole call before any edit is attempted. */
  error?: string;
  /** The first index (into `edits`) whose entry is structurally invalid. */
  invalidAt?: number;
}

/** Shape one batch entry; returns an error string when a required field is missing. */
function entryProblem(e: BatchEditEntry): string | null {
  if (typeof e.path !== "string" || e.path.trim() === "") return "path is required";
  if (typeof e.old_string !== "string" || e.old_string.length === 0) return "old_string is required";
  if (typeof e.new_string !== "string") return "new_string is required";
  return null;
}

/**
 * Parse + validate the `edits[]` payload. Returns the plan, or `{ edits: [], error,
 * invalidAt }` naming the FIRST structurally invalid edit (1-based for the model).
 */
export function planBatchEdits(raw: unknown): BatchEditPlan {
  if (!Array.isArray(raw) || raw.length === 0) return { edits: [], error: "edits must be a non-empty array" };
  if (raw.length > EDIT_BATCH_MAX) return { edits: [], error: `edits takes at most ${EDIT_BATCH_MAX} edits per call — split the rest into another edit_file` };
  const edits = raw as BatchEditEntry[];
  for (let i = 0; i < edits.length; i += 1) {
    const problem = entryProblem(edits[i]!);
    if (problem) return { edits: [], error: `edit ${i + 1} (${edits[i]!.path ?? "?"}): ${problem}`, invalidAt: i };
  }
  return { edits };
}

/**
 * Apply a batch ATOMICALLY against an in-memory file table (`read` returns the current
 * text, or null when the path is missing). No entry is read until every earlier one has
 * been validated against the table, and nothing is written until ALL have applied — so a
 * failure leaves every file untouched and names the first edit that did not match.
 */
export async function applyBatchEdits(
  plan: BatchEditPlan,
  io: { read: (path: string) => Promise<string | null>; write: (path: string, content: string) => Promise<void> },
): Promise<{ ok: boolean; files: BatchEditFileOutcome[] }> {
  if (plan.error || plan.invalidAt !== undefined) {
    return { ok: false, files: [{ path: "", ok: false, error: plan.error ?? "invalid edits" }] };
  }
  // Phase 1 — compute every edit against a LOCAL overlay; the first miss aborts before
  // any write. Edits to the SAME file stack on the overlay, so two edits to one path in
  // one batch behave like two sequential lone calls.
  const overlay = new Map<string, string>();
  const outcomes: BatchEditFileOutcome[] = [];
  for (let i = 0; i < plan.edits.length; i += 1) {
    const e = plan.edits[i]!;
    const base = overlay.has(e.path) ? overlay.get(e.path)! : ((await io.read(e.path)) ?? null);
    if (base === null || base === undefined) {
      return { ok: false, files: [...outcomes, { path: e.path, ok: false, error: `edit ${i + 1}: file not found — ${e.path}` }] };
    }
    const r = applyStringEdit(overlay.get(e.path) ?? base, e.old_string, e.new_string, e.replace_all === true);
    if (!r.ok || r.content == null) {
      return {
        ok: false,
        files: [...outcomes, { path: e.path, ok: false, error: `edit ${i + 1} (${e.path}): ${r.error ?? "did not match"}`, ...(r.nearest ? { nearest: r.nearest } : {}) }],
      };
    }
    overlay.set(e.path, r.content);
    outcomes.push({
      path: e.path,
      ok: true,
      content: r.content,
      ...(r.replaced != null ? { replaced: r.replaced } : {}),
      ...(r.region ? { region: r.region } : {}),
      ...(r.excerpt ? { excerpt: r.excerpt } : {}),
      ...(r.matchedBy && r.matchedBy !== "exact" ? { matchedBy: r.matchedBy } : {}),
    });
  }
  // Phase 2 — every edit matched; persist the touched files exactly once, in batch order.
  const written = new Set<string>();
  for (const o of outcomes) {
    if (written.has(o.path)) continue;
    written.add(o.path);
    await io.write(o.path, overlay.get(o.path)!);
  }
  return { ok: true, files: outcomes.map(({ content: _c, ...rest }) => rest) };
}

/**
 * The ONE mapping from {@link applyStringEdit}'s result to what a provider returns.
 *
 * The core computed `nearest` on a miss and `region` on a hit, and two of the three
 * providers dropped both on the floor (`{ ok: false, error }` / `{ ok: true, replaced }`),
 * so the hint built to stop an agent re-sending the same wrong `oldString` never reached
 * one. Every provider spreads this instead of picking fields by hand.
 */
export function editFacts(edit: StringEditResult): EditFacts {
  return {
    ...(edit.replaced != null ? { replaced: edit.replaced } : {}),
    ...(edit.region ? { region: edit.region } : {}),
    ...(edit.excerpt ? { excerpt: edit.excerpt } : {}),
    ...(edit.error ? { error: edit.error } : {}),
    ...(edit.nearest ? { nearest: edit.nearest } : {}),
    ...(edit.matchedBy && edit.matchedBy !== "exact" ? { matchedBy: edit.matchedBy } : {}),
  };
}
