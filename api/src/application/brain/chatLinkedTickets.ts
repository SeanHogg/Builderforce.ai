/**
 * chatLinkedTickets — "which RUNNABLE tickets does this chat point at?"
 *
 * A Brain chat reaches work through `chat_ticket_links`, which carries every tier of the
 * planning spine (portfolio, objective, roadmap, spec, …). Only three of those can carry
 * an execution, so every caller that wants to reason about the chat's RUNS has to filter
 * the links to the runnable kinds, coerce the refs to task ids, and re-scope them to the
 * tenant. That sequence was written out inside `addressedAgentRunDeps`, and the run-history
 * read needed the identical thing — the second copy is how "what is runnable from a chat"
 * quietly becomes two answers.
 *
 * So it lives here once, as a query with no opinion about what the caller does next: the
 * addressed-agent hand-off wants the ids WITH their current assignee, the diagnostics
 * history wants only the ids. Both are the same filter.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { chatTicketLinks, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';

/** Ticket kinds that can be RUN (the same set `chats.dispatch_agent` accepts). */
export const RUNNABLE_TICKET_KINDS = ['task', 'epic', 'gap'] as const;

/** A runnable ticket this chat links, with whoever currently owns it. */
export interface LinkedRunnableTicket {
  id: number;
  assignedAgentRef: string | null;
}

/**
 * The runnable tickets this chat links, tenant-scoped and existence-checked.
 *
 * Two queries, never N+1: the links in one read, then the surviving task ids in one
 * `IN`. A link whose ticket has since been deleted drops out here rather than being
 * carried forward as an id nothing can run.
 */
export async function linkedRunnableTickets(
  db: Db,
  tenantId: number,
  chatId: number,
): Promise<LinkedRunnableTicket[]> {
  const links = await db
    .select({ ref: chatTicketLinks.ticketRef })
    .from(chatTicketLinks)
    .where(and(
      eq(chatTicketLinks.tenantId, tenantId),
      eq(chatTicketLinks.chatId, chatId),
      inArray(chatTicketLinks.ticketKind, [...RUNNABLE_TICKET_KINDS]),
    ));
  const ids = links.map((l) => Number(l.ref)).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (ids.length === 0) return [];
  return db
    .select({ id: tasks.id, assignedAgentRef: tasks.assignedAgentRef })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, inArray(tasks.id, ids)));
}
