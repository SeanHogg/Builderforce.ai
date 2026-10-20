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
