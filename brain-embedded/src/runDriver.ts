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
 * The seam is deliberately five verbs: the store's own public API for a run (plus the words a person says to it), minus
 * reads. Reads stay local, fed by the mirror.
 */
import type { BrainRunRequest } from './brainRunStore';
import type { ChatInputAttachment } from './types';

/** One turn said to a chat's run through the driver: its words, its files, and the key that makes saying it twice the same as once. */
export interface SteerTurn {
  text: string;
  attachments?: ChatInputAttachment[];
  eventKey: string;
}

export interface BrainRunDriver {
  /** Execute a run elsewhere. Resolves when that run has settled, like `startRun`. */
  start(chatId: number, req: BrainRunRequest): Promise<void>;
  stop(chatId: number): void;
  confirm(chatId: number, ok: boolean): void;
  clearError(chatId: number): void;
  /**
   * Words for a CHAT's run, wherever that run executes - the chat-keyed twin of `queueRunSteering`, for a process whose
   * in-page inbox is read by nobody. The process that owns the run decides what they are: heard by the run when it is live
   * or being set up, the chat's next turn when it is idle (the editor host's `runSteer.steerTurns`: its inbox + wake) - SEVERAL
   * turns together are ONE continuation, in order. Keyed by the chat, never by the view that happens to be showing it. Each
   * turn carries its own key: the host hears a turn it has already heard (a repeated post) once.
   */
  steer(chatId: number, turns: readonly SteerTurn[]): void;
}

let installed: BrainRunDriver | null = null;

/** Route this process's runs through `driver`; `null` restores in-process execution. */
export function installRunDriver(driver: BrainRunDriver | null): void {
  installed = driver;
}

export function getRunDriver(): BrainRunDriver | null {
  return installed;
}
