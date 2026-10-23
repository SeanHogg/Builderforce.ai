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
 * the whole pass instead of leaving half the import stubbed and half not — and it is
 * LOSSLESS: each fact is probed against the project Evermind before it is stubbed, and
 * every original is archived before any stub is written.
 */

import * as fs from "fs/promises";
import {
  defaultArchiveFile,
  isStub,
  mergeArchive,
  type ArchivedFact,
  type CompactionSkip,
  type RecallProbe,
} from "@seanhogg/builderforce-memory-mcp/compaction";
import {
  compactSnapshotText,
  parseSnapshotArray,
  snapshotEntryContent,
  snapshotEntryKey,
} from "./memorySnapshot";
import {
  compactMarkdownMemory,
  isMarkdownMemoryPath,
  markdownArchiveFile,
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

/** How many absorbed facts were left whole, per reason. */
export type SkipTally = Record<CompactionSkip["reason"], number>;

/** Compaction outcome: either what was recovered (and what was kept whole, and why),
 *  or which files could not be read. */
export type CompactOutcome =
  | { ok: true; compacted: number; bytesSaved: number; skipped: SkipTally }
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

/** An empty per-reason tally — a `Record` over the reason union, so a new reason fails the build here. */
function emptySkipTally(): SkipTally {
  return { not_found: 0, already_compacted: 0, not_smaller: 0, no_probe: 0, probe_failed: 0, no_archive: 0 };
}

/**
 * Rewrite the absorbed entries in every target to stubs, LOSSLESSLY: a fact is stubbed
 * only once `probe` (the project Evermind) answers the question generated from it, and
 * every stubbed original is merged into its archive sidecar (`defaultArchiveFile` beside
 * a snapshot, `markdownArchiveFile` for a memory directory) BEFORE any stub is written.
 * No probe ⇒ nothing is stubbed and every fact is reported `no_probe`.
 *
 * Plans all files first; a file that cannot be parsed aborts the pass with `ok: false`
 * and nothing written. An archive that cannot be written aborts before any stub is.
 */
export async function compactMemoryFiles(
  targets: CompactTarget[],
  version: number,
  probe: RecallProbe | null,
): Promise<CompactOutcome> {
  const writes: Array<{ path: string; next: string }> = [];
  const archives = new Map<string, ArchivedFact[]>();
  const unreadable: string[] = [];
  const skipped = emptySkipTally();
  let compacted = 0;
  let bytesSaved = 0;
  const archiveInto = (file: string, facts: ArchivedFact[]): void => {
    if (facts.length > 0) archives.set(file, [...(archives.get(file) ?? []), ...facts]);
  };

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
      const result = await compactMarkdownMemory(text, target.path, version, probe);
      if (result.next === undefined) {
        skipped[result.skipped.reason] += 1;
        continue;
      }
      writes.push({ path: target.path, next: result.next });
      archiveInto(markdownArchiveFile(target.path), [result.archive]);
      compacted += 1;
      bytesSaved += result.bytesSaved;
    } else {
      const result = await compactSnapshotText(text, target.keys, version, probe);
      if (!result) {
        unreadable.push(target.path);
        continue;
      }
      for (const s of result.skipped) skipped[s.reason] += 1;
      if (result.compacted > 0) writes.push({ path: target.path, next: result.next });
      archiveInto(defaultArchiveFile(target.path), result.archive);
      compacted += result.compacted;
      bytesSaved += result.bytesSaved;
    }
  }

  if (unreadable.length > 0) return { ok: false, unreadable };
  // ARCHIVE FIRST. A stub written without its original on disk is a fact destroyed —
  // which is exactly how the earlier in-place compactor lost a user's memories.
  for (const [file, facts] of archives) {
    let existing: string | null = null;
    try {
      existing = await fs.readFile(file, "utf8");
    } catch {
      existing = null; // first compaction: no archive yet
    }
    await fs.writeFile(file, mergeArchive(existing, facts));
  }
  for (const w of writes) await fs.writeFile(w.path, w.next);
  return { ok: true, compacted, bytesSaved, skipped };
}
