/**
 * chatTicketSummaries — the per-chat ticket rollup the conversation picker shows
 * (ticket count + overall % done), for many chats at once.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { rollupChatTicketHealth } from '@builderforce/agent-loop';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { chatTicketLinks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { isTicketKind, missingTicket, ticketKey, type TicketHealth, type TicketKind } from './chatTicketTypes';
import { ticketHealthBatch } from './ticketHealth';

export interface ChatTicketSummary {
  ticketCount: number;
  ticketProgressPct: number;
}

/**
 * Per-chat ticket rollup for the conversation picker. ONE query for all links
 * in `chatIds`, then the same health batch as the ticket rail. Fail-soft: a
 * health miss is reported and returns an empty map so the chat list itself still renders.
 */
export async function summarizeChatsTicketHealth(
  db: Db,
  tenantId: number,
  chatIds: number[],
): Promise<Map<number, ChatTicketSummary>> {
  const out = new Map<number, ChatTicketSummary>();
  if (chatIds.length === 0) return out;
  try {
    const links = await db
      .select({
        chatId: chatTicketLinks.chatId,
        ticketKind: chatTicketLinks.ticketKind,
        ticketRef: chatTicketLinks.ticketRef,
      })
      .from(chatTicketLinks)
      .where(and(
        eq(chatTicketLinks.tenantId, tenantId),
        inArray(chatTicketLinks.chatId, chatIds),
      ));
    if (links.length === 0) return out;
    const refs = links
      .filter((l) => isTicketKind(l.ticketKind))
      .map((l) => ({ kind: l.ticketKind as TicketKind, ref: l.ticketRef }));
    const health = refs.length ? await ticketHealthBatch(db, tenantId, refs) : new Map<string, TicketHealth>();
    const byChat = new Map<number, TicketHealth[]>();
    for (const l of links) {
      const kind = isTicketKind(l.ticketKind) ? l.ticketKind : null;
      const h = kind
        ? (health.get(ticketKey(kind, l.ticketRef)) ?? missingTicket(kind, l.ticketRef))
        : missingTicket('task', l.ticketRef);
      const list = byChat.get(l.chatId) ?? [];
      list.push(h);
      byChat.set(l.chatId, list);
    }
    for (const [chatId, tickets] of byChat) {
      out.set(chatId, {
        ticketCount: tickets.length,
        ticketProgressPct: rollupChatTicketHealth(tickets).pct,
      });
    }
    return out;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/brain/chatTicketSummaries.ts',
      operation: 'summarizeChatsTicketHealth',
    });
    return out;
  }
}

/** Fold ticketCount + ticketProgressPct onto chat rows for the picker. */
export async function attachChatTicketSummaries<T extends { id: number }>(
  db: Db,
  tenantId: number,
  rows: T[],
): Promise<Array<T & { ticketCount: number; ticketProgressPct: number | null }>> {
  const summaries = await summarizeChatsTicketHealth(db, tenantId, rows.map((r) => r.id));
  return rows.map((r) => {
    const s = summaries.get(r.id);
    return {
      ...r,
      ticketCount: s?.ticketCount ?? 0,
      ticketProgressPct: s ? s.ticketProgressPct : null,
    };
  });
}
