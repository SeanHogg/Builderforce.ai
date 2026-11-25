/**
 * The person's word outranks the chat-link guard.
 *
 * `chatTicketGuard.ts` refuses a ticket write on a ticket the run's chat does not link —
 * chat #61651 closed tickets 6520/6514/6508 that belonged to other chats. But when the
 * person's LATEST message in this chat names the ticket ("close #6520", "ticket 6520 is
 * done", or its local id), the change is theirs, not the model's guess, and the guard lets it
 * through. The guard asks this only when it would otherwise refuse, so the person's text is
 * read on a refusal, never on an ordinary write.
 *
 * A bare number is NOT a ticket: "are the 10 tickets done?", "fix the 3 failing tests",
 * "port 8080" and line numbers name no ticket. A numeric id counts only as `#N` or right
 * after a ticket word. Pure apart from its ports, so it tests headlessly.
 */

import { isLocalId, parseSyncId, syncIdText } from "@builderforce/local-first";
import type { TicketServerIdLookup } from "./localTicketIdBridge";

/** The text of the person's latest message in the run's chat, or undefined when there is none / it cannot be read. */
export type LatestUserText = () => Promise<string | undefined>;

/** The words that make a following number a ticket id ("ticket 6520", "task #12"). */
const TICKET_WORDS = "ticket|task|issue|bug|epic|gap";

/** Whether `text` names one of `ids`: a local UUID anywhere (any case); a numeric id as `#N` or after a ticket word. */
export function textNamesTicket(text: string, ids: readonly string[]): boolean {
  const lower = text.toLowerCase();
  for (const id of ids) {
    if (isLocalId(id)) {
      if (lower.includes(id.toLowerCase())) return true;
      continue;
    }
    const sync = parseSyncId(id);
    if (sync !== null) {
      const named = new RegExp(`(?:#|\\b(?:${TICKET_WORDS})s?\\s*#?\\s*)${syncIdText(sync)}(?!\\d)`, "i");
      if (named.test(text)) return true;
    }
  }
  return false;
}

/** The guard's "did the person name this ticket?" — reads the person's text only when asked. */
export function personNamedTicket(latestUserText: LatestUserText, ticketServerId?: TicketServerIdLookup): (ticketId: string) => Promise<boolean> {
  return async (ticketId) => {
    const text = await latestUserText().catch(() => undefined);
    if (!text) return false;
    const ids = [ticketId];
    // The person names the account's number; the model may hold the local id of the same ticket.
    if (isLocalId(ticketId)) {
      const serverId = await ticketServerId?.(ticketId).catch(() => undefined);
      if (serverId) ids.push(serverId);
    }
    return textNamesTicket(text, ids);
  };
}
