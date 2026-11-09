/**
 * Resuming an interrupted run THROUGH THE COMPOSER (no DOM, no React: `useInterruptedResume`
 * is the thin hook over this).
 *
 * Resume is not a host-side start: the host holds no seed, model, project or spec for the
 * chat. The webview opens the interrupted run's chat and sends the continuation built from the run's journaled record (`interruptedResumeTurn.ts`)
 * as an ordinary turn through the ONE send path (which builds all of that). The host is
 * told to acknowledge the interrupted run (`ack`) only once the new run is really claimed:
 * the first run event seen for that chat after the continuation was sent.
 *
 *   begin(run)        refuses when the chat is running or the run is already pending
 *   activeChat(id)    the surface's chat changed: send for a pending run waiting on it
 *   runEvent(...)     `claimed` (a run started or settled in the chat) acks the run;
 *                     `failed` marks it failed
 *   timeout           no run event within `RESUME_TIMEOUT_MS` of `begin` fails the run
 *
 * A failed run stays in the list with a note (a run that starts late after a timeout still claims
 * and acks it); pending runs have their buttons disabled.
 */

/** How long a resume may wait for its run to be claimed (the chat opening, the send, the host starting). */
export const RESUME_TIMEOUT_MS = 30_000;

export interface ResumeDeps {
  openChat(chatId: number): void;
  /** Send a turn into the chat the surface is showing through the composer's door (`useChatSend().continueChat`); resolves whether the door kept it. */
  send(text: string): Promise<boolean>;
  /** Tell the host to journal the interrupted run as acknowledged. */
  ack(runId: string): void;
  isRunning(chatId: number): boolean;
  /** The continuation turn for THIS interrupted run (`interruptedResumeTurn.ts`: its ask, plan, files, steps, sub-agents). */
  continuation(runId: string): string;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface ResumeSnapshot {
  pending: ReadonlySet<string>;
  failed: ReadonlySet<string>;
}

interface Entry {
  runId: string;
  chatId: number;
  sent: boolean;
  timer: unknown;
}

export interface ResumeTracker {
  begin(run: { runId: string; chatId: number }): boolean;
  activeChat(chatId: number | null): void;
  runEvent(event: { type: 'claimed' | 'failed'; chatId: number }): void;
  snapshot(): ResumeSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createResumeTracker(deps: ResumeDeps): ResumeTracker {
  const entries = new Map<string, Entry>();
  let failed = new Set<string>();
  let snap: ResumeSnapshot = { pending: new Set(), failed };
  const listeners = new Set<() => void>();
  // Runs that failed by TIMEOUT after their continuation went out: a run that starts late still claims them.
  const late = new Map<string, number>();
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  const publish = (): void => {
    snap = { pending: new Set(entries.keys()), failed };
    for (const listener of listeners) listener();
  };
  const settle = (entry: Entry): void => {
    clearTimer(entry.timer);
    entries.delete(entry.runId);
  };
  const fail = (entry: Entry): void => {
    settle(entry);
    failed = new Set(failed).add(entry.runId);
  };

  return {
    begin(run) {
      if (entries.has(run.runId) || deps.isRunning(run.chatId)) return false;
      const entry: Entry = { runId: run.runId, chatId: run.chatId, sent: false, timer: undefined };
      entry.timer = setTimer(() => {
        if (entries.get(run.runId) !== entry) return;
        fail(entry);
        if (entry.sent) late.set(entry.runId, entry.chatId);
        publish();
      }, deps.timeoutMs ?? RESUME_TIMEOUT_MS);
      entries.set(run.runId, entry);
      late.delete(run.runId);
      if (failed.has(run.runId)) {
        failed = new Set(failed);
        failed.delete(run.runId);
      }
      publish();
      deps.openChat(run.chatId);
      return true;
    },
    activeChat(chatId) {
      if (chatId == null) return;
      for (const entry of entries.values()) {
        if (entry.sent || entry.chatId !== chatId) continue;
        // Marked sent as the turn is handed to the door, so a claim that lands while the
        // door is still working is not missed. The door answers `kept` only when the whole
        // turn has finished, so a late `true` changes nothing; a `false` (not kept: the
        // chat changed, the session expired) fails the row at once.
        entry.sent = true;
        const notKept = (): void => {
          if (entries.get(entry.runId) !== entry) return;
          fail(entry);
          publish();
        };
        deps.send(deps.continuation(entry.runId)).then((kept) => { if (!kept) notKept(); }, notKept);
      }
    },
    runEvent(event) {
      let changed = false;
      for (const entry of [...entries.values()]) {
        // Only a run event AFTER the continuation went out can be the resumed run's.
        if (!entry.sent || entry.chatId !== event.chatId) continue;
        changed = true;
        if (event.type === 'claimed') {
          settle(entry);
          deps.ack(entry.runId);
        } else {
          fail(entry);
        }
      }
      // A run that starts after the timeout still claims the row that timed out: acknowledged, it leaves the list.
      if (event.type === 'claimed') {
        for (const [runId, chatId] of [...late]) {
          if (chatId !== event.chatId) continue;
          late.delete(runId);
          failed = new Set(failed);
          failed.delete(runId);
          deps.ack(runId);
          changed = true;
        }
      }
      // Run frames stream per token: only a real change republishes.
      if (changed) publish();
    },
    snapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    // Drops the pending runs and their timers, but keeps the subscribers: safe under a
    // StrictMode double mount, where the effect cleanup runs while the tracker lives on.
    dispose() {
      for (const entry of entries.values()) clearTimer(entry.timer);
      entries.clear();
      late.clear();
      publish();
    },
  };
}

/**
 * The tracker event a host run frame stands for, or null. A `run.sync` claims only while the run is
 * RUNNING (a sync of an idle cell is not the resumed run); `run.settled` claims (a run that finished
 * before a running sync was seen); `run.failed` fails. The frames carry no turn identity, so the first
 * such event for the chat after the continuation was sent is taken as the resumed run's.
 */
export function resumeEventOf(
  frame: { type: 'run.sync'; chatId: number; snapshot?: { running?: boolean } } | { type: 'run.settled' | 'run.failed'; chatId: number },
): { type: 'claimed' | 'failed'; chatId: number } | null {
  if (frame.type === 'run.failed') return { type: 'failed', chatId: frame.chatId };
  if (frame.type === 'run.settled') return { type: 'claimed', chatId: frame.chatId };
  return frame.type === 'run.sync' && frame.snapshot?.running ? { type: 'claimed', chatId: frame.chatId } : null;
}
