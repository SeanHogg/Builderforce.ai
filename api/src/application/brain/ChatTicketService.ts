/**
 * ChatTicketService — the ONE entry point for tying Brain chats to work items. The HTTP
 * routes (brainRoutes) AND the built-in MCP tools (builtinMcpService) both go through
 * it so the rules live ONCE (DRY).
 *
 * This is a thin facade: it builds the shared dependencies once and delegates every
 * call to the use-case module that owns it —
 *   chatTicketTypes        the (kind, ref) contract + health/link/lineage shapes
 *   ticketLookup           typeahead search over a ticket tier
 *   ticketHealth           batched live health (% done); task tier in taskTierTicketHealth
 *   chatTicketLinking      chat → tickets: list, page, link, unlink
 *   ticketChatLineage      ticket → chats
 *   chatTicketSummaries    the picker's per-chat ticket rollup
 *   chatMessageHistory     a chat's transcript for review
 *   chatConsolidation      merge chats into one
 *   chatAgents             chat participants (list / invite / remove)
 *   ticketAgentHandoff     ticket owner → joins the ticket's chats
 *   chatRunMilestones      run lifecycle narrated into the ticket's chats
 */
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ChatTicketDeps } from './chatTicketAccess';
import type { ChatTicketPage, ListChatTicketsOptions } from './chatTicketListing';
import type { ChatTicketLink, LinkedChatRef, LinkType, TicketHealth, TicketSearchHit } from './chatTicketTypes';
import { searchTickets } from './ticketLookup';
import { ticketHealthBatch } from './ticketHealth';
import { linkTicket, listTicketPageForChat, listTicketsForChat, unlinkTicket } from './chatTicketLinking';
import { listChatsForTicket } from './ticketChatLineage';
import { attachChatTicketSummaries } from './chatTicketSummaries';
import { listChatMessages } from './chatMessageHistory';
import { consolidateChats, type ConsolidateResult } from './chatConsolidation';
import { inviteChatAgent, listChatAgents, removeChatAgent } from './chatAgents';
import { onTicketAgentAssigned } from './ticketAgentHandoff';
import { postRunMilestone, type RunMilestoneInput } from './chatRunMilestones';

export {
  TICKET_KINDS,
  ticketKindForTaskType,
  type TicketKind,
  type LinkType,
  type RunMilestonePhase,
  type TicketParent,
  type TicketHealth,
  type ChatTicketLink,
  type TicketSearchHit,
  type LinkedChatRef,
} from './chatTicketTypes';

export class ChatTicketService {
  private readonly deps: ChatTicketDeps;

  constructor(db: Db, env: Env) {
    this.deps = { db, env, assignments: new AgentAssignmentService(db, env) };
  }

  searchTickets(tenantId: number, kind: string, query: string, projectId: number | null, limit = 40): Promise<TicketSearchHit[]> {
    return searchTickets(this.deps.db, tenantId, kind, query, projectId, limit);
  }

  ticketHealthBatch(tenantId: number, targets: Array<{ kind: string; ref: string }>): Promise<Map<string, TicketHealth>> {
    return ticketHealthBatch(this.deps.db, tenantId, targets);
  }

  listMessages(tenantId: number, chatId: number, userId: string | null, limit = 200) {
    return listChatMessages(this.deps, tenantId, chatId, userId, limit);
  }

  listTicketsForChat(tenantId: number, chatId: number, userId: string | null): Promise<{ error: string } | ChatTicketLink[]> {
    return listTicketsForChat(this.deps, tenantId, chatId, userId);
  }

  listTicketPageForChat(
    tenantId: number, chatId: number, userId: string | null, options: ListChatTicketsOptions = {},
  ): Promise<{ error: string } | ChatTicketPage> {
    return listTicketPageForChat(this.deps, tenantId, chatId, userId, options);
  }

  attachChatTicketSummaries<T extends { id: number }>(
    tenantId: number, rows: T[],
  ): Promise<Array<T & { ticketCount: number; ticketProgressPct: number | null }>> {
    return attachChatTicketSummaries(this.deps.db, tenantId, rows);
  }

  linkTicket(
    tenantId: number, chatId: number, userId: string | null,
    input: { kind: string; ref: string; linkType?: LinkType; createdBy?: string | null },
  ): Promise<{ error: string } | ChatTicketLink> {
    return linkTicket(this.deps, tenantId, chatId, userId, input);
  }

  unlinkTicket(tenantId: number, chatId: number, userId: string | null, kind: string, ref: string): Promise<{ error: string } | { removed: boolean }> {
    return unlinkTicket(this.deps, tenantId, chatId, userId, kind, ref);
  }

  listChatsForTicket(tenantId: number, kind: string, ref: string): Promise<LinkedChatRef[]> {
    return listChatsForTicket(this.deps.db, tenantId, kind, ref);
  }

  consolidate(
    tenantId: number, userId: string | null, input: { targetChatId: number; sourceChatIds: number[] },
  ): Promise<{ error: string } | ConsolidateResult> {
    return consolidateChats(this.deps, tenantId, userId, input);
  }

  listAgents(tenantId: number, chatId: number, userId: string | null) {
    return listChatAgents(this.deps, tenantId, chatId, userId);
  }

  inviteAgent(tenantId: number, chatId: number, userId: string | null, input: { agentKind?: string; agentRef: string; role?: string }) {
    return inviteChatAgent(this.deps, tenantId, chatId, userId, input);
  }

  removeAgent(tenantId: number, chatId: number, userId: string | null, assignmentId: string) {
    return removeChatAgent(this.deps, tenantId, chatId, userId, assignmentId);
  }

  onTicketAgentAssigned(
    tenantId: number, kind: string, ref: string, agentRef: string, opts?: { chatId?: number; agentName?: string },
  ): Promise<void> {
    return onTicketAgentAssigned(this.deps, tenantId, kind, ref, agentRef, opts);
  }

  postRunMilestone(tenantId: number, input: RunMilestoneInput): Promise<void> {
    return postRunMilestone(this.deps, tenantId, input);
  }
}
