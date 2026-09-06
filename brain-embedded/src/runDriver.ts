/**
 * The run DRIVER seam: who actually executes a Brain run.
 *
 * By default a run executes in the process that called `startRun` — the module-level
 * store in `brainRunStore.ts` IS the loop. A host whose UI process is disposable (the
 * VS Code webview: closing the tab destroys its JavaScript context and, with it, any
 * loop running inside it) installs a driver that hands the run to a process that
 * outlives the view — the extension host — and MIRRORS that process's run state back
 * into this store with {@link applyRemoteRun}, so every consumer (`useBrainConversation`,
 * the timeline, the cross-chat indicator) keeps reading the same store it always did.
 *
 * The seam is deliberately four verbs: the store's own public API for a run, minus
 * reads. Reads stay local, fed by the mirror.
 */
import type { BrainRunRequest } from './brainRunStore';

export interface BrainRunDriver {
  /** Execute a run elsewhere. Resolves when that run has settled, like `startRun`. */
  start(chatId: number, req: BrainRunRequest): Promise<void>;
  stop(chatId: number): void;
  confirm(chatId: number, ok: boolean): void;
  clearError(chatId: number): void;
}

let installed: BrainRunDriver | null = null;

/** Route this process's runs through `driver`; `null` restores in-process execution. */
export function installRunDriver(driver: BrainRunDriver | null): void {
  installed = driver;
}

export function getRunDriver(): BrainRunDriver | null {
  return installed;
}
