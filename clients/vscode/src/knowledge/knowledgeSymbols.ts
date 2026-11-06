/**
 * The map's class and function levels, host side: the definitions in some files of a root.
 * The stored graph holds files only (symbols would multiply its size), so when the person goes
 * inside a package the view asks for the symbols of that package's top files.
 *
 * The request comes from the webview, so nothing in it is trusted:
 *   - the file list is validated and capped HERE (the host's cap is the only cap);
 *   - a ref is decoded with `sourcePathOf` (never URL-decoded) and must be a code file the symbol
 *     extractor understands BEFORE it is stat'ed or read, so `.env`, keys, markdown and sql never are;
 *   - the path must be safe and reach no link (`knowledgeFixPaths.ts`), and be a regular file under the size cap,
 *     read through a bounded read, so a FIFO, a directory or a growing file cannot hang or flood the host.
 * Definitions come from agent-tools' ONE symbol extractor, which names each member's container.
 *
 * Repeats are cheap: answers are cached per file (path, mtime, size), and {@link SymbolsGate} lets one call
 * per root run at a time and hands identical requests the answer already on its way.
 */

import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { extractSymbols, isSymbolIndexable, type CodeSymbol } from "@builderforce/agent-tools";
import { isCodePath, sourcePathOf } from "@builderforce/agent-tools/knowledge";
import { assertInsideRoot } from "./knowledgeFixPaths";
import type { KnowledgeSymbolRecord } from "./knowledgeProtocol";
import { isSafeRelative } from "./safePath";

export const MAX_SYMBOL_FILES = 200;
export const MAX_SYMBOL_FILE_BYTES = 512 * 1024;
export const MAX_SYMBOL_TOTAL_BYTES = 8 * 1024 * 1024;
/** A ref longer than this is not a ref of ours. */
export const MAX_REF_LENGTH = 4096;
/** Files whose answers stay cached. */
export const SYMBOL_CACHE_FILES = 2000;

/** The disk, injected so the rules are tested without one. */
export interface SymbolFilePorts {
  guard(root: string, rel: string): Promise<void>;
  stat(path: string): Promise<{ size: number; isFile: boolean; mtimeMs: number }>;
  /** At most `maxBytes` of the file as text; null when the file is longer than that. */
  read(path: string, maxBytes: number): Promise<string | null>;
}

export const nodeSymbolPorts: SymbolFilePorts = {
  guard: assertInsideRoot,
  async stat(path) {
    const s = await stat(path);
    return { size: s.size, isFile: s.isFile(), mtimeMs: s.mtimeMs };
  },
  async read(path, maxBytes) {
    const handle = await open(path, "r");
    try {
      // One byte past the limit tells a file that grew since the stat from one that fits.
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
      return bytesRead > maxBytes ? null : buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

/** The file refs a request names, made safe to iterate: an array of distinct strings of sane length, at most {@link MAX_SYMBOL_FILES}. */
export function cleanFileRefs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const refs = (input.slice(0, MAX_SYMBOL_FILES * 2) as unknown[]).filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= MAX_REF_LENGTH);
  return [...new Set(refs)].slice(0, MAX_SYMBOL_FILES);
}

/** A least-recently-used cache of one file's records, keyed by what makes them stale (path, mtime, size). */
export class SymbolCache {
  private readonly entries = new Map<string, KnowledgeSymbolRecord[]>();
  constructor(private readonly max: number = SYMBOL_CACHE_FILES) {}

  static key(rootPath: string, fileRef: string, mtimeMs: number, size: number): string {
    return `${rootPath}\0${fileRef}\0${mtimeMs}\0${size}`;
  }

  get(key: string): KnowledgeSymbolRecord[] | undefined {
    const hit = this.entries.get(key);
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); }
    return hit;
  }

  set(key: string, records: KnowledgeSymbolRecord[]): void {
    this.entries.delete(key);
    this.entries.set(key, records);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * A file's records. The extractor names each member's container; the member's parent is that container's
 * record in the same file (the nearest one at or above it), else the file. A ref is `#Container.name@line`,
 * unique even when two classes each have a `run`. Pure.
 */
export function recordsOfFile(fileRef: string, symbols: readonly CodeSymbol[]): KnowledgeSymbolRecord[] {
  const refOf = (s: CodeSymbol): string => `${fileRef}#${s.container ? `${s.container}.` : ""}${s.name}@${s.line}`;
  const containers = new Map<string, CodeSymbol[]>();
  for (const s of symbols) if (!s.container) (containers.get(s.name) ?? containers.set(s.name, []).get(s.name)!).push(s);
  return symbols.map((s) => {
    const owners = s.container ? containers.get(s.container) : undefined;
    const owner = owners ? [...owners].reverse().find((o) => o.line <= s.line) ?? owners[0] : undefined;
    return { ref: refOf(s), name: s.name, kind: s.kind, parent: owner ? refOf(owner) : fileRef, line: s.line, exported: s.exported };
  });
}

/** The definitions in `fileRefs` (the refs of `rootId`'s files) under `rootPath`. */
export async function rootSymbols(
  rootPath: string, rootId: string, fileRefs: unknown, ports: SymbolFilePorts = nodeSymbolPorts, cache: SymbolCache = sharedCache,
): Promise<KnowledgeSymbolRecord[]> {
  const out: KnowledgeSymbolRecord[] = [];
  let total = 0;
  for (const fileRef of cleanFileRefs(fileRefs)) {
    try {
      const rel = fileRef.includes("#") ? undefined : sourcePathOf(fileRef, rootId);
      // Gate on the NAME before touching the disk: only source the extractor understands is ever opened.
      if (!rel || !isSafeRelative(rel) || !isCodePath(rel) || !isSymbolIndexable(rel)) continue;
      await ports.guard(rootPath, rel);
      const path = join(rootPath, rel);
      const info = await ports.stat(path);
      if (!info.isFile || info.size > MAX_SYMBOL_FILE_BYTES || total + info.size > MAX_SYMBOL_TOTAL_BYTES) continue;
      total += info.size;
      const key = SymbolCache.key(rootPath, fileRef, info.mtimeMs, info.size);
      let records = cache.get(key);
      if (!records) {
        const text = await ports.read(path, MAX_SYMBOL_FILE_BYTES);
        if (text === null) continue;
        records = recordsOfFile(fileRef, extractSymbols(rel, text));
        cache.set(key, records);
      }
      out.push(...records);
    } catch {
      // An unsafe, missing or unreadable file has no symbols here; the others still answer.
      continue;
    }
  }
  return out;
}

const sharedCache = new SymbolCache();

/**
 * One symbols call per root at a time: a call waits for the one before it on the same root, and a call
 * identical to one already running or waiting gets that call's answer instead of reading again.
 */
export class SymbolsGate {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly running = new Map<string, Promise<KnowledgeSymbolRecord[]>>();

  run(rootId: string, fileRefs: unknown, task: (refs: string[]) => Promise<KnowledgeSymbolRecord[]>): Promise<KnowledgeSymbolRecord[]> {
    const refs = cleanFileRefs(fileRefs);
    const key = `${rootId}\0${refs.join("\0")}`;
    const same = this.running.get(key);
    if (same) return same;
    const after = this.tails.get(rootId) ?? Promise.resolve();
    const result = after.then(() => task(refs), () => task(refs));
    const settled = result.then(() => undefined, () => undefined);
    this.tails.set(rootId, settled);
    this.running.set(key, result);
    void settled.then(() => {
      if (this.running.get(key) === result) this.running.delete(key);
      if (this.tails.get(rootId) === settled) this.tails.delete(rootId);
    });
    return result;
  }
}
