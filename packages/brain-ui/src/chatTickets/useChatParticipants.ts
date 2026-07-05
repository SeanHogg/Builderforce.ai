import { useEffect, useMemo, useState } from 'react';
import type { DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import type { ChatTicketsAdapter, AgentOptionVM, ChatAgentVM, ChatMemberVM } from './types';

/**
 * The invited participants of a chat, resolved to display names, as addressable
 * recipients — the shared source for a composer's recipient picker and any
 * participant roster. Reads the invited list (changes on invite/remove → keyed on
 * `refreshSignal`) and the stable agent pool (the adapter caches it, so this
 * shares the ChatTicketsPanel's fetch rather than duplicating it).
 *
 * Lives here (not in a host) so the web app and the VS Code webview derive the
 * exact same participant set the same way.
 */
export function useChatParticipants(
  adapter: ChatTicketsAdapter,
  chatId: number | null,
  refreshSignal = 0,
): DirectedRecipient[] {
  const [pool, setPool] = useState<AgentOptionVM[]>([]);
  const [invited, setInvited] = useState<ChatAgentVM[]>([]);
  const [members, setMembers] = useState<ChatMemberVM[]>([]);

  useEffect(() => {
    let ok = true;
    adapter.loadAgentPool().then((p) => { if (ok) setPool(p); }).catch(() => { if (ok) setPool([]); });
    return () => { ok = false; };
  }, [adapter]);

  useEffect(() => {
    if (chatId == null) { setInvited([]); setMembers([]); return; }
    let ok = true;
    adapter.listAgents(chatId).then((a) => { if (ok) setInvited(a); }).catch(() => { if (ok) setInvited([]); });
    adapter.listMembers(chatId).then((m) => { if (ok) setMembers(m); }).catch(() => { if (ok) setMembers([]); });
    return () => { ok = false; };
  }, [adapter, chatId, refreshSignal]);

  return useMemo(
    () => [
      ...invited.map((a) => ({
        kind: 'agent' as const,
        ref: a.agentRef,
        name: pool.find((p) => p.ref === a.agentRef)?.name ?? a.agentRef,
      })),
      // Active human members are addressable too (kind='human', ref=user id).
      ...members
        .filter((m) => m.status === 'active' && m.userId)
        .map((m) => ({ kind: 'human' as const, ref: m.userId as string, name: m.name })),
    ],
    [invited, pool, members],
  );
}
