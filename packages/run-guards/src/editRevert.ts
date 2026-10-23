/**
 * EDIT-REVERT detection: a change whose result puts a file back the way it was earlier
 * in the run. The model wrote A, then B, then A again; or it edited X→Y and later Y→X.
 * Each step succeeded, so no failure guard fires, and the run report scores the run as
 * busy — but the file is where it started and the turns are gone. Two edits that undo
 * each other are the clearest sign a run is oscillating between two ideas instead of
 * converging.
 *
 * Detected from the SHAPE of the call, never a tool list (like {@link WriteLedger}):
 *  - a full-content write (`path` + `content`) restores content when its hash equals an
 *    EARLIER write of that path and the latest change was something else (an identical
 *    consecutive write is a repeat, the write ledger's business, not a revert);
 *  - a find/replace edit (`old_string`/`new_string`, or `find`/`replace`) is the inverse
 *    of an earlier edit of that path since its last full write.
 *
 * Only hashes are kept, so the state stays small enough to ride durable storage. Pure.
 */
import { contentHash, pathArgOf } from "./fingerprint.js";

/** Per path, the run's successful changes in order: `w:<hash>` or `e:<old>><new>`. */
export type EditRevertState = Array<[string, string[]]>;

export interface EditRevert {
  path: string;
  tool: string;
  /** `write`: the content matches an earlier write; `inverse_edit`: it undoes an earlier edit. */
  restores: "write" | "inverse_edit";
}

const MAX_HISTORY_PER_PATH = 16;
const MAX_PATHS = 200;

function stringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** The change signature of a call, or null when the call changes no file content by shape. */
function changeOf(args: unknown): { path: string; sig: string; inverse?: string } | null {
  const path = pathArgOf(args);
  if (!path) return null;
  const a = args as Record<string, unknown>;
  const content = stringArg(a, "content");
  if (content !== undefined) return { path, sig: `w:${contentHash(content)}` };
  const from = stringArg(a, "old_string", "oldString", "find");
  const to = stringArg(a, "new_string", "newString", "replace");
  if (from === undefined || to === undefined || from === to) return null;
  const f = contentHash(from);
  const t = contentHash(to);
  return { path, sig: `e:${f}>${t}`, inverse: `e:${t}>${f}` };
}

/** Whether a call changes file content by its shape (a full write or a find/replace edit). */
export function changesContent(args: unknown): boolean {
  return changeOf(args) !== null;
}

export class EditRevertTracker {
  private readonly history: Map<string, string[]>;

  constructor(state?: EditRevertState) {
    this.history = new Map((state ?? []).map(([p, h]): [string, string[]] => [p, [...h]]));
  }

  /**
   * Record a call that ran. A successful content change is appended to its path's
   * history and returned as a revert when it restores earlier content; a failed one, or
   * a deletion (`deleted: true`), forgets the path — its content is unknown.
   */
  record(tool: string, args: unknown, outcome: { ok: boolean; deleted?: boolean }): EditRevert | null {
    if (outcome.deleted) {
      const path = pathArgOf(args);
      if (path) this.history.delete(path);
      return null;
    }
    const change = changeOf(args);
    if (!change) return null;
    if (!outcome.ok) {
      this.history.delete(change.path);
      return null;
    }
    const past = this.history.get(change.path) ?? [];
    let revert: EditRevert | null = null;
    if (change.sig.startsWith("w:")) {
      const earlier = past.lastIndexOf(change.sig);
      if (earlier >= 0 && earlier < past.length - 1) revert = { path: change.path, tool, restores: "write" };
    } else if (change.inverse) {
      // Only edits since the last full write describe the content an edit applies to.
      const lastWrite = past.map((s) => s.startsWith("w:")).lastIndexOf(true);
      if (past.slice(lastWrite + 1).includes(change.inverse)) revert = { path: change.path, tool, restores: "inverse_edit" };
    }
    const next = [...past, change.sig].slice(-MAX_HISTORY_PER_PATH);
    this.history.delete(change.path);
    this.history.set(change.path, next);
    if (this.history.size > MAX_PATHS) this.history.delete(this.history.keys().next().value as string);
    return revert;
  }

  /** An unscoped mutation (shell, checkout) ran: no path's content is known any more. */
  reset(): void {
    this.history.clear();
  }

  snapshot(): EditRevertState {
    return [...this.history.entries()].map(([p, h]): [string, string[]] => [p, [...h]]);
  }
}
