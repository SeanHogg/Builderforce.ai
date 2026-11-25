/**
 * The chat surface's interrupted-run Resume: open the run's chat, send the continuation
 * through the surface's composer door (it builds the seed, model, project and spec), ack
 * the run once the host claims it (`useInterruptedResume`). The continuation is built from
 * the run's JOURNALED record (ask verbatim, plan, files, last steps, sub-agents), never the
 * bare headline (`interruptedResumeTurn.ts`).
 */
import { interruptedResumeTurn, openOnlyResumeTurn } from '../../../src/run/interruptedResumeTurn';
import { useInterruptedRuns } from './interruptedRunsStore';
import { useInterruptedResume, type InterruptedResume } from './useInterruptedResume';

/** The linked-ticket stats a chat's open-only Resume scopes its continuation to. */
export interface TicketStats {
  doneCount: number;
  openCount: number;
  progressPct: number | null | undefined;
}

export function useChatInterruptedResume({ t, chatId, openChat, continueChat, runStatus, ticketStatsOf }: {
  t: (key: string, fallback: string) => string;
  chatId: number | null;
  openChat: (chatId: number) => void;
  /** `useChatSend().continueChat`: resolves whether the turn was kept. */
  continueChat: (text: string) => Promise<boolean>;
  /** A chat's run status; anything but null means it is running. */
  runStatus: (chatId: number) => unknown;
  /** A chat's linked-ticket stats (its open-only Resume scopes the turn to them); undefined when unknown. */
  ticketStatsOf?: (chatId: number) => TicketStats | undefined;
}): InterruptedResume {
  const interruptedRuns = useInterruptedRuns();
  return useInterruptedResume({
    chatId,
    openChat,
    send: continueChat,
    isRunning: (id) => runStatus(id) != null,
    // A journaled run continues from its journaled record; an OPEN-ONLY target (the synthetic
    // `open-<chatId>` run id, or a run that journaled nothing) continues this CHAT's unfinished
    // work, scoped to its linked tickets so the run never picks up another session's task.
    continuation: (runId) => {
      const resume = interruptedRuns.find((run) => run.runId === runId)?.resume;
      if (resume) return interruptedResumeTurn(t, resume);
      const fromId = runId.startsWith('open-') ? Number(runId.slice('open-'.length)) : NaN;
      const stats = Number.isFinite(fromId) ? ticketStatsOf?.(fromId) : ticketStatsOf?.(chatId ?? -1);
      return openOnlyResumeTurn(t, stats ?? { doneCount: 0, openCount: 0, progressPct: null });
    },
  });
}
