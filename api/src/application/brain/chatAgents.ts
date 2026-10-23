/**
 * chatAgents — agents invited into a Brain chat (agent_assignments, scope='chat'):
 * list them by the name a human recognises, invite, remove, and the one idempotent
 * join used when ticket work brings an agent into a chat.
 */
import { resolveAgentIdentities } from './agentDisplayNames';
import { bumpChatStructure } from './chatCacheVersions';
import { accessibleChat, type ChatTicketDeps } from './chatTicketAccess';

/** agent_assignments scope for a chat participant. */
export const CHAT_SCOPE = 'chat';

/**
 * The agents invited into a chat, each carrying the NAME a human would recognise.
 *
 * The assignment row holds only `agentRef` (a uuid, or `manager-t<tenant>`), and for a
 * long time that is all this returned — so the chat's Agents list resolved names by
 * cross-referencing a separately fetched agent POOL in the browser, and every consumer
 * that had no pool (the diagnostics report, the Work directive's roster) printed raw
 * uuids. A support report that says `d02ff7ee-9cf2-… (participant)` cannot tell its
 * reader that Bob is in the chat, which is the one thing it was asked.
 *
 * Names are resolved in ONE batched query ({@link resolveAgentIdentities}) — the pool
 * fetch this replaces was three HTTP calls, and the naive per-ref select it could have
 * been is an N+1.
 */
export async function listChatAgents(deps: ChatTicketDeps, tenantId: number, chatId: number, userId: string | null) {
  const chat = await accessibleChat(deps.db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };
  const rows = await deps.assignments.list(tenantId, CHAT_SCOPE, String(chatId));
  const identities = await resolveAgentIdentities(deps.db, tenantId, rows.map((r) => r.agentRef));
  return rows.map((row) => {
    const identity = identities.get(row.agentRef);
    return {
      ...row,
      name: identity?.name ?? row.agentRef,
      builtinKind: identity?.builtinKind ?? null,
    };
  });
}

export async function inviteChatAgent(
  deps: ChatTicketDeps, tenantId: number, chatId: number, userId: string | null,
  input: { agentKind?: string; agentRef: string; role?: string },
) {
  const chat = await accessibleChat(deps.db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };
  if (!input.agentRef) return { error: 'agentRef is required' as const };
  const assigned = await deps.assignments.assign(tenantId, {
    agentKind: input.agentKind || 'workforce', agentRef: input.agentRef,
    scope: CHAT_SCOPE, scopeId: String(chatId), role: input.role || 'participant',
  });
  await bumpChatStructure(chatId, deps.env);
  return assigned;
}

export async function removeChatAgent(deps: ChatTicketDeps, tenantId: number, chatId: number, userId: string | null, assignmentId: string) {
  const chat = await accessibleChat(deps.db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };
  // Only an invite INTO THIS CHAT: an assignment id from another chat (or a project /
  // lane assignment) must not be removable through a chat the caller can open.
  const ok = await deps.assignments.unassign(tenantId, assignmentId, { scope: CHAT_SCOPE, scopeId: String(chatId) });
  if (ok) await bumpChatStructure(chatId, deps.env);
  return { removed: ok };
}

/**
 * THE one way a cloud agent becomes a chat participant as a side effect of ticket work
 * (agent_assignments scope='chat', role 'participant'). Idempotent: returns true only
 * when the agent was newly joined, so a caller can announce the FIRST join exactly once.
 */
export async function joinAgentToChat(deps: ChatTicketDeps, tenantId: number, chatId: number, agentRef: string): Promise<boolean> {
  const existing = await deps.assignments.list(tenantId, CHAT_SCOPE, String(chatId));
  const already = Array.isArray(existing) && existing.some((e) => String((e as { agentRef?: unknown }).agentRef) === String(agentRef));
  if (already) return false;
  await deps.assignments.assign(tenantId, {
    agentKind: 'workforce', agentRef, scope: CHAT_SCOPE, scopeId: String(chatId), role: 'participant',
  });
  await bumpChatStructure(chatId, deps.env);
  return true;
}
