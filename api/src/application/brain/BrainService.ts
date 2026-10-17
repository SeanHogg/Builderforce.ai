/**
 * Application service: orchestrates Brain chat use-cases. THE FACADE.
 *
 * The presentation layer delegates here and only maps HTTP ↔ DTO. This class is
 * deliberately thin — it holds the `Db` and forwards each public method to the
 * use-case module that owns it, so its ~10 importers are unaffected by where the
 * code lives:
 *
 *   brainChatShapes       — DTOs + column projections
 *   brainChatGuards       — owner / shared-access gates, membership, tenant checks
 *   brainChats            — list / create / open / update / archive
 *   brainScopedChats      — the team chat (0294) + manager chat (0376) singletons
 *   brainMessages         — transcript reads, mark-read, append, execution posts, feedback
 *   brainMessageStore     — THE transcript write path (`appendRaw`)
 *   brainChatMembers      — human members: roster, invite, remove
 *   brainMemory           — summaries, chat memories, project memory consolidation
 *   brainLlmCall          — THE traced + billed Brain LLM call
 *   agentReply (+Prompt / Loop / Outcome) — the addressed-agent reply
 *   accountabilityFraming — the manager chat's accountability standard
 */

import type { Db } from '../../infrastructure/database/connection';
import { canAccessChat } from './brainChatGuards';
import { archiveChat, createChat, getChat, listChats, updateChat } from './brainChats';
import { getOrCreateManagerChat, getOrCreateTeamChat, postToTeamChat, readTeamChat } from './brainScopedChats';
import { appendMessages, getMessages, markRead, postExecutionUpdate, setMessageFeedback } from './brainMessages';
import { inviteHuman, listMembers, removeMember } from './brainChatMembers';
import {
  consolidateProjectMemory,
  getProjectMemory,
  listMemories,
  summarizeAgentHostSession,
  summarizeChat,
} from './brainMemory';
import { agentReply } from './agentReply';

export type {
  AppendMessagesDto,
  BrainChatMessageRow,
  CreateChatDto,
  TeamChatScope,
  UpdateChatDto,
} from './brainChatShapes';
export { ACCOUNTABILITY_TOOL_IDS, accountabilityFraming } from './accountabilityFraming';

/** A use case's parameters after its leading `db`. */
type UseCaseArgs<F> = F extends (db: Db, ...rest: infer R) => unknown ? R : never;

export class BrainService {
  constructor(private readonly db: Db) {}

  // --- Chat CRUD -------------------------------------------------------------
  listChats(...args: UseCaseArgs<typeof listChats>) { return listChats(this.db, ...args); }
  createChat(...args: UseCaseArgs<typeof createChat>) { return createChat(this.db, ...args); }
  getChat(...args: UseCaseArgs<typeof getChat>) { return getChat(this.db, ...args); }
  updateChat(...args: UseCaseArgs<typeof updateChat>) { return updateChat(this.db, ...args); }
  archiveChat(...args: UseCaseArgs<typeof archiveChat>) { return archiveChat(this.db, ...args); }

  // --- Team + manager chats (0294 / 0376) -------------------------------------
  getOrCreateManagerChat(...args: UseCaseArgs<typeof getOrCreateManagerChat>) { return getOrCreateManagerChat(this.db, ...args); }
  getOrCreateTeamChat(...args: UseCaseArgs<typeof getOrCreateTeamChat>) { return getOrCreateTeamChat(this.db, ...args); }
  readTeamChat(...args: UseCaseArgs<typeof readTeamChat>) { return readTeamChat(this.db, ...args); }
  postToTeamChat(...args: UseCaseArgs<typeof postToTeamChat>) { return postToTeamChat(this.db, ...args); }

  // --- Messages ----------------------------------------------------------------
  getMessages(...args: UseCaseArgs<typeof getMessages>) { return getMessages(this.db, ...args); }
  markRead(...args: UseCaseArgs<typeof markRead>) { return markRead(this.db, ...args); }
  appendMessages(...args: UseCaseArgs<typeof appendMessages>) { return appendMessages(this.db, ...args); }
  postExecutionUpdate(...args: UseCaseArgs<typeof postExecutionUpdate>) { return postExecutionUpdate(this.db, ...args); }
  setMessageFeedback(...args: UseCaseArgs<typeof setMessageFeedback>) { return setMessageFeedback(this.db, ...args); }

  /** Verify the caller may read/write this chat (shared-access guard, 0288).
   *  Public so a route can gate before a cached read without the service having
   *  to re-plumb tenantId/userId through every call. */
  async canAccess(chatId: number, tenantId: number, userId: string): Promise<boolean> {
    return (await canAccessChat(this.db, chatId, tenantId, userId)) != null;
  }

  // --- Addressed-agent reply ---------------------------------------------------
  agentReply(...args: UseCaseArgs<typeof agentReply>) { return agentReply(this.db, ...args); }

  // --- Human members (0288) ------------------------------------------------------
  listMembers(...args: UseCaseArgs<typeof listMembers>) { return listMembers(this.db, ...args); }
  inviteHuman(...args: UseCaseArgs<typeof inviteHuman>) { return inviteHuman(this.db, ...args); }
  removeMember(...args: UseCaseArgs<typeof removeMember>) { return removeMember(this.db, ...args); }

  // --- Summaries + memory ------------------------------------------------------------
  summarizeChat(...args: UseCaseArgs<typeof summarizeChat>) { return summarizeChat(this.db, ...args); }
  listMemories(...args: UseCaseArgs<typeof listMemories>) { return listMemories(this.db, ...args); }
  getProjectMemory(...args: UseCaseArgs<typeof getProjectMemory>) { return getProjectMemory(this.db, ...args); }
  consolidateProjectMemory(...args: UseCaseArgs<typeof consolidateProjectMemory>) { return consolidateProjectMemory(this.db, ...args); }
  summarizeAgentHostSession(...args: UseCaseArgs<typeof summarizeAgentHostSession>) { return summarizeAgentHostSession(this.db, ...args); }
}
