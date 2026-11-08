/**
 * Refresh the rail's local copy from the platform (G21): the ONLY place the rail reads the
 * platform, and only when the platform is allowed.
 *
 * - The reads are brain-embedded's `readChatTicketLinks` / `readChatRunHistory`, which hand back
 *   the RAW DTOs (ids, `linkType`, every listed row); nothing here caps or reshapes them.
 * - The DTOs go through `ingestServerRecords` (tickets and runs, then links as the chat's COMPLETE
 *   list, so a link the platform no longer lists is tombstoned).
 * - A failed read is a distinct outcome that ingests NOTHING: the last copy stays. An empty answer
 *   (`undefined`) is a failure, never "the chat has no tickets": taking it for an empty list would
 *   tombstone every link.
 * - Offline or local-only the platform is not touched at all (`skipped`).
 */

import { ingestServerRecords, type LocalFirstStore } from "@builderforce/local-first";
import { readChatRunHistory, readChatTicketLinks, type ChatStateGet } from "@seanhogg/builderforce-brain-embedded";
import { ticketServerId } from "./railPayloads";
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

/** A platform read that failed. Distinct from "the platform listed nothing". */
export class RailReadError extends Error {
  constructor(path: string, cause?: unknown) {
    super(`rail_read_failed:${path}${cause instanceof Error ? `:${cause.message}` : ""}`);
    this.name = "RailReadError";
  }
}

/** A GET whose every failure, including no answer at all, rejects. */
function strict(get: ChatStateGet): ChatStateGet {
  return async <T>(path: string): Promise<T | undefined> => {
    let answer: T | undefined;
    try {
      answer = await get<T>(path);
    } catch (error) {
      throw new RailReadError(path, error);
    }
    if (answer === undefined || answer === null) throw new RailReadError(path);
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

  const get = strict(ports.get);
  let tickets: WireTicket[];
  let runs: WireRun[];
  try {
    tickets = await readChatTicketLinks<WireTicket>(get, chat.serverId);
    const history = await readChatRunHistory<{ runs?: WireRun[] }>(get, chat.serverId);
    if (!history || !Array.isArray(history.runs)) throw new RailReadError(`/api/brain/chats/${chat.serverId}/runs`);
    runs = history.runs;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  const at = (ports.now ?? (() => new Date()))().toISOString();
  const listed = listedTickets(tickets);
  const first = await ingestServerRecords(store, [
    ...ticketRows(listed, chat.destination, at),
    ...runRows(runs, chat.clientId, chat.destination, at),
  ], { now: ports.now });
  // Tickets lead the batch, so the first `listed.length` ids are theirs. A ticket skipped for a
  // pending local edit still has its client id (its mapping): its link must stay in the list.
  const ticketIds = await Promise.all(first.clientIds.slice(0, listed.length).map(async (id, index) => {
    if (id !== undefined) return id;
    const tk = listed[index]!;
    return (await store.read((tx) => tx.mappingByServerId("ticket", ticketServerId(tk.kind, tk.ref))))?.clientEntityId;
  }));
  const links = linkRows(listed, ticketIds, chat.clientId, chat.destination, at);
  const total = new Set(links.map((row) => (row.payload as { ticketClientId: string }).ticketClientId)).size;
  const second = await ingestServerRecords(store, links, {
    completeListFor: { chatClientId: chat.clientId, total },
    now: ports.now,
  });
  return { status: "ok", written: first.written + second.written, tombstoned: second.tombstoned };
}
