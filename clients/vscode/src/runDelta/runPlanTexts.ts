/**
 * The run's plan texts (PRD 41 §C8.3), LOCAL-FIRST: its task text and the title and description of every ticket this
 * device knows to be linked to the run's chat (a ticket created in the chat, or a `chat-ticket-link` row). Kept apart
 * from `plannedPaths.ts` so the run host can name it without loading the delta engine (that stays lazy).
 */

import type { ChatTicketLinkValue, LocalFirstStore, TicketValue } from "@builderforce/local-first";

/** The task first, then each linked ticket's `title\ndescription` in ticket-id order. */
export async function runPlanTexts(store: LocalFirstStore, asked: string | undefined, chatClientId: string | undefined): Promise<string[]> {
  const texts = asked?.trim() ? [asked] : [];
  if (!chatClientId) return texts;
  const tickets = await store.read(async (tx) => {
    const ids = new Set<string>();
    await tx.scan<TicketValue>("ticket", (row) => { if (!row.deletedAt && row.payload.chatClientId === chatClientId) ids.add(row.id); });
    await tx.scan<ChatTicketLinkValue>("chat-ticket-link", (row) => {
      if (!row.deletedAt && row.payload.chatClientId === chatClientId) ids.add(row.payload.ticketClientId);
    });
    const out: string[] = [];
    for (const id of [...ids].sort()) {
      const row = await tx.get<TicketValue>("ticket", id);
      if (row && !row.deletedAt) out.push([row.payload.title, row.payload.description ?? ""].join("\n"));
    }
    return out;
  });
  return [...texts, ...tickets];
}
