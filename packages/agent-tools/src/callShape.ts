/**
 * THE reading of "which files does this call change, and how" — from the SHAPE of its
 * arguments, never a tool list. Every reader of a write call goes through here: the run
 * view's written paths and the post-edit notes ({@link editedFilesOf} in `edit.ts`), and
 * every in-run guard in `@builderforce/run-guards` (fingerprint path, edit-revert, the
 * no-progress window, the progress detector) — so a shape one of them sees, all see.
 * (It lives here, not in run-guards, because run-guards depends on this package.)
 *
 * Shapes, at the top level and in each entry of an `edits: [...]` batch (an entry with no
 * path takes the call's):
 *  - the path: `path`, `file_path` or `filePath` — trimmed, `\` → `/`, no leading `./`;
 *  - a whole body: `content`;
 *  - a replacement: `old_string`/`new_string` (or `oldString`/`newString`, or `find`/`replace`).
 *
 * The batched form (`edit_file({ edits: [...] })`, PRD 45 §4.7 B3) was once invisible to
 * every guard (VS Code chat #146477). Pure.
 */

/** A call's or entry's path (`path`, `file_path` or `filePath`), trimmed, `/`-separated, without a leading `./`; null when none. */
export function callPathOf(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const a = args as Record<string, unknown>;
  for (const p of [a.path, a.file_path, a.filePath]) {
    if (typeof p === "string" && p.trim()) return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  }
  return null;
}

/** One write entry as its arguments state it: the call's own (top level) or one `edits[]` entry. Raw — nothing filtered. */
export interface CallWriteEntry {
  path: string | null;
  /** A whole body (`content`). */
  content?: string;
  /** The replaced text. */
  before?: string;
  /** The replacement. */
  after?: string;
  /** An `edits[]` entry, not the call's own top level. */
  batched: boolean;
}

function str(a: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function entryOf(e: Record<string, unknown>, fallback: string | null, batched: boolean): CallWriteEntry {
  const content = str(e, "content");
  const before = str(e, "old_string", "oldString", "find");
  const after = str(e, "new_string", "newString", "replace");
  return {
    path: callPathOf(e) ?? fallback,
    batched,
    ...(content !== undefined ? { content } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}

/** The call's own entry first, then each `edits[]` entry in order. Empty for a non-object. */
export function callWriteEntriesOf(args: unknown): CallWriteEntry[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;
  const top = entryOf(a, null, false);
  const out = [top];
  if (Array.isArray(a.edits)) {
    for (const raw of a.edits) {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) out.push(entryOf(raw as Record<string, unknown>, top.path, true));
    }
  }
  return out;
}

/** One file one call changes: a whole body (`content`), or a replacement (`from` → `to`). */
export type CallChange = { path: string; content: string } | { path: string; from: string; to: string };

/**
 * Every CHANGE a call's arguments describe, in order (a path may repeat): an entry with a
 * path and a body, or with both sides of a replacement that differ. Empty when the call
 * changes no file content by its shape.
 */
export function callChangesOf(args: unknown): CallChange[] {
  const out: CallChange[] = [];
  for (const e of callWriteEntriesOf(args)) {
    if (!e.path) continue;
    if (e.content !== undefined) out.push({ path: e.path, content: e.content });
    else if (e.before !== undefined && e.after !== undefined && e.before !== e.after) out.push({ path: e.path, from: e.before, to: e.after });
  }
  return out;
}

/** The distinct paths a call changes, first-seen order. */
export function changedPathsOf(args: unknown): string[] {
  return [...new Set(callChangesOf(args).map((c) => c.path))];
}
