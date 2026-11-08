/**
 * chatTicketLinking — the forward direction (chat → tickets): read a chat's linked
 * tickets with live health, link one (idempotent, lineage-preserving), unlink one.
 */
import { and, eq } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { chatTicketLinks, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { accessibleChat, type ChatTicketDeps } from './chatTicketAccess';
import { bumpChatTicketLinkCaches, deleteChatTicketLink, upsertChatTicketLink } from './chatTicketLinkWrite';
import { chatTicketPage, type ChatTicketPage, type ListChatTicketsOptions } from './chatTicketListing';
import { isTicketKind, missingTicket, ticketKey, type ChatTicketLink, type LinkType, type TicketKind } from './chatTicketTypes';
import { onTicketAgentAssigned } from './ticketAgentHandoff';
import { resolveTicket } from './ticketLookup';
import { ticketHealthBatch } from './ticketHealth';

/** Tickets a chat is tied to, each with live health — EVERY link, as an array
 *  (the UI rail, `chats.resolve_hashtag`). For a filtered/paged answer use
 *  {@link listTicketPageForChat}. */
export async function listTicketsForChat(deps: ChatTicketDeps, tenantId: number, chatId: number, userId: string | null): Promise<{ error: string } | ChatTicketLink[]> {
  const { db } = deps;
  const chat = await accessibleChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' };
  const links = await db.select().from(chatTicketLinks)
    .where(and(eq(chatTicketLinks.tenantId, tenantId), eq(chatTicketLinks.chatId, chatId)))
    .orderBy(chatTicketLinks.createdAt);
  if (links.length === 0) return [];
  const health = await ticketHealthBatch(db, tenantId, links.map((l) => ({ kind: l.ticketKind, ref: l.ticketRef })));
  return links.map((l) => {
    const h = health.get(ticketKey(l.ticketKind, l.ticketRef)) ?? missingTicket(l.ticketKind as TicketKind, l.ticketRef);
    return { ...h, linkId: l.id, linkType: l.linkType as LinkType, createdBy: l.createdBy, createdAt: l.createdAt };
  });
}

/**
 * One filtered page of a chat's tickets — ALWAYS the {@link ChatTicketPage}
 * envelope (`total` / `matched` / `hasMore`), never a bare array, so a caller
 * can never read a full list off a partial answer. The filtering rules live in
 * `chatTicketListing.ts`; the health batch still runs once for the whole chat.
 */
export async function listTicketPageForChat(
  deps: ChatTicketDeps,
  tenantId: number,
  chatId: number,
  userId: string | null,
  options: ListChatTicketsOptions = {},
): Promise<{ error: string } | ChatTicketPage> {
  const rows = await listTicketsForChat(deps, tenantId, chatId, userId);
  if (!Array.isArray(rows)) return rows;
  return chatTicketPage(rows, options);
}

/** Link a chat to a ticket (idempotent — re-links update link_type). */
export async function linkTicket(
  deps: ChatTicketDeps,
  tenantId: number, chatId: number, userId: string | null,
  input: { kind: string; ref: string; linkType?: LinkType; createdBy?: string | null },
): Promise<{ error: string } | ChatTicketLink> {
  const { db, env } = deps;
  const chat = await accessibleChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' };
  if (!isTicketKind(input.kind)) return { error: 'Invalid ticket kind' };
  const resolved = await resolveTicket(db, tenantId, input.kind, input.ref);
  if (!resolved) return { error: 'Ticket not found in tenant' };

  const seg = await resolveSegment(db, tenantId);
  const linkType: LinkType = input.linkType === 'created' ? 'created' : 'linked';
  const row = await upsertChatTicketLink(db, {
    tenantId, segmentId: seg, chatId, kind: input.kind, ref: input.ref,
    linkType, createdBy: input.createdBy ?? userId ?? null,
  });
  await bumpChatTicketLinkCaches(tenantId, chatId, env);
  // Handoff: if this task-tier ticket already has a cloud-agent owner, bring that agent
  // into the chat it was just linked to (the "assign the ticket, then link it" ordering
  // — the assignment-time trigger fires only for chats linked at assignment time).
  if (input.kind === 'task' || input.kind === 'epic' || input.kind === 'gap') {
    try {
      const [t] = await db.select({ agentRef: tasks.assignedAgentRef }).from(tasks).where(scopedToTenant(tasks, tenantId, eq(tasks.id, Number(input.ref)))).limit(1);
      if (t?.agentRef) await onTicketAgentAssigned(deps, tenantId, input.kind, input.ref, t.agentRef, { chatId });
    } catch (error) { /* best-effort: a handoff failure must never break linking */
      reportCaughtError(error, { source: "application/brain/chatTicketLinking.ts", operation: "linkTicket" });
    }
  }

  const health = await ticketHealthBatch(db, tenantId, [{ kind: input.kind, ref: input.ref }]);
  const h = health.get(ticketKey(input.kind, input.ref))!;
  return { ...h, linkId: row!.id, linkType: row!.linkType as LinkType, createdBy: row!.createdBy, createdAt: row!.createdAt };
}

/** Remove a chat↔ticket link (by kind+ref). */
export async function unlinkTicket(
  deps: ChatTicketDeps, tenantId: number, chatId: number, userId: string | null, kind: string, ref: string,
): Promise<{ error: string } | { removed: boolean }> {
  const { db, env } = deps;
  const chat = await accessibleChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' };
  const removed = await deleteChatTicketLink(db, tenantId, chatId, kind, ref);
  if (removed) await bumpChatTicketLinkCaches(tenantId, chatId, env);
  return { removed };
}
