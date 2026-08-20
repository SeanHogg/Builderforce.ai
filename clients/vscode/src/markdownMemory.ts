/**
 * Claude Code auto-memory (markdown) parsing + compaction — the second file format the
 * Evermind console's "Import from builderforce-memory" action accepts.
 *
 * Where the MCP server's snapshot is ONE JSON file holding every entry, Claude Code's
 * auto-memory is a DIRECTORY: a `MEMORY.md` index plus one `*.md` file per fact, each
 * opening with a YAML frontmatter block:
 *
 *     ---
 *     name: canvas-device-frame-rule
 *     description: "Canvas previews frame the real published document…"
 *     metadata:
 *       node_type: memory
 *       type: project
 *     ---
 *     <the fact itself, markdown>
 *
 * So a memory here is `key = name` (or the filename stem), `text = body`, and
 * `prompt = description` — the same learnable shape `memorySnapshot.ts` yields, which is
 * why the importer needed no second pipeline, only per-entry SOURCE PATHS (each fact is
 * its own file, so compaction rewrites N files rather than one).
 *
 * `MEMORY.md` itself is deliberately NOT learnable: it is a table of contents of links
 * into the per-fact files, so absorbing it teaches nothing new and stubbing it would
 * destroy the index the rest of the directory is navigated by.
 *
 * Stub text/idempotency come from `memorySnapshot.ts` — ONE marker across both formats,
 * so re-importing a mixed set never double-stubs anything.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { isStub, memoryStub } from "./memorySnapshot";

/** The index file at the root of a Claude Code memory directory. */
export const MEMORY_INDEX_FILE = "MEMORY.md";

/** Extensions treated as markdown memory files. */
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);

/** A learnable entry — the shape the gateway's `extract-memories` consumes, plus the
 *  SOURCE FILE it came from so compaction can rewrite exactly that file. */
export interface LearnableEntry {
  key: string;
  text: string;
  prompt?: string;
  /** Absolute path of the file this entry lives in. */
  path: string;
}

/** A split markdown memory file: its frontmatter block (verbatim) and its body. */
export interface ParsedMarkdownMemory {
  /** The frontmatter block including both `---` fences, or '' when there is none. */
  frontmatter: string;
  /** Top-level scalar frontmatter keys (nested blocks like `metadata:` are skipped). */
  attrs: Record<string, string>;
  /** Everything after the frontmatter, leading blank lines trimmed. */
  body: string;
}

/** Strip matching surrounding quotes from a YAML scalar. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Split a markdown memory file into frontmatter + body.
 *
 * Only TOP-LEVEL scalar keys are read: a key with an empty value opens a nested block
 * (`metadata:`) whose indented lines are skipped. That is everything this importer needs
 * (`name`, `description`) and it keeps a YAML dependency out of the extension bundle.
 */
export function parseFrontmatter(text: string): ParsedMarkdownMemory {
  const normalized = text.replace(/^\uFEFF/, "");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!match) return { frontmatter: "", attrs: {}, body: normalized.replace(/^(?:\r?\n)+/, "") };

  const attrs: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line) || !line.trim()) continue; // nested block line or blank
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const value = unquote(kv[2]);
    if (value) attrs[kv[1]] = value;
  }

  return {
    frontmatter: normalized.slice(0, match[0].length).replace(/\r?\n$/, ""),
    attrs,
    body: normalized.slice(match[0].length).replace(/^(?:\r?\n)+/, ""),
  };
}

/** True when `filePath` is a markdown file (per-fact or the index). */
export function isMarkdownMemoryPath(filePath: string): boolean {
  return MARKDOWN_EXTS.has(path.extname(filePath).toLowerCase());
}

/** True when `filePath` is the directory's `MEMORY.md` index rather than a fact. */
export function isMemoryIndexPath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === MEMORY_INDEX_FILE.toLowerCase();
}

/**
 * Turn one markdown memory file's text into a learnable entry, or `null` when there is
 * nothing to learn — an empty body, or a body that is already a compaction stub (so
 * re-importing a directory is idempotent, exactly as the JSON path is).
 */
export function markdownEntry(text: string, filePath: string): LearnableEntry | null {
  const { attrs, body } = parseFrontmatter(text);
  const key = attrs.name?.trim() || path.basename(filePath).replace(/\.(md|markdown)$/i, "");
  if (!key || !body.trim() || isStub(body)) return null;
  const prompt = attrs.description?.trim();
  return { key, text: body, path: filePath, ...(prompt ? { prompt } : {}) };
}

/**
 * Rewrite a markdown memory file's BODY to a terse stub, keeping its frontmatter intact
 * (the `name` is the entry's key and the index links to the file by name — losing either
 * would orphan the pointer). Returns `null` when there is nothing worth rewriting.
 */
export function compactMarkdownMemory(text: string, version: number): { next: string; bytesSaved: number } | null {
  const { frontmatter, body } = parseFrontmatter(text);
  if (!body.trim() || isStub(body)) return null;
  const stub = memoryStub(body, version);
  if (stub.length >= body.length) return null; // never grow an entry
  const next = frontmatter ? `${frontmatter}\n\n${stub}\n` : `${stub}\n`;
  return { next, bytesSaved: body.length - stub.length };
}

/** Read every learnable per-fact entry in a memory directory, sorted by file name. */
export async function readMemoryDirectory(dir: string): Promise<LearnableEntry[]> {
  const names = (await fs.readdir(dir)).filter((n) => isMarkdownMemoryPath(n) && !isMemoryIndexPath(n)).sort();
  const entries: LearnableEntry[] = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch {
      continue; // a directory that happens to end in .md, or an unreadable file
    }
    const entry = markdownEntry(text, filePath);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Resolve whatever the user picked into markdown memory entries, or `null` when the
 * target is not markdown at all (the caller then tries the JSON snapshot path).
 *
 * Accepts a memory DIRECTORY, its `MEMORY.md` index (the file a file-picker can reach),
 * or a single per-fact `*.md`.
 */
export async function readMarkdownMemorySource(target: string): Promise<LearnableEntry[] | null> {
  let isDirectory = false;
  try {
    isDirectory = (await fs.stat(target)).isDirectory();
  } catch {
    return null;
  }
  if (isDirectory) return readMemoryDirectory(target);
  if (!isMarkdownMemoryPath(target)) return null;
  if (isMemoryIndexPath(target)) return readMemoryDirectory(path.dirname(target));
  const entry = markdownEntry(await fs.readFile(target, "utf8"), target);
  return entry ? [entry] : [];
}
