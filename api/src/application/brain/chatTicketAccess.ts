/**
 * chatTicketAccess — what every chat-ticket use case shares: its dependencies and the
 * one guard that decides whether the caller may touch a chat.
 */
import { brainChats } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { resolveChatAccess } from './chatAccess';

/** Dependencies of the chat-ticket use cases, built once by {@link ChatTicketService}. */
export interface ChatTicketDeps {
  readonly db: Db;
  readonly env: Env;
  readonly assignments: AgentAssignmentService;
}

export interface AccessibleChat {
  id: number;
  ownerId: string | null;
  visibility: string;
  projectId: number | null;
}

/** Who is calling a chat-ticket use case, as a tool call knows it. `hostChatId` is the
 *  chat the HOST put the call in (trusted server state, never tool arguments). */
export interface ChatCaller {
  userId?: string | null;
  agentRef?: string | null;
  hostChatId?: number | null;
}

/**
 * The identity the chat-access guard checks for `chatId`.
 *
 *  • A person — including the human an addressed-agent reply runs for — is checked as
 *    themselves.
 *  • A SELF-ACTING agent (`agentRef` set, its `userId` its own ref or absent) reaching
 *    the chat its HOST put it in is checked tenant-scoped (null): an agent has no user
 *    identity to hold a locked chat's membership, and the host chat is the one the
 *    dispatching person bound the run to (`mayBindRunToChat`). Any OTHER chat is checked
 *    as the agent's ref, so a locked chat it was never put in stays closed.
 *  • A gateway caller with no identity stays tenant-wide (null), as before.
 *
 * Whatever is returned, `resolveChatAccess` still filters by tenant, so a chat in
 * another tenant is always refused.
 */
export function chatAccessUserFor(caller: ChatCaller, chatId: number): string | null {
  const userId = caller.userId ?? null;
  const agentRef = caller.agentRef ?? null;
  const selfActingAgent = agentRef != null && (userId == null || userId === agentRef);
  if (!selfActingAgent) return userId;
  return caller.hostChatId != null && chatId === caller.hostChatId ? null : agentRef;
}

/** A Brain chat the caller may ACCESS, scoped to the tenant. Delegates to the
 *  shared {@link resolveChatAccess} guard so team group chats and shared-visibility
 *  chats opened by a non-owner teammate resolve here EXACTLY as they do for the
 *  chat read/message endpoints — no more brainstorm-only / owner-only 404s on a
 *  chat the user can plainly open. Gateway-key callers pass null → tenant-wide
 *  access (matching the brain.* tools). */
export async function accessibleChat(
  db: Db, chatId: number, tenantId: number, userId: string | null,
): Promise<AccessibleChat | null> {
  return resolveChatAccess(db, {
    chatId, tenantId, userId,
    selectExtra: { projectId: brainChats.projectId },
  }) as Promise<AccessibleChat | null>;
}
