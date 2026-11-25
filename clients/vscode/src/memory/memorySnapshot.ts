/**
 * builderforce-memory snapshot parsing + compaction helpers — the file-format half of
 * the Evermind console's "Import from builderforce-memory" action. Kept separate from
 * the webview host (evermindView.ts) so the pure parse/stub logic is unit-testable
 * without a VS Code window.
 *
 * The snapshot is the on-disk mirror the memory MCP server keeps (its
 * `BUILDERFORCE_MEMORY_FILE`): a flat JSON array of durable entries, each at least
 * `{ key, content }` (older exports use `value`; extra fields like `tags` / `importance`
 * are preserved untouched on rewrite). Compaction replaces an ABSORBED entry's body with
 * a terse `[absorbed→Evermind vN] <first line>` stub, so the fact stops filling the
 * agent's context while a one-line pointer (and the model's learned copy) remain — and
 * only once the model is PROVEN to carry it, with the original archived first.
 *
 * The stub RULES (marker, pointer line, "never grow an entry", probe, archive) are the memory server's
 * own (`@seanhogg/builderforce-memory-mcp/compaction`), so a stub written here and one
 * written by the server's `memory_compact` tool are byte-identical and neither re-stubs
 * the other. This file owns only the snapshot FILE format around them.
 */
import {
  planLosslessCompaction,
  type ArchivedFact,
  type CompactionSkip,
  type RecallProbe,
} from "@seanhogg/builderforce-memory-mcp/compaction";

/** A raw snapshot entry — an object bag; only `key` + a content field are load-bearing. */
export type SnapshotEntry = Record<string, unknown>;

/**
 * Parse a snapshot file's text into its entry array, or `null` when it isn't a
 * recognizable builderforce-memory snapshot (so the caller can explain rather than
 * corrupt an unrelated file). Accepts a bare array or `{ entries: [...] }`.
 */
export function parseSnapshotArray(text: string): SnapshotEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null;
  if (!arr) return null;
  return arr.filter((e): e is SnapshotEntry => !!e && typeof e === "object" && !Array.isArray(e));
}

/** The entry's stable key, or '' when absent. */
export function snapshotEntryKey(e: SnapshotEntry): string {
  return typeof e.key === "string" ? e.key : "";
}

/** The entry's fact body — `content` (current) or `value` (legacy exports). */
export function snapshotEntryContent(e: SnapshotEntry): string {
  if (typeof e.content === "string") return e.content;
  if (typeof e.value === "string") return e.value;
  return "";
}

/** Write the body back to whichever field the entry uses (defaults to `content`). */
export function setSnapshotEntryContent(e: SnapshotEntry, next: string): void {
  if (typeof e.value === "string" && typeof e.content !== "string") e.value = next;
  else e.content = next;
}

/** The result of compacting a snapshot's absorbed entries in place. */
export interface SnapshotCompaction {
  /** The rewritten file text — write it only AFTER `archive` is on disk. */
  next: string;
  /** How many entries were stubbed. */
  compacted: number;
  /** Characters recovered across those entries. */
  bytesSaved: number;
  /** The full original of every stubbed entry, keyed by its real key. */
  archive: ArchivedFact[];
  /** The absorbed entries left whole, and why (an unproven absorption is one). */
  skipped: CompactionSkip[];
}

/**
 * Plan the LOSSLESS stubbing of every ABSORBED entry in a snapshot's text, preserving all
 * other fields and every untouched entry. Returns `null` when the text isn't a
 * recognizable snapshot, so the caller can report rather than corrupt the file.
 *
 * Lossless means the memory server's two rules (`planLosslessCompaction`): an entry is
 * stubbed only once `probe` — the project Evermind — answers the question generated from
 * it, and the caller must write `archive` (to `defaultArchiveFile(snapshotPath)`) BEFORE
 * it writes `next`. No probe ⇒ nothing is stubbed. The old in-place rewrite did neither,
 * and a "compacted" snapshot was the only copy of facts the model had never learned.
 *
 * Pure apart from the probe — the host does the I/O. This is the JSON half of the
 * two-format compactor; `markdownMemory.compactMarkdownMemory` is the markdown half, and
 * both produce the same `STUB_PREFIX` marker so neither ever double-stubs the other's work.
 */
export async function compactSnapshotText(
  text: string,
  absorbedKeys: Iterable<string>,
  version: number,
  probe: RecallProbe | null,
): Promise<SnapshotCompaction | null> {
  const entries = parseSnapshotArray(text);
  if (!entries) return null;
  const absorbed = new Set(absorbedKeys);
  const archive: ArchivedFact[] = [];
  const skipped: CompactionSkip[] = [];
  let bytesSaved = 0;
  // One plan PER ENTRY, so two entries that share a key each get their own stub, probe
  // and archive row, and every write maps back to exactly the entry it came from.
  for (const target of entries.filter((e) => absorbed.has(snapshotEntryKey(e)))) {
    const plan = await planLosslessCompaction(
      [{ key: snapshotEntryKey(target), content: snapshotEntryContent(target) }],
      { version, probe },
    );
    skipped.push(...plan.skipped);
    for (const w of plan.writes) {
      archive.push(w.archive);
      setSnapshotEntryContent(target, w.content);
      bytesSaved += w.bytesSaved;
    }
  }
  return { next: `${JSON.stringify(entries, null, 2)}\n`, compacted: archive.length, bytesSaved, archive, skipped };
}
