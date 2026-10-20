/**
 * ticketAgentHandoff — when a cloud agent becomes a ticket's owner, bring it INTO the
 * Brain chats that ticket is linked to and announce its first join.
 */
import { resolveAgentDisplayName } from './agentDisplayNames';
import { joinAgentToChat } from './chatAgents';
import { postSystemMessage } from './chatSystemMessage';
import type { ChatTicketDeps } from './chatTicketAccess';
import { isTicketKind } from './chatTicketTypes';
import { listChatsForTicket } from './ticketChatLineage';

/**
 * Assignment → chat handoff. When a cloud agent becomes a ticket's owner, bring it INTO
 * every Brain chat the ticket is linked to (agent_assignments scope='chat') and, on the
 * agent's FIRST join, post a short "starting work" line — so the conversation that
 * spawned the ticket shows the agent picking it up. Tenant-scoped + system-driven (no
 * chat-owner check: the ticket assignment already authorized the handoff). Idempotent —
 * an agent already in the chat is neither re-invited nor re-announced. Pass opts.chatId
 * to scope to a single chat (the link-time trigger, where a ticket gains a NEW chat);
 * omit to fan out to all of the ticket's linked chats (the assignment-time trigger).
 * This closes the reported gap: "after assigning developers to the tickets it never
 * assigned the dev agents to the chat / they never started working."
 */
export async function onTicketAgentAssigned(
  deps: ChatTicketDeps,
  tenantId: number, kind: string, ref: string, agentRef: string,
  opts?: { chatId?: number; agentName?: string },
): Promise<void> {
  if (!agentRef || !ref || !isTicketKind(kind)) return;
  const targets = opts?.chatId != null
    ? [{ chatId: opts.chatId, isArchived: false, mergedIntoChatId: null as number | null }]
    : (await listChatsForTicket(deps.db, tenantId, kind, ref)).map((c) => ({
        chatId: c.chatId, isArchived: c.isArchived, mergedIntoChatId: c.mergedIntoChatId,
      }));
  if (targets.length === 0) return;
  let name: string | undefined = opts?.agentName;
  for (const t of targets) {
    if (t.isArchived || t.mergedIntoChatId != null) continue;
    if (!(await joinAgentToChat(deps, tenantId, t.chatId, agentRef))) continue;
    if (name === undefined) name = await resolveAgentDisplayName(deps.db, tenantId, agentRef);
    await postSystemMessage(
      deps.db,
      deps.env,
      tenantId,
      t.chatId,
      `🤖 **${name}** has been assigned to ${kind} #${ref}. Progress will appear here as it works.`,
      // The STRUCTURED facts, not just the sentence: both chat renderers compose the
      // activity line from these in the reader's language (see brain-embedded's
      // `chatActivity.ts`). `content` stays the English fallback for older clients.
      { agentDispatch: true, agentRef, agentName: name, ticketKind: kind, ticketRef: ref },
    );
  }
}
