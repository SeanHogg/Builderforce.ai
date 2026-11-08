/**
 * Refresh the rail's local copy from the platform (G21): the ONLY place the rail reads the
 * platform, and only when the platform is allowed.
 *
 * - The reads are brain-embedded's `readChatTicketLinks` / `readChatRunHistory`, which hand back
 *   the RAW DTOs (ids, `linkType`, every listed row); nothing here caps or reshapes them.
 * - The DTOs go through ONE `ingestServerRecords` call, so one refresh is one store transaction:
 *   tickets, then runs, then the links (as the chat's COMPLETE list, so a link the platform no
 *   longer lists is tombstoned). A link row names its ticket by the client id that ticket's row
 *   resolved to in the same batch.
 * - A failed read is a distinct outcome that ingests NOTHING: the last copy stays. So is an answer
 *   that is not the expected shape: a body without a `tickets` (or `runs`) ARRAY is a failed read,
 *   never "the chat has no tickets" (taking it for an empty list would tombstone every link).
 * - Offline or local-only the platform is not touched at all (`skipped`).
 */

import { ingestServerRecords, type LocalFirstStore } from "@builderforce/local-first";
import { readChatRunHistory, readChatTicketLinks, type ChatStateGet } from "@seanhogg/builderforce-brain-embedded";
import { linkRows, listedTickets, runRows, ticketRows, type WireRun, type WireTicket } from "./railRows";
import type { ChatRailRefreshOutcome, ChatRef } from "./railProtocol";
import { resolveChat } from "./resolveChat";

export interface RailRefreshPorts {
  /** Whether the platform may be read right now (the `connected-feature` capability). */
  platformAllowed(): boolean;
  /** The authenticated platform GET; `undefined` means it produced no answer. */
  get: ChatStateGet;
  now?: () => Date;
}

/**
 * The store read mark a chat's rail refresh records (`markRead`): when the rail was last taken from
 * the platform, kept in the store so "Updated <time>" survives a reload and a refresh that changed
 * no row still counts.
 */
export const railReadMark = (chatClientId: string): string => `chatRail:${chatClientId}`;

/** A platform read that failed. Distinct from "the platform listed nothing". */
export class RailReadError extends Error {
  constructor(path: string, cause?: unknown) {
    super(`rail_read_failed:${path}${cause instanceof Error ? `:${cause.message}` : ""}`);
    this.name = "RailReadError";
  }
}

/**
 * A GET whose every failure rejects: a thrown call, no answer at all, or an answer whose `field`
 * is not an array (the one shape each rail read is a list in).
 */
function expectList(get: ChatStateGet, field: "tickets" | "runs"): ChatStateGet {
  return async <T>(path: string): Promise<T | undefined> => {
    let answer: T | undefined;
    try {
      answer = await get<T>(path);
    } catch (error) {
      throw new RailReadError(path, error);
    }
    if (!answer || typeof answer !== "object" || !Array.isArray((answer as Record<string, unknown>)[field])) {
      throw new RailReadError(path);
    }
    return answer;
  };
}

export async function refreshRail(
  store: LocalFirstStore,
  ports: RailRefreshPorts,
  ref: ChatRef,
): Promise<ChatRailRefreshOutcome> {
  const chat = await store.read((tx) => resolveChat(tx, ref));
  if (!chat) return { status: "error", message: "chat_not_found" };
  if (!ports.platformAllowed() || chat.serverId === undefined) return { status: "skipped" };

  let tickets: WireTicket[];
  let runs: WireRun[];
  try {
    tickets = await readChatTicketLinks<WireTicket>(expectList(ports.get, "tickets"), chat.serverId);
    runs = (await readChatRunHistory<{ runs: WireRun[] }>(expectList(ports.get, "runs"), chat.serverId))!.runs;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  const at = (ports.now ?? (() => new Date()))().toISOString();
  const listed = listedTickets(tickets);
  // Tickets lead the batch: link row `i` reads the client id ticket row `i` resolved to.
  const result = await ingestServerRecords(store, [
    ...ticketRows(listed, chat.destination, at),
    ...runRows(runs, chat.clientId, chat.destination, at),
    ...linkRows(listed, chat.clientId, chat.destination, at),
  ], { completeListFor: { chatClientId: chat.clientId }, markRead: railReadMark(chat.clientId), now: ports.now });
  return { status: "ok", written: result.written, tombstoned: result.tombstoned };
}
