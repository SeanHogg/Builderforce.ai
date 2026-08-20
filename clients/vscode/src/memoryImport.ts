/**
 * Memory import orchestration — the FORMAT-AGNOSTIC half of the Evermind console's
 * "Import from builderforce-memory" action.
 *
 * Two on-disk shapes carry the same facts:
 *   • a builderforce-memory JSON snapshot — ONE file, many entries (`memorySnapshot.ts`);
 *   • a Claude Code auto-memory directory — MANY files, one entry each (`markdownMemory.ts`).
 *
 * Everything above this module works in terms of `LearnableEntry`, and every entry
 * carries its OWN source path. That single change is what generalizes the protocol: the
 * old contract had one file path for the whole import, which cannot express a directory
 * where each absorbed fact must be stubbed in its own file. The snapshot case is not a
 * special case of it — it is simply an import whose entries all share one path, and it
 * still ends in exactly one rewrite of exactly that file.
 *
 * Compaction plans EVERY target before writing ANY of them, so an unreadable file aborts
 * the whole pass instead of leaving half the import stubbed and half not.
 */

import * as fs from "fs/promises";
import {
  compactSnapshotText,
  isStub,
  parseSnapshotArray,
  snapshotEntryContent,
  snapshotEntryKey,
} from "./memorySnapshot";
import {
  compactMarkdownMemory,
  isMarkdownMemoryPath,
  readMarkdownMemorySource,
  type LearnableEntry,
} from "./markdownMemory";

export type { LearnableEntry };

/** One file to compact, with the absorbed keys that live in it. */
export interface CompactTarget {
  path: string;
  keys: Set<string>;
}

/** The compaction request as it arrives from the webview. */
export interface CompactRequest {
  /** Legacy single-file form — still accepted so an older webview keeps working. */
  path?: string;
  absorbedKeys?: string[];
  /** Generalized form: one group per source file. */
  files?: Array<{ path?: string; absorbedKeys?: string[] }>;
}

/** Compaction outcome: either what was recovered, or which files could not be read. */
export type CompactOutcome =
  | { ok: true; compacted: number; bytesSaved: number }
  | { ok: false; unreadable: string[] };

/**
 * Normalize a compaction request into one target per file, merging duplicates. Accepts
 * both the legacy `{ path, absorbedKeys }` pair and the generalized `files` array — one
 * normalizer, so the rest of the pipeline never branches on which form arrived.
 */
export function compactionTargets(req: CompactRequest): CompactTarget[] {
  const byPath = new Map<string, Set<string>>();
  const add = (filePath?: string, keys?: string[]): void => {
    if (!filePath) return;
    const bucket = byPath.get(filePath) ?? new Set<string>();
    for (const key of keys ?? []) if (key) bucket.add(key);
    byPath.set(filePath, bucket);
  };
  add(req.path, req.absorbedKeys);
  for (const f of req.files ?? []) add(f?.path, f?.absorbedKeys);
  return [...byPath].map(([path, keys]) => ({ path, keys }));
}

/**
 * Read whatever the user picked into learnable entries, or `null` when it is neither a
 * memory directory nor a snapshot (the caller then explains rather than corrupting an
 * unrelated file). Entries already compacted to stubs are excluded, so re-importing the
 * same source is a no-op.
 */
export async function readMemorySource(target: string): Promise<LearnableEntry[] | null> {
  const markdown = await readMarkdownMemorySource(target);
  if (markdown) return markdown;

  let text: string;
  try {
    text = await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
  const entries = parseSnapshotArray(text);
  if (!entries) return null;
  return entries
    .map((e) => ({ key: snapshotEntryKey(e), text: snapshotEntryContent(e), path: target }))
    .filter((e) => e.key && e.text.trim() && !isStub(e.text));
}

/**
 * Rewrite the absorbed entries in every target to stubs. Plans all files first; a file
 * that cannot be parsed aborts the pass with `ok: false` and nothing written.
 */
export async function compactMemoryFiles(targets: CompactTarget[], version: number): Promise<CompactOutcome> {
  const writes: Array<{ path: string; next: string }> = [];
  const unreadable: string[] = [];
  let compacted = 0;
  let bytesSaved = 0;

  for (const target of targets) {
    let text: string;
    try {
      text = await fs.readFile(target.path, "utf8");
    } catch {
      unreadable.push(target.path);
      continue;
    }
    if (isMarkdownMemoryPath(target.path)) {
      // One file IS one entry here, so the key set only confirms it was absorbed.
      const result = compactMarkdownMemory(text, version);
      if (!result) continue;
      writes.push({ path: target.path, next: result.next });
      compacted += 1;
      bytesSaved += result.bytesSaved;
    } else {
      const result = compactSnapshotText(text, target.keys, version);
      if (!result) {
        unreadable.push(target.path);
        continue;
      }
      if (result.compacted > 0) writes.push({ path: target.path, next: result.next });
      compacted += result.compacted;
      bytesSaved += result.bytesSaved;
    }
  }

  if (unreadable.length > 0) return { ok: false, unreadable };
  for (const w of writes) await fs.writeFile(w.path, w.next);
  return { ok: true, compacted, bytesSaved };
}
