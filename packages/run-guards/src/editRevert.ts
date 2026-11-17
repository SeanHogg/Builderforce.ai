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
 * Each entry of a batched `edits: [...]` call is one such change ({@link callChangesOf}),
 * so a revert split across two batches — or a batch and a lone edit — is seen too.
 *
 * Only hashes are kept, so the state stays small enough to ride durable storage. Pure.
 */
import { contentHash, pathArgOf } from "./fingerprint.js";
import { callChangesOf, type CallChange } from "./callChanges.js";

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

/** The change signature of one file change: `w:<hash>` for a whole body, `e:<old>><new>` for a replacement. */
function signatureOf(change: CallChange): { path: string; sig: string; inverse?: string } {
  if ("content" in change) return { path: change.path, sig: `w:${contentHash(change.content)}` };
  const f = contentHash(change.from);
  const t = contentHash(change.to);
  return { path: change.path, sig: `e:${f}>${t}`, inverse: `e:${t}>${f}` };
}

/** Whether a call changes file content by its shape — a full write or a find/replace edit,
 *  alone or in an `edits` batch ({@link callChangesOf}). */
export function changesContent(args: unknown): boolean {
  return callChangesOf(args).length > 0;
}

export class EditRevertTracker {
  private readonly history: Map<string, string[]>;

  constructor(state?: EditRevertState) {
    this.history = new Map((state ?? []).map(([p, h]): [string, string[]] => [p, [...h]]));
  }

  /**
   * Record a call that ran. Each successful content change (a batch carries several, in
   * order) is appended to its path's history; the first that restores earlier content is
   * returned as the revert. A failed call, or a deletion (`deleted: true`), forgets every
   * path it names — their content is unknown (a batch is atomic: none of it applied).
   */
  record(tool: string, args: unknown, outcome: { ok: boolean; deleted?: boolean }): EditRevert | null {
    if (outcome.deleted) {
      const path = pathArgOf(args);
      if (path) this.history.delete(path);
      return null;
    }
    const changes = callChangesOf(args);
    if (!outcome.ok) {
      for (const change of changes) this.history.delete(change.path);
      return null;
    }
    let revert: EditRevert | null = null;
    for (const change of changes) {
      const found = this.recordChange(tool, signatureOf(change));
      revert ??= found;
    }
    return revert;
  }

  private recordChange(tool: string, change: { path: string; sig: string; inverse?: string }): EditRevert | null {
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
