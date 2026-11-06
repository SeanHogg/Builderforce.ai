/**
 * Undo of an applied fix, by what the HOST recorded - never by what the webview says.
 *
 * Right after a fix lands (under the root's lock) the host records a snapshot: the commit HEAD was
 * at, the branch the person was on, and, per changed path, the git blob sha of the file as the fix
 * left it. Undo refuses unless HEAD is still that commit and every path still hashes to its
 * recorded blob, so it can only ever revert exactly what the fix wrote - never a later edit of the
 * person's. A path is put back from HEAD when HEAD has it; a path HEAD does not have (the fix
 * created it, or it was staged as added) is unstaged and deleted. Then the person is switched back
 * to the branch they started on; the fix branch is left alone. Nothing to revert is an error,
 * never a silent success.
 */

import type { FixPorts } from "./knowledgeFixes";
import { fixText } from "./knowledgeFixText";

export interface FixSnapshot {
  headSha: string;
  blobs: Record<string, string>;
  /** The branch the person was on when the fix made its own (absent when it applied in place). */
  origin?: string;
}

type SnapshotPorts = Pick<FixPorts, "headSha" | "hashObjects">;
type UndoPorts = Required<Pick<FixPorts, "headSha" | "hashObjects" | "inHead" | "restore" | "remove" | "unstage">> & Pick<FixPorts, "switchTo">;

/** The files were reverted, but switching back to the original branch failed. The undo is done; only the branch is not. */
export class UndoPartial extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoPartial";
  }
}

/** Records the fix's result; undefined when the host cannot (then there is no undo, and the result carries no id). */
export async function snapshotFix(ports: SnapshotPorts, changed: readonly string[], origin?: string): Promise<FixSnapshot | undefined> {
  if (changed.length === 0 || !ports.headSha || !ports.hashObjects) return undefined;
  const headSha = await ports.headSha();
  if (!headSha) return undefined;
  return { headSha, blobs: await ports.hashObjects([...changed]), ...(origin ? { origin } : {}) };
}

/** Reverts the snapshot's paths and returns to the original branch, or throws saying why not. */
export async function undoSnapshot(ports: UndoPorts, snapshot: FixSnapshot): Promise<void> {
  const paths = Object.keys(snapshot.blobs);
  if (paths.length === 0) throw new Error(fixText.undoNoFiles());
  const head = await ports.headSha();
  if (head !== snapshot.headSha) throw new Error(fixText.undoMoved(snapshot.headSha.slice(0, 8), (head ?? "unknown").slice(0, 8)));
  const now = await ports.hashObjects(paths);
  const diverged = paths.filter((p) => now[p] !== snapshot.blobs[p]);
  if (diverged.length > 0) throw new Error(fixText.undoDiverged(`${diverged.slice(0, 5).join(", ")}${diverged.length > 5 ? ", ..." : ""}`));

  const tracked = await ports.inHead(paths);
  const restore = paths.filter((p) => tracked.has(p));
  const added = paths.filter((p) => !tracked.has(p));
  const toDelete = added.filter((p) => now[p] !== "missing");
  if (restore.length === 0 && toDelete.length === 0) throw new Error(fixText.undoNothingLeft());
  if (restore.length > 0) await ports.restore(restore);
  if (added.length > 0) await ports.unstage(added);
  if (toDelete.length > 0) await ports.remove(toDelete);

  if (snapshot.origin && ports.switchTo) {
    const back = await ports.switchTo(snapshot.origin);
    if (!back.ok) throw new UndoPartial(fixText.switchBackFailed(snapshot.origin, back.reason));
  }
}
