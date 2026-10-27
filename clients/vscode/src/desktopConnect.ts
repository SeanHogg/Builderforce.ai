/**
 * Builderforce Desktop's CONNECT event for the editor. Desktop writes its discovery file
 * (`~/.builderforce/desktop.json`: port + a per-start token) every time it starts, so a
 * change to that file IS "Desktop (re)started". The editor watches it (a stat poll, which
 * also sees the file appear when Desktop was never run before) and on each start:
 *
 *   - forgets the cached health probe, so the next read sees Desktop now rather than a
 *     "down" verdict cached before it started;
 *   - drops the memoised stable grounding (`grounding.ts`), so the next run's prompt
 *     carries Desktop's repo map — a Desktop that started after the workspace was
 *     grounded used to stay absent until a rescan;
 *   - hands Desktop the open folder, so its index starts building.
 *
 * Pure Node (no `vscode` import): the caller passes the folder and disposes the watch.
 */

import * as fs from "node:fs";
import { discoveryFilePath, forgetDesktopProbe, registerWorkspace } from "./desktopContext";
import { invalidateStableGrounding } from "./grounding";

/** How often the discovery file is stat'ed. A start is noticed within this long. */
export const DESKTOP_WATCH_MS = 5_000;

/** Calls `onStart` each time Desktop writes its discovery file. Returns the disposer. */
export function watchDesktopStarts(onStart: () => void, intervalMs: number = DESKTOP_WATCH_MS, file: string = discoveryFilePath()): { dispose(): void } {
  const listener = (curr: fs.Stats, prev: fs.Stats): void => {
    // A deleted file (Desktop quit) is mtime 0 — not a start.
    if (curr.mtimeMs > 0 && curr.mtimeMs !== prev.mtimeMs) onStart();
  };
  fs.watchFile(file, { interval: intervalMs, persistent: false }, listener);
  return { dispose: () => fs.unwatchFile(file, listener) };
}

/** What the editor does when Desktop starts — see the module comment. */
export function onDesktopStart(root: string | undefined): void {
  forgetDesktopProbe();
  invalidateStableGrounding();
  if (root) void registerWorkspace(root);
}
