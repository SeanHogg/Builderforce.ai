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

import { TOOL_OUTPUT_CAPS, pagedReadOffsetsPerPath, pagedReadSearchTool } from './caps.js';

/** Per-result cap for `read_file` (chars of JSON). */
export const READ_FILE_RESULT_CHARS = TOOL_OUTPUT_CAPS.read_file ?? 16_000;

/** Attach an advisory to a result (the surface's own note convention). */
export type AttachAdvisory = (result: unknown, advisory: string) => unknown;

/** The shape `read_file` hands back on success — the fields this module rewrites. */
export interface ReadFileResult {
  ok?: unknown;
  path?: unknown;
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
  /** The tool the model calls to continue (its name goes in the continuation note). Default `read_file`. */
  tool?: string;
  /**
   * The file is one of several in a multi-path read, whose continuation is not available
   * there: the note tells the model to read THIS file alone (by its path) at the offset.
   */
  alone?: string;
  maxChars?: number;
  advisory?: string | null;
  attachAdvisory?: AttachAdvisory;
}

/** A windowed `read_file` result. */
export interface ReadFileWindowed {
  /** What the model is handed: the window with the advisory attached. */
  value: Record<string, unknown>;
  /** The same window BEFORE the advisory — the lines the model was actually served, which
   *  read coverage records (an advisory is guidance, not file content). */
  served: Record<string, unknown>;
  truncated: boolean;
}

/**
 * Cut a `read_file` result to the budget at a line boundary and rewrite its paging
 * fields so the model knows exactly which lines it has and which `offset` continues.
 */
export function windowReadFile(out: ReadFileResult, opts: ReadFileWindowOptions = {}): ReadFileWindowed {
  const maxChars = opts.maxChars ?? READ_FILE_RESULT_CHARS;
  const tool = opts.tool ?? 'read_file';
  const withNote = (result: Record<string, unknown>): Record<string, unknown> =>
    opts.advisory && opts.attachAdvisory ? (opts.attachAdvisory(result, opts.advisory) as Record<string, unknown>) : result;
  /** `served` is the window before the advisory — what read coverage records. */
  const done = (served: Record<string, unknown>, truncated: boolean): ReadFileWindowed => ({ value: withNote(served), served, truncated });

  const lines = out.content.split('\n');
  const offset = typeof out.offset === 'number' && out.offset > 0 ? Math.floor(out.offset) : 1;
  const totalLines = typeof out.totalLines === 'number' && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
  const alreadyPartial = out.truncated === true;

  const served = (kept: string[], note: string): Record<string, unknown> => {
    const lastLine = offset + kept.length - 1;
    return { ...out, content: kept.join('\n'), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note };
  };
  const build = (kept: string[], note: string): Record<string, unknown> => withNote(served(kept, note));
  const fits = (value: Record<string, unknown>): boolean => JSON.stringify(value).length <= maxChars;

  // Whole result within budget: the tool's own fields stand; only the advisory is added.
  if (fits(withNote({ ...out }))) return done({ ...out }, false);

  const how = (next: number): string => opts.alone !== undefined
    ? `call ${tool} again with ONLY the path ${JSON.stringify(opts.alone)} (offset applies to a single file) and offset ${next}`
    : `call ${tool} again with offset ${next}`;
  const continuation = (lastLine: number): string =>
    `Showing lines ${offset}–${lastLine} of ${totalLines}. This surface returns at most ~${maxChars.toLocaleString('en-US')} chars per read, so a large file arrives in several windows — ${how(lastLine + 1)} to continue from exactly where this one stopped. Do not re-request lines you already have.`;

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
    // A share too small for the note and any of the line (a file among many) gives NO content —
    // and says so, with how to read it — rather than a few stray characters.
    const room = maxChars - 600;
    const head = room >= 200 ? first.slice(0, room) : '';
    const more = lines.length > 1 ? ` The lines AFTER it continue at offset ${offset + 1}: ${how(offset + 1)}.` : '';
    const note = head
      ? `Line ${offset} of ${totalLines} is longer than the ~${maxChars.toLocaleString('en-US')}-char read budget; the first ${head.length.toLocaleString('en-US')} of its ${first.length.toLocaleString('en-US')} chars are shown. Paging by offset cannot reach the rest of this line — use ${pagedReadSearchTool(tool)} for the specific symbol instead.${more}`
      : `Skipped: this file's share of the read budget (~${Math.max(0, maxChars).toLocaleString('en-US')} chars) is too small for even its first line (${first.length.toLocaleString('en-US')} chars). Read it ${opts.alone !== undefined ? 'on its own' : 'again with a larger budget'}: ${how(offset)}, or use ${pagedReadSearchTool(tool)} for the specific symbol.`;
    return done({ ...out, content: head, offset, totalLines, truncated: true, note }, true);
  }

  return done(served(lines.slice(0, best), continuation(offset + best - 1)), true);
}

/** `read_file` with `paths[]`: one result per file, in request order. */
export interface ReadFilesResult {
  ok?: unknown;
  files: unknown[];
  [key: string]: unknown;
}

export function isReadFilesResult(out: unknown): out is ReadFilesResult {
  return !!out && typeof out === 'object' && !Array.isArray(out)
    && (out as { ok?: unknown }).ok !== false
    && Array.isArray((out as { files?: unknown }).files);
}

/**
 * Window a multi-file `read_file` result: the char budget is SPLIT across the files —
 * smallest first, so a short file is kept whole and what it did not use goes to the
 * larger ones — and each file is paged by line on its own ({@link windowReadFile}). A
 * failed entry (a missing path) passes through. The advisory rides on the whole result.
 */
export function windowReadFiles(out: ReadFilesResult, opts: ReadFileWindowOptions = {}): ReadFileWindowed {
  const maxChars = opts.maxChars ?? READ_FILE_RESULT_CHARS;
  const files = out.files;
  // The wrapper, the commas between entries and the advisory are spent before any file.
  const overhead = JSON.stringify({ ...out, files: [] }).length + files.length + (opts.advisory ? opts.advisory.length + 16 : 0);
  const order = files.map((f, i) => ({ i, size: JSON.stringify(f ?? null).length })).sort((a, b) => a.size - b.size);
  const servedFiles: unknown[] = files.slice();
  let remaining = Math.max(0, maxChars - overhead);
  let truncated = false;
  order.forEach(({ i, size }, n) => {
    const file = files[i];
    // Only a tool whose `offset` is NOT per path sends the model back to read a file alone.
    const alone = !pagedReadOffsetsPerPath(opts.tool ?? 'read_file') && isReadFileResult(file) && typeof file.path === 'string' ? file.path : undefined;
    const share = Math.floor(remaining / (order.length - n));
    if (isReadFileResult(file) && size > share) {
      const windowed = windowReadFile(file, { ...(opts.tool ? { tool: opts.tool } : {}), ...(alone ? { alone } : {}), maxChars: share });
      servedFiles[i] = windowed.served;
      truncated = truncated || windowed.truncated;
    }
    remaining -= JSON.stringify(servedFiles[i] ?? null).length;
  });
  const served = { ...out, files: servedFiles };
  const value = opts.advisory && opts.attachAdvisory ? (opts.attachAdvisory(served, opts.advisory) as Record<string, unknown>) : served;
  return { value, served, truncated };
}

/**
 * The lines `start`–`end` of a `read_file` result that holds them — how a covered read
 * is REPLAYED: the requested window, not the covering read's from its first line. The
 * paging fields are rewritten to describe the slice.
 */
export function sliceReadFile(out: ReadFileResult, start: number, end: number): Record<string, unknown> {
  const lines = out.content.split('\n');
  const first = typeof out.offset === 'number' && out.offset > 0 ? Math.floor(out.offset) : 1;
  const from = Math.max(first, Math.floor(start));
  const kept = lines.slice(from - first, Math.max(from - first, Math.floor(end) - first + 1));
  const lastLine = from + kept.length - 1;
  const totalLines = typeof out.totalLines === 'number' && out.totalLines > 0 ? Math.floor(out.totalLines) : undefined;
  const truncated = totalLines !== undefined ? lastLine < totalLines : out.truncated === true;
  const { note: _coveringNote, ...rest } = out;
  return {
    ...rest,
    content: kept.join('\n'),
    offset: from,
    ...(totalLines !== undefined ? { totalLines } : {}),
    truncated,
    ...(truncated ? { note: `Showing lines ${from}–${lastLine}${totalLines !== undefined ? ` of ${totalLines}` : ''}. To continue, call read_file again with offset ${lastLine + 1}.` } : {}),
  };
}
