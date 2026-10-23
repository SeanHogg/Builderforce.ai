/**
 * `read_file` paged at a LINE boundary — lifted from brain-embedded's `toolResultBudget.ts`,
 * which learned it the hard way:
 *
 *   `read_file` returns up to 2,000 lines, then `{content, truncated, totalLines,
 *   offset, note}` — the continuation fields AFTER the content. Slicing the JSON at a
 *   char cap cut mid-line and, because they sit at the end, deleted every one of those
 *   fields. The model was handed ~10% of a 54 KB service file with no line number for
 *   where it stopped, no total, and no `offset` to continue from. Measured on chat #99:
 *   one file read six times, 45% of all calls revisiting ground already covered, and the
 *   requested change never made.
 *
 * So a file read is trimmed the way the tool itself pages: at a line boundary, with the
 * structured fields rewritten to describe exactly what was returned and the precise
 * `offset` that continues it. A large file costs several honest windows instead of one
 * dishonest one — and the model can page forward instead of guessing.
 */

import { TOOL_OUTPUT_CAPS } from './caps.js';

/** Per-result cap for `read_file` (chars of JSON). */
export const READ_FILE_RESULT_CHARS = TOOL_OUTPUT_CAPS.read_file ?? 16_000;

/** Attach an advisory to a result (the surface's own note convention). */
export type AttachAdvisory = (result: unknown, advisory: string) => unknown;

/** The shape `read_file` hands back on success — the fields this module rewrites. */
export interface ReadFileResult {
  ok?: unknown;
  content: string;
  offset?: unknown;
  totalLines?: unknown;
  truncated?: unknown;
  note?: unknown;
  [key: string]: unknown;
}

export function isReadFileResult(out: unknown): out is ReadFileResult {
  return !!out && typeof out === 'object' && !Array.isArray(out)
    && (out as { ok?: unknown }).ok !== false
    && typeof (out as { content?: unknown }).content === 'string';
}

export interface ReadFileWindowOptions {
  maxChars?: number;
  advisory?: string | null;
  attachAdvisory?: AttachAdvisory;
}

/**
 * Cut a `read_file` result to the budget at a line boundary and rewrite its paging
 * fields so the model knows exactly which lines it has and which `offset` continues.
 */
export function windowReadFile(out: ReadFileResult, opts: ReadFileWindowOptions = {}): { value: Record<string, unknown>; truncated: boolean } {
  const maxChars = opts.maxChars ?? READ_FILE_RESULT_CHARS;
  const withNote = (result: Record<string, unknown>): Record<string, unknown> =>
    opts.advisory && opts.attachAdvisory ? (opts.attachAdvisory(result, opts.advisory) as Record<string, unknown>) : result;

  const lines = out.content.split('\n');
  const offset = typeof out.offset === 'number' && out.offset > 0 ? Math.floor(out.offset) : 1;
  const totalLines = typeof out.totalLines === 'number' && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
  const alreadyPartial = out.truncated === true;

  const build = (kept: string[], note: string): Record<string, unknown> => {
    const lastLine = offset + kept.length - 1;
    return withNote({ ...out, content: kept.join('\n'), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note });
  };
  const fits = (value: Record<string, unknown>): boolean => JSON.stringify(value).length <= maxChars;

  // Whole result within budget: the tool's own fields stand; only the advisory is added.
  const whole = withNote({ ...out });
  if (fits(whole)) return { value: whole, truncated: false };

  const continuation = (lastLine: number): string =>
    `Showing lines ${offset}–${lastLine} of ${totalLines}. This surface returns at most ~${maxChars.toLocaleString('en-US')} chars per read, so a large file arrives in several windows — call read_file again with offset ${lastLine + 1} to continue from exactly where this one stopped. Do not re-request lines you already have.`;

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
    const first = lines[0] ?? '';
    const head = first.slice(0, Math.max(0, maxChars - 600));
    const note = `Line ${offset} of ${totalLines} is longer than the ~${maxChars.toLocaleString('en-US')}-char read budget; the first ${head.length.toLocaleString('en-US')} of its ${first.length.toLocaleString('en-US')} chars are shown. Paging by offset cannot reach the rest of this line — use search_code for the specific symbol instead.`;
    return { value: withNote({ ...out, content: head, offset, totalLines, truncated: true, note }), truncated: true };
  }

  return { value: build(lines.slice(0, best), continuation(offset + best - 1)), truncated: true };
}
