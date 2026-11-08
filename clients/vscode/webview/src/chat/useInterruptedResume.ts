/**
 * The React face of `interruptedResume.ts`: one tracker per surface, driven by the
 * surface's own chat and send. Resume opens the interrupted run's chat and sends the
 * continuation through the composer's send path (`useChatSend().continueChat`); the
 * host is told to acknowledge the run once the first run event for that chat arrives
 * after the send (`run.sync` of a running run, or `run.settled`). `run.failed` or no
 * event within `RESUME_TIMEOUT_MS` leaves the row with a note.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { onHostMessage } from '../vscodeBridge';
import { createResumeTracker, resumeEventOf, type ResumeSnapshot } from './interruptedResume';
import { acknowledgeInterruptedRun } from './interruptedRunsStore';

export interface InterruptedResume extends ResumeSnapshot {
  /** Resume the run in its chat; false when it cannot start (chat running, already pending). */
  resume(run: { runId: string; chatId: number }): boolean;
  /** Is this chat running now? A resume into a running chat is refused. */
  isRunning(chatId: number): boolean;
}

export function useInterruptedResume({ chatId, openChat, send, isRunning, continuation }: {
  /** The chat the surface shows. */
  chatId: number | null;
  openChat: (chatId: number) => void;
  /** The composer's door for the chat showing (`useChatSend().continueChat`): resolves whether the turn was kept. */
  send: (text: string) => Promise<boolean>;
  isRunning: (chatId: number) => boolean;
  /** The localized continuation turn. */
  continuation: string;
}): InterruptedResume {
  // The tracker is created once; what it calls is read through this ref, so it always
  // sees the render's own `send` (bound to the chat showing now).
  const live = useRef({ openChat, send, isRunning, continuation });
  // eslint-disable-next-line react-hooks/refs
  live.current = { openChat, send, isRunning, continuation };
  const tracker = useMemo(
    () => createResumeTracker({
      openChat: (id) => live.current.openChat(id),
      send: (text) => live.current.send(text),
      ack: acknowledgeInterruptedRun,
      isRunning: (id) => live.current.isRunning(id),
      continuation: () => live.current.continuation,
    }),
    [],
  );
  const snapshot = useSyncExternalStore(tracker.subscribe, tracker.snapshot);

  // A pending run waits for its chat to be the one showing, then sends. Re-run when a
  // resume begins too: its chat may already be the one open.
  useEffect(() => tracker.activeChat(chatId), [tracker, chatId, snapshot.pending]);

  useEffect(() => {
    const forward = (event: ReturnType<typeof resumeEventOf>): void => { if (event) tracker.runEvent(event); };
    const offSync = onHostMessage<{ chatId: number; snapshot?: { running?: boolean } }>('run.sync', (m) => forward(resumeEventOf({ type: 'run.sync', ...m })));
    const offSettled = onHostMessage<{ chatId: number }>('run.settled', (m) => forward(resumeEventOf({ type: 'run.settled', chatId: m.chatId })));
    const offFailed = onHostMessage<{ chatId: number }>('run.failed', (m) => forward(resumeEventOf({ type: 'run.failed', chatId: m.chatId })));
    return () => { offSync(); offSettled(); offFailed(); tracker.dispose(); };
  }, [tracker]);

  return useMemo(
    () => ({ ...snapshot, resume: tracker.begin, isRunning: (id: number) => live.current.isRunning(id) }),
    [snapshot, tracker],
  );
}
