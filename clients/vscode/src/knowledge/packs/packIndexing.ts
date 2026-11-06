/**
 * Making a loaded pack queryable (PRD 40): reading and writing the `.bfpack` file, indexing
 * its graph under its own root in the host knowledge index, re-indexing every remembered
 * pack at startup, and the retrieval port the editor's consumers query packs through.
 *
 * The file is the only on-disk contract; the index is derived from it and idempotent (cards
 * upsert by hash), so a pack loaded twice, or re-indexed on every start, costs nothing.
 * A pack of a root an open workspace folder holds is NEVER indexed from the file: that
 * folder's own review owns its index, and an older pack must not roll it back.
 * No `vscode` import: the files are plain paths (the extension host reads them directly).
 */

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import * as path from "path";
import { packGraph, parsePack, serializePack, type PortableKnowledgePack } from "@builderforce/agent-tools/knowledge";
import { packRetrievalPort, withPacks, type PackRetrievalPort, type RecallingIndex } from "@builderforce/agent-tools/knowledge-index";
import { hostKnowledgeIndexCore, ownsKnowledgeRoot } from "../index/hostKnowledgeIndex";
import { loadedPackRegistry } from "./loadedPackRegistry";

type PackError = (what: string, error: unknown) => void;

/** Where pack failures are reported (the output channel at activation); silent before that. */
let reportError: PackError = () => undefined;
export function configurePackErrors(report: PackError): void {
  reportError = report;
}

/** Parsed packs by path, valid while the file's mtime and size are unchanged — listing and loading a pack re-parse nothing. */
const parsed = new Map<string, { stamp: string; pack: PortableKnowledgePack }>();
const PARSED_MAX = 16;

export async function readPackFile(filePath: string): Promise<PortableKnowledgePack> {
  const info = await stat(filePath);
  const stamp = `${info.mtimeMs}:${info.size}`;
  const hit = parsed.get(filePath);
  if (hit?.stamp === stamp) return hit.pack;
  const pack = parsePack(await readFile(filePath, "utf8"));
  parsed.delete(filePath);
  parsed.set(filePath, { stamp, pack });
  if (parsed.size > PARSED_MAX) parsed.delete(parsed.keys().next().value as string);
  return pack;
}

export async function writePackFile(filePath: string, pack: PortableKnowledgePack): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializePack(pack), "utf8");
  parsed.delete(filePath);
}

/**
 * Makes a pack queryable: its graph (rebuilt from its snapshot) feeds the host knowledge
 * index. Returns the cards indexed — 0 for a pack with nothing to index, and for a pack of a
 * workspace folder's own root, whose index that folder's review owns. Idempotent.
 */
export async function indexPack(pack: PortableKnowledgePack): Promise<number> {
  if (ownsKnowledgeRoot(pack.rootId)) return 0;
  const graph = await packGraph(pack);
  if (!graph) return 0;
  await hostKnowledgeIndexCore(pack.rootId).upsertFromGraph(graph);
  return graph.nodes.length;
}

/**
 * Re-indexes every remembered pack whose file still exists (called once at activation, not
 * awaited by it). The host index persists under a workspace; with no folder open it lives in
 * memory, and this is what gives a clean window its packs back. One pack at a time, yielding
 * between them, so a dozen large packs never hold the extension host. A missing or
 * unreadable file is reported and skipped, never forgotten — the person may reconnect the drive.
 */
export async function reindexLoadedPacks(onError: PackError = reportError): Promise<void> {
  for (const entry of loadedPackRegistry().all()) {
    if (!entry.path) continue;
    try {
      await indexPack(await readPackFile(entry.path));
    } catch (error) {
      onError(`pack reindex ${entry.name}`, error);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** `primary` (the workspace's index; absent with no folder open) with the loaded packs merged in — what chat and the context pack recall through. */
export function withLoadedPacks(primary: RecallingIndex | undefined): RecallingIndex {
  return withPacks(primary, loadedPackRegistry(), editorPackRetrieval(reportError));
}

/** The editor's retrieval port over the loaded packs' indexes — the ONE way consumers query packs. */
export function editorPackRetrieval(onError?: PackError): PackRetrievalPort {
  return packRetrievalPort({
    indexOf: hostKnowledgeIndexCore,
    ...(onError ? { onError: (rootId, error) => onError(`pack recall ${rootId}`, error) } : {}),
  });
}
