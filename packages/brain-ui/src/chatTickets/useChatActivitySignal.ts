import { useMemo } from 'react';
import { activityMessageCount } from '@seanhogg/builderforce-brain-embedded';

/**
 * A refresh signal that ticks whenever a new run-milestone / agent-dispatch activity line
 * lands in the transcript. Those lines are written by the server alongside a change to
 * the chat's ticket/agent state (the running agent is joined to the chat), which arrives
 * over the live message subscription — not through any ticket-rail action. Add it to a
 * `ChatTicketsPanel` / `useChatParticipants` refresh signal so the Agents list re-reads
 * the moment an agent starts narrating, on every host the same way.
 */
export function useChatActivitySignal(messages: ReadonlyArray<{ metadata?: string | null }>): number {
  return useMemo(() => activityMessageCount(messages), [messages]);
}
