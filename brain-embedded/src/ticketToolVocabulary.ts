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

import { parseEntityRef, parseSyncId, syncIdText, type EntityRef, type SyncId } from '@builderforce/local-first';

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

/** The account's status change (numeric id) and the editor's (local id, or the numeric id once synced). */
const SERVER_TICKET_MOVE_TOOL = 'builtin_tasks_update';
const LOCAL_TICKET_MOVE_TOOL = 'ticket-move';

/**
 * An account ticket id handed in as an ARGUMENT (a number or its decimal text, surrounding
 * whitespace allowed): `parseSyncId` of it. Not a tool-result reader — results are read by
 * `entityIdsOf` (toolResultRecord.ts). No production caller; kept for its contract test.
 */
export function serverTicketId(raw: unknown): SyncId | null {
  return parseSyncId(typeof raw === 'string' ? raw.trim() : raw);
}

/** The call that moves one ticket to a status. */
export interface TicketStatusMove {
  readonly tool: string;
  readonly args: { id: number | string; status: string };
}

/**
 * The tool and arguments that move ticket `ref` to `status`, chosen from the {@link EntityRef}
 * (docs/design/typed-entity-ids.md §6.4), never from a string's shape beyond `parseEntityRef`:
 *
 * - a LocalId → `ticket-move` (only the editor's tool can address a ticket that has not synced);
 * - a SyncId → the filing vocabulary's tool: `ticket-move` in the editor (it takes a synced id
 *   too), `builtin_tasks_update` on the account;
 * - a planning-tier ref → null (its status does not live on the tasks table);
 * - text that is no EntityRef → `ticket-move` in the editor (its tool resolves its own
 *   references), null on the account — nothing there can address it.
 */
export function ticketStatusMove(ref: EntityRef | number | string, status: string, vocabulary: TicketToolVocabulary): TicketStatusMove | null {
  const text = typeof ref === 'string' ? ref.trim() : null;
  const parsed = parseEntityRef(text ?? ref);
  if (parsed && 'local' in parsed) return { tool: LOCAL_TICKET_MOVE_TOOL, args: { id: parsed.local, status } };
  if (parsed && 'sync' in parsed) {
    return vocabulary.local
      ? { tool: LOCAL_TICKET_MOVE_TOOL, args: { id: syncIdText(parsed.sync), status } }
      : { tool: SERVER_TICKET_MOVE_TOOL, args: { id: parsed.sync, status } };
  }
  if (parsed) return null;
  return vocabulary.local && text ? { tool: LOCAL_TICKET_MOVE_TOOL, args: { id: text, status } } : null;
}
