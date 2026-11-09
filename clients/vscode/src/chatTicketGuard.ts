/**
 * A chat run changes the status only of tickets linked to ITS chat.
 *
 * Chat #219, 2026-11-08: the account's reads could not see the chat's own (local) tickets,
 * so the model walked other chats' lists and set tickets 6520, 6514 and 6508 — none of them
 * this chat's — to done. A status change (`builtin_tasks_update` with status/archived,
 * `ticket-move`) on a ticket not linked to the run's chat is refused, naming both ids, so the
 * model asks instead of guessing.
 *
 * "Linked" is, in order: this device knows it (the ticket carries the chat's client id, or a
 * local chat-ticket link joins them — `localTicketScope.ts`), else the account's link list
 * for the chat holds it. When that list cannot be read (offline, signed out) the call goes
 * through: the guard refuses only on evidence, never on a failed read.
 *
 * Data, not branches: a guarded tool is a name in {@link TICKET_STATUS_WRITES} plus how its
 * args name the ticket when the call changes status.
 */

import { TASK_TABLE_KINDS } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import type { TicketServerIdLookup } from "./localTicketIdBridge";
import { LOCAL_TICKET_ID, type ChatTicketScope, type RunChat } from "./localTicketScope";

type Args = Record<string, unknown>;

/** Tool → the ticket id its call changes the status of, or undefined when it changes none. */
export const TICKET_STATUS_WRITES: Readonly<Record<string, (args: Args) => unknown>> = {
  builtin_tasks_update: (args) => (args.status !== undefined || args.archived !== undefined ? args.id : undefined),
  "ticket-move": (args) => args.id,
};

/** The server ids of the task-tier tickets linked to the run's chat; undefined = could not read. */
export type ServerLinkedRefs = () => Promise<ReadonlySet<string> | undefined>;

/** Read the run's chat's links through the catalog's own `builtin_chats_list_tickets`. */
export function serverLinkedRefsVia(tools: readonly ToolDef[], current: RunChat | undefined): ServerLinkedRefs {
  const list = tools.find((tool) => tool.name === "builtin_chats_list_tickets");
  return async () => {
    // An unbound chat has no links on the account: known empty, not unknown.
    if (current?.serverChatId == null) return new Set();
    if (!list) return undefined;
    try {
      const body = JSON.parse(await list.execute({ chatId: current.serverChatId }, "")) as { tickets?: Array<{ kind?: string; ref?: unknown }> };
      if (!Array.isArray(body.tickets)) return undefined;
      return new Set(body.tickets.filter((t) => TASK_TABLE_KINDS.has(String(t.kind))).map((t) => String(t.ref)));
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

/** Refuse a status change on a ticket the run's chat does not link. A run with no chat is not guarded. */
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
    const ticketOf = TICKET_STATUS_WRITES[tool.name];
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
