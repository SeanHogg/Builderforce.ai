/**
 * ticketChatLineage — the reverse direction (ticket → chats): which conversations
 * shaped a work item, and which SPAWNED it (link_type='created').
 */
import { and, eq } from 'drizzle-orm';
import { brainChats, chatTicketLinks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { isTicketKind, type LinkType, type LinkedChatRef } from './chatTicketTypes';

/** Chats that reference a ticket — the lineage view (which conversations shaped
 *  this work item, and which SPAWNED it via link_type='created'). */
export async function listChatsForTicket(db: Db, tenantId: number, kind: string, ref: string): Promise<LinkedChatRef[]> {
  if (!isTicketKind(kind)) return [];
  const rows = await db
    .select({
      chatId: brainChats.id, title: brainChats.title, projectId: brainChats.projectId,
      isArchived: brainChats.isArchived, mergedIntoChatId: brainChats.mergedIntoChatId,
      createdAt: brainChats.createdAt, updatedAt: brainChats.updatedAt,
      linkType: chatTicketLinks.linkType,
    })
    .from(chatTicketLinks)
    .innerJoin(brainChats, eq(brainChats.id, chatTicketLinks.chatId))
    .where(and(eq(chatTicketLinks.tenantId, tenantId), eq(chatTicketLinks.ticketKind, kind), eq(chatTicketLinks.ticketRef, ref)))
    .orderBy(chatTicketLinks.createdAt);
  return rows.map((r) => ({
    chatId: r.chatId, title: r.title, linkType: r.linkType as LinkType, projectId: r.projectId,
    createdAt: r.createdAt, updatedAt: r.updatedAt, isArchived: r.isArchived, mergedIntoChatId: r.mergedIntoChatId,
  }));
}
