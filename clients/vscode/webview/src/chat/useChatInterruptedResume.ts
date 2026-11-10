/**
 * The chat surface's interrupted-run Resume: open the run's chat, send the continuation
 * through the surface's composer door (it builds the seed, model, project and spec), ack
 * the run once the host claims it (`useInterruptedResume`). The continuation is built from
 * the run's JOURNALED record (ask verbatim, plan, files, last steps, sub-agents), never the
 * bare headline (`interruptedResumeTurn.ts`).
 */
import { interruptedResumeTurn } from '../../../src/interruptedResumeTurn';
import { useInterruptedRuns } from './interruptedRunsStore';
import { useInterruptedResume, type InterruptedResume } from './useInterruptedResume';

export function useChatInterruptedResume({ t, chatId, openChat, continueChat, runStatus }: {
  t: (key: string, fallback: string) => string;
  chatId: number | null;
  openChat: (chatId: number) => void;
  /** `useChatSend().continueChat`: resolves whether the turn was kept. */
  continueChat: (text: string) => Promise<boolean>;
  /** A chat's run status; anything but null means it is running. */
  runStatus: (chatId: number) => unknown;
}): InterruptedResume {
  const interruptedRuns = useInterruptedRuns();
  return useInterruptedResume({
    chatId,
    openChat,
    send: continueChat,
    isRunning: (id) => runStatus(id) != null,
    continuation: (runId) => interruptedResumeTurn(t, interruptedRuns.find((run) => run.runId === runId)?.resume),
  });
}
