/**
 * The account's ticket READ tools, in the editor, answer with this device's tickets too.
 *
 * Tickets filed in the editor are local until sync maps them (`localDomainToolRouting.ts`),
 * so `builtin_chats_list_tickets` / `builtin_chats_resolve_hashtag` (list mode) /
 * `builtin_tasks_get` returned nothing for them. Chat #219 (local #61651), 2026-11-08: the
 * run filed an epic and 9 tasks, all three reads came back empty, and the model walked chats
 * 218→210 and closed tickets that belonged to other chats.
 *
 * THE UNION RULE: the server's answer, plus the chat's tickets that exist ONLY here (no sync
 * mapping — `localTicketScope.ts`). A mapped ticket is the server's and is never added, so a
 * synced ticket is not listed twice. The chat may be named by its local or server id; both
 * resolve to the one client id the tickets carry. Each local row is marked `local: true`
 * and its `ref` is the local id the ticket-* tools take.
 *
 * Data, not branches: a read twin is a name in {@link LOCAL_TICKET_READS} plus its adapter.
 */

import { TASK_CLOSED_STATUSES } from "@builderforce/agent-loop";
import { railTicketProgress } from "./chatRail/railPayloads";
import type { ToolDef } from "./fileTools";
import { isLocalId } from "@builderforce/local-first";
import type { ChatTicketScope, UnsyncedTicket } from "./localTicketScope";

type Args = Record<string, unknown>;
type ReadAdapter = (args: Args, server: () => Promise<string>, scope: ChatTicketScope) => Promise<string>;

const UNSYNCED_NOTE = "filed on this device; not synced to the account yet — use ticket-update / ticket-move with this local id";
const CLOSED: ReadonlySet<string> = new Set(TASK_CLOSED_STATUSES);

/** A local ticket in the shape the server's chat-ticket rows have (`ChatTicketLink`). */
export function localTicketView(ticket: UnsyncedTicket) {
  const progress = railTicketProgress(ticket.payload);
  return {
    kind: ticket.payload.taskType ?? "task",
    ref: ticket.id,
    label: ticket.payload.title,
    status: progress.status,
    progressPct: progress.progressPct,
    done: progress.done,
    total: progress.total,
    exists: true,
    linkType: "created",
    ...(ticket.payload.parentTicketId ? { parentRef: ticket.payload.parentTicketId } : {}),
    local: true,
    note: UNSYNCED_NOTE,
  };
}
type LocalView = ReturnType<typeof localTicketView>;

/** The server's answer as an object, or its text when it is not one (an error, a refusal). */
async function serverRead(server: () => Promise<string>): Promise<{ body: Args } | { error: string }> {
  try {
    const text = await server();
    try {
      const body = JSON.parse(text) as unknown;
      return body && typeof body === "object" && !Array.isArray(body) ? { body: body as Args } : { error: text };
    } catch {
      return { error: text };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The chat's local-only tickets as rows, for the chat a call names. */
async function localRows(scope: ChatTicketScope, chatId: unknown): Promise<LocalView[]> {
  const chat = await scope.clientChatIdFor(chatId);
  return chat ? (await scope.unsyncedTickets(chat)).map(localTicketView) : [];
}

/** `chats.list_tickets`' own filters (status / kind / openOnly), applied to the local rows. */
function filtered(rows: readonly LocalView[], args: Args): LocalView[] {
  const status = typeof args.status === "string" ? args.status.trim().toLowerCase() : "";
  const kind = typeof args.kind === "string" ? args.kind.trim().toLowerCase() : "";
  return rows.filter((row) =>
    (!status || row.status.toLowerCase() === status)
    && (!kind || row.kind === kind)
    && !(args.openOnly === true && CLOSED.has(row.status.toLowerCase())));
}

const listTickets: ReadAdapter = async (args, server, scope) => {
  const rows = await localRows(scope, args.chatId);
  if (rows.length === 0) return server();
  const matching = filtered(rows, args);
  // Local rows ride the FIRST page only, so paging never repeats them.
  const page = Number(args.offset) > 0 ? [] : matching;
  const read = await serverRead(server);
  if ("body" in read && Array.isArray(read.body.tickets)) {
    const body = read.body;
    return JSON.stringify({
      ...body,
      tickets: [...(body.tickets as unknown[]), ...page],
      total: Number(body.total ?? 0) + rows.length,
      matched: Number(body.matched ?? 0) + matching.length,
      unsyncedOnDevice: matching.length,
    });
  }
  return JSON.stringify({
    tickets: page,
    total: rows.length,
    matched: matching.length,
    hasMore: false,
    unsyncedOnDevice: matching.length,
    ...("error" in read ? { serverError: read.error } : {}),
  });
};

/** The server's hashtag rule: `#N` tags, or a bare number as the whole text. */
const hasHashtag = (text: unknown): boolean =>
  typeof text === "string" && (/#\s*\d{1,10}\b/.test(text) || /^\s*\d{1,10}\s*$/.test(text));

const resolveHashtag: ReadAdapter = async (args, server, scope) => {
  // A tag names a numeric server ticket; only the no-tag LIST mode is the chat's ticket set.
  if (hasHashtag(args.text)) return server();
  const rows = await localRows(scope, args.chatId);
  if (rows.length === 0) return server();
  const read = await serverRead(server);
  if ("body" in read) {
    if (read.body.mode !== "list" || !Array.isArray(read.body.tickets)) return JSON.stringify(read.body);
    return JSON.stringify({ ...read.body, tickets: [...(read.body.tickets as unknown[]), ...rows], unsyncedOnDevice: rows.length });
  }
  return JSON.stringify({ chatId: args.chatId, mode: "list", tickets: rows, unsyncedOnDevice: rows.length, serverError: read.error });
};

const tasksGet: ReadAdapter = async (args, server, scope) => {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!isLocalId(id)) return server();
  const ticket = await scope.unsyncedTicket(id);
  // Synced (or unknown here): the server has it, and the id bridge translates the local id.
  if (!ticket) return server();
  return JSON.stringify({ id: ticket.id, ...ticket.payload, local: true, note: UNSYNCED_NOTE });
};

/** Server read tool → the adapter that unions in this device's tickets. */
export const LOCAL_TICKET_READS: Readonly<Record<string, ReadAdapter>> = {
  builtin_chats_list_tickets: listTickets,
  builtin_chats_resolve_hashtag: resolveHashtag,
  builtin_tasks_get: tasksGet,
};

/** Wrap the catalog's ticket read tools so their answer includes this device's tickets. */
export function unionLocalTicketReads(tools: readonly ToolDef[], scope: ChatTicketScope): readonly ToolDef[] {
  return tools.map((tool) => {
    const adapter = LOCAL_TICKET_READS[tool.name];
    if (!adapter) return tool;
    return { ...tool, execute: (args, root, run) => adapter(args, () => tool.execute(args, root, run), scope) };
  });
}
