/**
 * WHICH TOOLS FILE A TICKET on this surface — the one place that knows.
 *
 * Two vocabularies exist for the same act:
 *
 *   • SERVER (web, cloud): `builtin_tasks_create` makes a task the account owns and returns
 *     a NUMERIC id, linked to the run's chat in the same call (the host stamps the chat; see
 *     `CHAT_STAMPED_CREATE_TOOLS`); the board's resource scoping (`builtin_kanban_*`)
 *     addresses that numeric id.
 *   • LOCAL (the editor): `ticket-create` writes the DEVICE store and returns a LOCAL id (a
 *     UUID). It links the creating chat locally in the same transaction and syncs in the
 *     background, and the `builtin_kanban_*` tools (which take server ids) do not apply to it
 *     until it has synced. The editor's catalog does not even advertise the server twins.
 *
 * Neither vocabulary has a link step after a create any more.
 *
 * Every prompt, hand-off and triage check that names a create tool reads this, so none of
 * them keeps its own list of names. A surface that cannot say what it advertises gets the
 * SERVER vocabulary, which is what every surface used before the editor filed locally.
 */

export const SERVER_TICKET_CREATE_TOOL = 'builtin_tasks_create';
export const SERVER_TICKET_LINK_TOOL = 'builtin_chats_link_ticket';
export const LOCAL_TICKET_CREATE_TOOL = 'ticket-create';

/** Tool LABELS (trace spellings, dotted or dashed) of the local create tool. */
export const LOCAL_TICKET_CREATE_LABEL = /ticket[-_.]create/i;

export interface TicketToolVocabulary {
  /** The tool that creates a ticket here, or undefined when the catalog has none. */
  readonly createTool: string | undefined;
  /** The create tool is the device-local `ticket-create` (ids are local UUIDs). */
  readonly local: boolean;
  /** The `builtin_kanban_*` resource-scoping tools apply to a ticket this tool creates. */
  readonly kanbanScoping: boolean;
  /** The name a prompt should give for the create tool (the server's when none is advertised). */
  readonly createName: string;
}

const SERVER: TicketToolVocabulary = Object.freeze({
  createTool: SERVER_TICKET_CREATE_TOOL,
  local: false,
  kanbanScoping: true,
  createName: SERVER_TICKET_CREATE_TOOL,
});

/** The vocabulary of surfaces that file through the account's tools. */
export const SERVER_TICKET_TOOLS: TicketToolVocabulary = SERVER;

/** The vocabulary for the advertised tool names; the server's when `toolNames` is not given. */
export function ticketToolVocabulary(toolNames?: Iterable<string>): TicketToolVocabulary {
  if (!toolNames) return SERVER;
  const names = new Set(toolNames);
  if (names.has(LOCAL_TICKET_CREATE_TOOL)) {
    return Object.freeze({
      createTool: LOCAL_TICKET_CREATE_TOOL,
      local: true,
      kanbanScoping: false,
      createName: LOCAL_TICKET_CREATE_TOOL,
    });
  }
  if (names.has(SERVER_TICKET_CREATE_TOOL)) return SERVER;
  return Object.freeze({ ...SERVER, createTool: undefined });
}

/** Whether a trace label is the device-local create (a ticket that has not reached the account yet). */
export function isLocalTicketCreateLabel(label: string): boolean {
  return LOCAL_TICKET_CREATE_LABEL.test(label);
}
