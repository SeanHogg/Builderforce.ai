/**
 * "A file in this workspace changed underneath you."
 *
 * Two things now write to a build's files: the workspace panel's own editor, and
 * the CANVAS build tools (`lib/canvasBuildTools.ts`), which write over the API
 * whether or not the panel happens to be mounted. Without a signal between them,
 * a user watching the Builder panel while the board's agent edits `src/App.jsx`
 * sees the OLD text in the editor and the NEW app in the preview — and the next
 * manual save writes the stale buffer back over the agent's work.
 *
 * This is deliberately a notification and not a store: the file content lives in
 * R2 and is fetched, so the only thing worth sharing is the fact that it moved.
 * The panel re-reads; nothing here caches what it read.
 */

type Listener = (storageProjectId: number, paths: string[]) => void;

const listeners = new Set<Listener>();

/** Announce that `paths` changed in this build's workspace. */
export function notifyWorkspaceFilesChanged(storageProjectId: number, paths: string[]): void {
  if (!Number.isInteger(storageProjectId) || storageProjectId <= 0 || !paths.length) return;
  for (const listener of listeners) {
    try {
      listener(storageProjectId, paths);
    } catch {
      /* a bad subscriber must never break the write that triggered it */
    }
  }
}

/** Subscribe to workspace file changes. Returns the unsubscribe. */
export function subscribeWorkspaceFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
