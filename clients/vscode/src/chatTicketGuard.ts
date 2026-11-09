/**
 * A chat run changes the status only of tickets linked to ITS chat.
 *
 * Chat #219, 2026-11-08: the account's reads could not see the chat's own (local) tickets,
 * so the model walked other chats' lists and set tickets 6520, 6514 and 6508 — none of them
 * this chat's — to done. A write that changes a ticket's state or existence on a ticket not
 * linked to the run's chat is refused, naming both ids, so the model asks instead of guessing:
 * a status/archive change (`builtin_tasks_update`, `ticket-move`, `ticket-archive`), a board
 * move (`builtin_tasks_move`), a delete (`builtin_tasks_delete`, `ticket-delete`), a patch of a
 * device ticket (`ticket-update`) and a `complete` review (`builtin_reviews_record` — a
 * complete verdict closes the ticket).
 *
 * "Linked" is, in order: this device knows it (the ticket carries the chat's client id, or a
 * local chat-ticket link joins them — `localTicketScope.ts`), else the account's link list
 * for the chat holds it — read WHOLE, page by page, so a link past the first page is never
 * taken for another chat's. When that list cannot be read in full (offline, signed out, more
 * pages than {@link MAX_LINK_PAGES}) the call goes through: the guard refuses only on
 * evidence, never on a failed or partial read.
 *
 * Data, not branches: a guarded tool is a name in {@link TICKET_STATE_WRITES} plus how its
 * args name the ticket when the call changes it.
 */

import { TASK_TABLE_KINDS } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import type { TicketServerIdLookup } from "./localTicketIdBridge";
import { LOCAL_TICKET_ID, type ChatTicketScope, type RunChat } from "./localTicketScope";

type Args = Record<string, unknown>;

/** Tool → the ticket id its call changes (status, board, existence, closing review), or undefined when it changes none. */
export const TICKET_STATE_WRITES: Readonly<Record<string, (args: Args) => unknown>> = {
  builtin_tasks_update: (args) => (args.status !== undefined || args.archived !== undefined ? args.id : undefined),
  builtin_tasks_move: (args) => args.id,
  builtin_tasks_delete: (args) => args.id,
  // A `complete` verdict closes the reviewed ticket; a `gaps` verdict files new work and closes nothing.
  builtin_reviews_record: (args) => (args.verdict === "complete" ? args.taskId : undefined),
  "ticket-update": (args) => args.id,
  "ticket-move": (args) => args.id,
  "ticket-archive": (args) => args.id,
  "ticket-delete": (args) => args.id,
};

/** The server ids of the task-tier tickets linked to the run's chat; undefined = could not read. */
export type ServerLinkedRefs = () => Promise<ReadonlySet<string> | undefined>;

/** One page of `builtin_chats_list_tickets` — the server's own maximum (`MAX_CHAT_TICKET_PAGE`). */
export const LINK_PAGE_SIZE = 500;
/** Pages read before the list counts as unreadable (and the guard stands aside). */
export const MAX_LINK_PAGES = 20;

type LinkPage = { tickets?: Array<{ kind?: string; ref?: unknown }>; hasMore?: unknown };

/** Read the run's chat's links WHOLE through the catalog's own `builtin_chats_list_tickets`, page by page. */
export function serverLinkedRefsVia(tools: readonly ToolDef[], current: RunChat | undefined): ServerLinkedRefs {
  const list = tools.find((tool) => tool.name === "builtin_chats_list_tickets");
  return async () => {
    // An unbound chat has no links on the account: known empty, not unknown.
    if (current?.serverChatId == null) return new Set();
    if (!list) return undefined;
    const refs = new Set<string>();
    let offset = 0;
    try {
      for (let page = 0; page < MAX_LINK_PAGES; page += 1) {
        const body = JSON.parse(await list.execute({ chatId: current.serverChatId, limit: LINK_PAGE_SIZE, offset }, "")) as LinkPage;
        if (!Array.isArray(body.tickets)) return undefined;
        for (const t of body.tickets) if (TASK_TABLE_KINDS.has(String(t.kind))) refs.add(String(t.ref));
        // `hasMore` is the server's word that this page is not the whole set; an empty page ends it either way.
        if (body.hasMore !== true || body.tickets.length === 0) return refs;
        offset += body.tickets.length;
      }
      // More links than the guard reads: a partial list is not evidence.
      return undefined;
    } catch {
      return undefined;
    }
  };
}

const refusal = (ticketId: string, chat: RunChat): string =>
  JSON.stringify({
    ok: false,
    error: `ticket #${ticketId} is not linked to this chat (#${String(chat.serverChatId ?? chat.localChatId)}); link it first or ask the user`,
  });

/** Refuse a ticket write ({@link TICKET_STATE_WRITES}) on a ticket the run's chat does not link. A run with no chat is not guarded. */
export function guardChatTicketWrites(
  tools: readonly ToolDef[],
  scope: ChatTicketScope,
  serverRefs: ServerLinkedRefs,
  ticketServerId?: TicketServerIdLookup,
): readonly ToolDef[] {
  const chat = scope.current;
  if (!chat || (!chat.clientChatId && chat.serverChatId == null)) return tools;
  // Links found on the account stay found for the run; a miss re-reads (the chat may have gained one).
  const known = new Set<string>();
  const linkedOnServer = async (serverId: string): Promise<boolean> => {
    if (known.has(serverId)) return true;
    const refs = await serverRefs();
    if (!refs) return true;
    for (const ref of refs) known.add(ref);
    return refs.has(serverId);
  };
  const linked = async (ticketId: string): Promise<boolean> => {
    if (await scope.linkedLocally(ticketId)) return true;
    const serverId = LOCAL_TICKET_ID.test(ticketId) ? await ticketServerId?.(ticketId) : ticketId;
    // A local ticket the account has not seen, and this chat does not carry: another chat's.
    if (!serverId) return false;
    return linkedOnServer(serverId);
  };
  return tools.map((tool) => {
    const ticketOf = TICKET_STATE_WRITES[tool.name];
    if (!ticketOf) return tool;
    return {
      ...tool,
      execute: async (args, root, run) => {
        const raw = ticketOf(args);
        if (raw === undefined || raw === null || raw === "") return tool.execute(args, root, run);
        const ticketId = String(raw).trim().replace(/^#/, "");
        return (await linked(ticketId)) ? tool.execute(args, root, run) : refusal(ticketId, chat);
      },
    };
  });
}
