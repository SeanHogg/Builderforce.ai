import { useCallback, useMemo, useState } from 'react';
import { createChatTicketsRestAdapter, useChatParticipants } from '@seanhogg/builderforce-brain-ui';
import { apiRequest } from '@/lib/apiClient';

/**
 * Who is in the active chat, and the chat-scoped REST client that says so.
 *
 * The ONE chat-scoped REST client this panel uses — the same factory the VS Code
 * webview and the tickets panel build. It backs the participant roster AND the
 * diagnostics capture's chat reads, so both read the endpoints exactly one way. Its
 * agent-pool fetch is lazy and memoised for the adapter's lifetime.
 *
 * Multi-party chat: the invited participants of the active chat as addressable
 * recipients — so a message can be sent to a teammate instead of the BRAIN — through
 * the SHARED `useChatParticipants` the editor calls too. Bumped on invite/remove.
 */
export function useBrainPanelParticipants(activeChatId: number | null) {
  const ticketAdapter = useMemo(() => createChatTicketsRestAdapter({ request: apiRequest }), []);
  const [participantsRefresh, setParticipantsRefresh] = useState(0);
  const bumpParticipants = useCallback(() => setParticipantsRefresh((n) => n + 1), []);
  const participants = useChatParticipants(ticketAdapter, activeChatId, participantsRefresh);
  return { ticketAdapter, participants, bumpParticipants };
}
