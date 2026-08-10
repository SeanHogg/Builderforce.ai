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
 * agent's context while a one-line pointer (and the model's learned copy) remain.
 */

/** Marker that opens every compacted stub — also the idempotency guard (an entry whose
 *  content already starts with this is skipped, so re-import never double-stubs). */
export const STUB_PREFIX = "[absorbed→Evermind";

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

/** True when a body is already a compaction stub (skip on import + on re-compact). */
export function isStub(content: string): boolean {
  return content.trimStart().startsWith(STUB_PREFIX);
}

/** The first non-empty line of a body, trimmed to `max` chars — the stub's pointer text. */
export function firstLine(content: string, max = 140): string {
  const line = content.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Build the terse stub that replaces an absorbed entry's body. */
export function memoryStub(content: string, version: number): string {
  return `${STUB_PREFIX} v${version}] ${firstLine(content)}`;
}
