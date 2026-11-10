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

import { ingestServerRecords, type EntityScope, type LocalFirstStore } from "@builderforce/local-first";
import { readChatRunHistory, readChatTicketLinks, type BrainPersistenceAdapter, type ChatStateGet } from "@seanhogg/builderforce-brain-embedded";
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

/**
 * `persistence` with `deleteChat` also dropping the chat's rail read mark: a deleted chat has no
 * rail to be fresh, and without this the store's state kept a `readMark@chatRail:<id>` per chat
 * ever refreshed. Mutates and returns the same adapter, so every caller of it (the command, the
 * webview's `local.persistence` dispatch) gets the prune.
 */
export function pruneRailReadMarkOnDelete<P extends Pick<BrainPersistenceAdapter, "getChat" | "deleteChat">>(
  persistence: P,
  store: Pick<LocalFirstStore, "transact">,
): P {
  const getChat = persistence.getChat.bind(persistence);
  const deleteChat = persistence.deleteChat.bind(persistence);
  persistence.deleteChat = async (id: number) => {
    const clientId = (await getChat(id).catch(() => undefined))?.clientId;
    const answer = await deleteChat(id);
    if (clientId) {
      await store.transact(async (tx) => {
        if ((await tx.readMark(railReadMark(clientId))) !== undefined) await tx.setReadMark(railReadMark(clientId), undefined);
      });
    }
    return answer;
  };
  return persistence;
}

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
  /** The active account: a server chat id names that tenant's chat only. */
  scope?: EntityScope,
): Promise<ChatRailRefreshOutcome> {
  const chat = await store.read((tx) => resolveChat(tx, ref, scope));
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
