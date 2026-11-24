/**
 * The portable knowledge pack's ONE on-disk form (PRD 40): a `.bfpack` file is
 * {@link serializePack}'s canonical JSON ({@link parsePack} validates it back). A `.bfpack.gz`
 * (the library default, PRD 49 §5 — `packCompress.ts`) is the same JSON gzipped. This module is
 * worker-safe — the graph worker reads a pack's file itself (`graphWorkerEntry.ts`), so nothing
 * here may reach `vscode`; the paths are plain strings the extension host (or a worker) hands in.
 *
 * Reads are cached by the file's content (mtime + size): a pack the indexer, the view and the
 * retrieval all read in one pass is parsed ONCE; a write invalidates the entry, so the next read
 * re-reads. The cache returns the SAME object identity until the file changes, so a caller holding
 * the last parse never sees it swap underneath.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { gzipText, isGzipPath, readGzipText } from "@builderforce/agent-tools";
import { parsePack, serializePack, type PortableKnowledgePack } from "@builderforce/agent-tools/knowledge";

/** One cache entry: the file's identity (mtime + size) and the parsed pack it held. */
interface PackCacheEntry {
  mtimeMs: number;
  size: number;
  pack: PortableKnowledgePack;
}

const cache = new Map<string, PackCacheEntry>();

/** The pack's text: a `.gz` is inflated through the one gzip reader. */
async function packText(file: string): Promise<string> {
  return isGzipPath(file) ? readGzipText(await fs.promises.readFile(file)) : fs.promises.readFile(file, "utf8");
}

/** Reads and validates a `.bfpack` (or `.bfpack.gz`) file; throws {@link parsePack}'s descriptive error on any malformed field. Cached by content. */
export async function readPackFile(file: string): Promise<PortableKnowledgePack> {
  const stat = await fs.promises.stat(file);
  const held = cache.get(file);
  if (held && held.mtimeMs === stat.mtimeMs && held.size === stat.size) return held.pack;
  const pack = parsePack(await packText(file));
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, pack });
  return pack;
}

/**
 * Writes a pack as canonical JSON (one trailing newline, like any text artifact the extension writes), creating the folder.
 * A `.gz` path is written gzipped. The path is never renamed here: the caller chose it (through `packWritePath`).
 */
export async function writePackFile(file: string, pack: PortableKnowledgePack): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const text = `${serializePack(pack)}\n`;
  await (isGzipPath(file) ? fs.promises.writeFile(file, await gzipText(text)) : fs.promises.writeFile(file, text, "utf8"));
  cache.delete(file); // the file changed: the next read re-reads and re-parses
}
