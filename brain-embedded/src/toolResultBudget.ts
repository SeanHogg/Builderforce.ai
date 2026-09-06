/**
 * What a tool result costs the MODEL transcript — and how it is cut down when it costs
 * too much.
 *
 * The full result always survives in the trace (timeline + triage copy); only the copy
 * the model re-reads every turn is bounded. The generic rule is a head slice with a
 * marker, sized for the list-shaped platform results that first flooded the window (a
 * `tasks.list` of 352 rows). That rule was also applied to `read_file`, and it is why a
 * coding run could not make an edit:
 *
 *   `read_file` returns up to 2,000 lines, then `{content, truncated, totalLines,
 *   offset, note}` — the continuation fields AFTER the content. Slicing the JSON at
 *   6,000 chars cut mid-line and, because they sit at the end, deleted every one of
 *   those fields. The model was handed ~10% of a 54 KB service file with no line
 *   number for where it stopped, no total, and no `offset` to continue from — while the
 *   re-read guard told it to "request the file WHOLE in a single call", which this very
 *   cap made impossible. Measured on chat #99: one file read six times, 45% of all
 *   calls revisiting ground already covered, nine results truncated before the model saw
 *   them, and the requested change never made.
 *
 * So a file read is trimmed the way the tool itself pages: at a LINE boundary, with the
 * structured fields rewritten to describe exactly what was returned and the precise
 * `offset` that continues it. A large file now costs several honest windows instead of
 * one dishonest one — and the model can page forward instead of guessing.
 *
 * Pure: no I/O, no clock. Owned here so the run loop states a budget rather than
 * implementing one.
 */

import { withAdvisory } from './readCoverage';

/** Per-result cap (chars of JSON) for every tool that is not a file read. */
export const MAX_TOOL_RESULT_CHARS = 6_000;

/**
 * Per-result cap for `read_file`. Larger than the generic cap on purpose: reading source
 * is what a coding surface DOES, and a window this size (~4k tokens) still leaves the
 * 24k-token history budget room for several reads before compaction. Under it a 566-line
 * CSS module arrives in two windows; the service file above in four — each one saying
 * where the next begins.
 */
export const READ_FILE_RESULT_CHARS = 16_000;

/** The tool whose results are paged by line rather than sliced by char. */
const READ_FILE_TOOL = 'read_file';

export interface TrimmedToolResult {
  /** The string to store as the tool message the model sees. */
  content: string;
  /** Size of the ORIGINAL result's JSON — what the diagnostics report as result bytes. */
  bytes: number;
  /** True when the model was handed less than the tool returned. */
  truncated: boolean;
}

export interface TrimOptions {
  /**
   * A loop-guard advisory to attach to the result (the re-read warning). Attached AFTER
   * trimming so the trim can never delete it, and folded into the same `note` field the
   * tools' own guidance uses so the model meets one convention.
   */
  advisory?: string | null;
}

/** The shape `read_file` hands back on success — the fields this module rewrites. */
interface ReadFileResult {
  ok?: unknown;
  content: string;
  offset?: unknown;
  totalLines?: unknown;
  truncated?: unknown;
  note?: unknown;
  [key: string]: unknown;
}

function isReadFileResult(out: unknown): out is ReadFileResult {
  return !!out && typeof out === 'object' && !Array.isArray(out)
    && (out as { ok?: unknown }).ok !== false
    && typeof (out as { content?: unknown }).content === 'string';
}

/** Fold an advisory into a result's `note` — the loop guard's own attach, so the model
 *  meets one convention. A no-op without an advisory. */
function withNote(result: Record<string, unknown>, advisory: string | null | undefined): Record<string, unknown> {
  return advisory ? (withAdvisory(result, advisory) as Record<string, unknown>) : result;
}

/**
 * Cut a `read_file` result to the budget at a line boundary and rewrite its paging
 * fields so the model knows exactly which lines it has and which `offset` continues.
 */
function trimReadFile(out: ReadFileResult, advisory: string | null | undefined): { value: Record<string, unknown>; truncated: boolean } {
  const lines = out.content.split('\n');
  const offset = typeof out.offset === 'number' && out.offset > 0 ? Math.floor(out.offset) : 1;
  const totalLines = typeof out.totalLines === 'number' && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
  const alreadyPartial = out.truncated === true;

  const build = (kept: string[], note: string): Record<string, unknown> => {
    const lastLine = offset + kept.length - 1;
    return withNote(
      { ...out, content: kept.join('\n'), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note },
      advisory,
    );
  };
  const fits = (value: Record<string, unknown>): boolean => JSON.stringify(value).length <= READ_FILE_RESULT_CHARS;

  // Whole result within budget: the tool's own fields stand; only the advisory is added.
  const whole = withNote({ ...out }, advisory);
  if (fits(whole)) return { value: whole, truncated: false };

  const continuation = (lastLine: number): string =>
    `Showing lines ${offset}–${lastLine} of ${totalLines}. This surface returns at most ~${READ_FILE_RESULT_CHARS.toLocaleString()} chars per read, so a large file arrives in several windows — call read_file again with offset ${lastLine + 1} to continue from exactly where this one stopped. Do not re-request lines you already have.`;

  // Largest whole-line prefix that fits. Monotonic in the line count, so a binary
  // search over 0..lines.length costs ~11 stringifies of a bounded string.
  let lo = 1;
  let hi = lines.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(build(lines.slice(0, mid), continuation(offset + mid - 1)))) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === 0) {
    // Even the first line alone overflows (a minified bundle, a one-line JSON blob).
    // Paging by line cannot help; hand over as much of it as fits and say so plainly.
    const head = lines[0].slice(0, Math.max(0, READ_FILE_RESULT_CHARS - 600));
    const note = `Line ${offset} of ${totalLines} is longer than the ~${READ_FILE_RESULT_CHARS.toLocaleString()}-char read budget; the first ${head.length.toLocaleString()} of its ${lines[0].length.toLocaleString()} chars are shown. Paging by offset cannot reach the rest of this line — use search_code for the specific symbol instead.`;
    return { value: withNote({ ...out, content: head, offset, totalLines, truncated: true, note }, advisory), truncated: true };
  }

  return { value: build(lines.slice(0, best), continuation(offset + best - 1)), truncated: true };
}

/**
 * Trim a tool result to what the model transcript can afford.
 *
 * `read_file` successes are paged by line (see {@link trimReadFile}); every other
 * result gets a head slice and an explicit marker so the model knows data was elided
 * and can re-call the tool with a narrower filter/limit instead of assuming it saw
 * everything. `bytes` is always the ORIGINAL size — the diagnostics report it.
 */
export function trimToolResult(tool: string, out: unknown, opts: TrimOptions = {}): TrimmedToolResult {
  const bytes = JSON.stringify(out ?? null).length;

  if (tool === READ_FILE_TOOL && isReadFileResult(out)) {
    const trimmed = trimReadFile(out, opts.advisory);
    return { content: JSON.stringify(trimmed.value), bytes, truncated: trimmed.truncated };
  }

  const advised = opts.advisory ? withAdvisory(out ?? null, opts.advisory) : out ?? null;
  const full = JSON.stringify(advised);
  if (full.length <= MAX_TOOL_RESULT_CHARS) return { content: full, bytes, truncated: false };

  // If the result is an array, tell the model how many items were dropped — that is
  // the signal it needs to add a `limit`/`status`/`projectId` filter.
  const itemNote = Array.isArray(out)
    ? ` The full result had ${out.length} items; re-call this tool with a narrower filter (e.g. status, projectId, or limit) to see specific ones.`
    : ' The full result was large; re-call with a narrower query if you need the elided fields.';
  const head = JSON.stringify(out ?? null).slice(0, MAX_TOOL_RESULT_CHARS);
  const marker = `…[truncated ${bytes - MAX_TOOL_RESULT_CHARS} of ${bytes} chars to protect the context window.${itemNote}]`;
  // The advisory rides after the marker: a trim must never be what silences the guard.
  const content = `${head}\n${marker}${opts.advisory ? `\n${opts.advisory}` : ''}`;
  return { content, bytes, truncated: true };
}
