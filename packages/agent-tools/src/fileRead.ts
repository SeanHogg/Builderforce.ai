/**
 * What `read_file` returns for ONE file — the line window, the JSON `key` subtree, and
 * the large-Markdown outline — kept out of `core-tools.ts` so the tool definition there
 * is only its schema and its `path` / `paths[]` dispatch.
 *
 * `paths[]` (PRD 35 E4) reads up to {@link READ_FILE_MAX_PATHS} files in one call; each
 * entry is exactly the single-file result, so every consumer of a `read_file` result
 * (the transcript budget, read coverage) handles an entry the way it handles one read.
 */

import type { CapabilityProvider, RepoReadResult } from "./capabilities.js";
import { readJsonKey } from "./jsonKeyRead.js";
import { fileWindowNote, windowFileContent } from "./fileWindow.js";
import { markdownOutline } from "./symbol-tools.js";

/** The most files one `read_file` call reads with `paths[]`. */
export const READ_FILE_MAX_PATHS = 8;

/**
 * A Markdown file larger than this (chars) is "larger than one read": the transcript's
 * `read_file` budget is 16K chars on the smallest window (`@builderforce/tool-output-policy`
 * `TOOL_OUTPUT_CAPS.read_file`), so a bigger document arrives in several windows and the
 * model is better served paging by heading.
 */
export const MARKDOWN_OUTLINE_MIN_CHARS = 16_000;

/** The arguments every file of one `read_file` call shares. */
export interface FileReadOptions {
  offset?: number;
  limit?: number;
  key?: string;
}

/** `read_file` with `key`: one JSON subtree (see `jsonKeyRead.ts`). */
function readFileKey(path: string, file: RepoReadResult, key: string): Record<string, unknown> {
  if (file.truncated === true) {
    return { ok: false, path, key, error: "the file is too large to load whole, so `key` cannot be used — page it with offset/limit" };
  }
  const read = readJsonKey(file.content ?? "", key);
  if (!read.ok) return { path, key, ...read };
  if ("tooLarge" in read) {
    return {
      ok: true,
      path,
      key: read.key,
      childKeys: read.childKeys,
      note: `"${read.key}" is ${read.size} characters — too large to return whole. Read one of its childKeys, e.g. key "${read.key}.${read.childKeys[0] ?? "…"}".`,
    };
  }
  return { ok: true, path, key: read.key, content: read.content };
}

const isMarkdown = (path: string): boolean => /\.mdx?$/i.test(path);

/** Read one file the way `read_file` always has, plus the outline of a large Markdown file. */
export async function readOneFile(path: string, opts: FileReadOptions, caps: CapabilityProvider): Promise<Record<string, unknown>> {
  const r = (await caps.repoRead!.readFile(path)) as RepoReadResult;
  if (!r.ok) return r as unknown as Record<string, unknown>;
  if (opts.key) return readFileKey(r.path ?? path, r, opts.key);
  const content = r.content ?? "";
  const win = windowFileContent(content, { offset: opts.offset, limit: opts.limit });
  const data: RepoReadResult & { outline?: Array<{ heading: string; line: number }> } = {
    ok: true,
    path: r.path ?? path,
    content: win.content,
    truncated: win.truncated || r.truncated === true,
    totalLines: win.totalLines,
    offset: win.offset,
  };
  let note = fileWindowNote(win);
  // A first read of a long document: hand over its headings with their lines, so the next
  // read pages straight to the section it needs.
  if (opts.offset === undefined && isMarkdown(data.path ?? path) && (content.length > MARKDOWN_OUTLINE_MIN_CHARS || win.truncated)) {
    const outline = markdownOutline(data.path ?? path, content);
    if (outline.length > 0) {
      data.outline = outline;
      const pointer = "This document is larger than one read: `outline` lists its headings with their line numbers — page by heading line with offset (and a small limit) instead of reading it window by window.";
      note = note ? `${note} ${pointer}` : pointer;
    }
  }
  if (note) data.note = note;
  return data as unknown as Record<string, unknown>;
}

/** Read each of `paths` independently; a file that cannot be read is its own failed entry. */
export async function readManyFiles(paths: readonly string[], opts: FileReadOptions, caps: CapabilityProvider): Promise<Record<string, unknown>[]> {
  return Promise.all(
    paths.map((path) =>
      readOneFile(path, opts, caps).catch((err: unknown) => ({ ok: false, path, error: err instanceof Error ? err.message : String(err) })),
    ),
  );
}
