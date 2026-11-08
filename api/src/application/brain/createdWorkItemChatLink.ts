/**
 * createdWorkItemChatLink — the ONE seam that ties a work item an agent CREATES to the
 * chat it was created from, as part of the create call itself.
 *
 * Before this existed every surface linked in a SECOND step after the create: the
 * client run loop fired `builtin_chats_link_ticket` off the create's result, the prompt
 * asked the model to do the same, and the cloud run (which already stamped its chat onto
 * every call) linked nothing at all. A failed second call, or a run stopped between the
 * two, left the ticket created and orphaned from the conversation.
 *
 * Now the HOST stamps the chat onto the create call (`chatId` — never in the tool's
 * model-facing schema: which chat a run is in is the host's fact, not the model's
 * guess) and `callBuiltinTool` links the created row through the existing
 * {@link ChatTicketService.linkTicket} use case (access-checked, cache-bumped, agent
 * handoff). A link failure never fails the create: the result gains a `chatLink` field
 * saying what happened, and keeps its shape otherwise.
 *
 * `tickets.from_delta` is deliberately NOT mapped — it links its own ticket (with the
 * honest created-vs-attached lineage) inside `WorkDeltaService`.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ChatTicketService } from './ChatTicketService';
import { ticketKindForTaskType, type LinkType, type TicketKind } from './chatTicketTypes';

type KindOfRow = (row: Record<string, unknown>) => TicketKind;

/**
 * Create tools (by CATALOG id) whose result is a chat-linkable work item, mapped to the
 * `chat_ticket_links` kind that result represents. `tasks.create` reads the row's own
 * `taskType` (epic and gap keep their tier; task, bug or anything else is a 'task').
 */
const CHAT_LINKED_CREATE_TOOLS: Readonly<Record<string, KindOfRow>> = {
  'tasks.create': (row) => ticketKindForTaskType(typeof row.taskType === 'string' ? row.taskType : null),
  'objectives.create': () => 'objective',
  'specs.create': () => 'spec',
  'portfolios.create': () => 'portfolio',
  'initiatives.create': () => 'initiative',
  // Team ceremonies: a retro or estimation session set up FROM a conversation is that
  // conversation's outcome, so it links like any other item the agent creates.
  'retro.create': () => 'retro',
  'poker.create_session': () => 'poker',
};

/** Catalog ids of the create tools that link their item to the caller's chat. */
export const CHAT_LINKED_CREATE_TOOL_IDS: readonly string[] = Object.freeze(Object.keys(CHAT_LINKED_CREATE_TOOLS));

export function isChatLinkedCreateTool(tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHAT_LINKED_CREATE_TOOLS, tool);
}

/** The work item a create tool produced, addressed the way `chat_ticket_links` wants it. */
export interface CreatedWorkItemLink {
  kind: TicketKind;
  ref: string;
  /** 'linked' when the create was an idempotent hit on an item that already existed. */
  linkType: LinkType;
}

/** The link descriptor for a create tool's result, or null when the tool is not a mapped
 *  create or the result carries no usable id. A `deduped: true` result links as 'linked'. */
export function createdWorkItemLink(tool: string, result: unknown): CreatedWorkItemLink | null {
  const kindOf = isChatLinkedCreateTool(tool) ? CHAT_LINKED_CREATE_TOOLS[tool] : undefined;
  if (!kindOf || !result || typeof result !== 'object' || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  const id = row.id;
  const ref = typeof id === 'number' && Number.isFinite(id) ? String(id) : typeof id === 'string' && id.trim() ? id : null;
  if (!ref) return null;
  return { kind: kindOf(row), ref, linkType: row.deduped === true ? 'linked' : 'created' };
}

/** The positive integer chat id a host stamped onto a call's arguments, or null. */
export function stampedChatId(args: unknown): number | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const raw = (args as Record<string, unknown>).chatId;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The host's chat, stamped onto a mapped create call: the host's value overrides whatever
 * the model sent, and with no host chat any model-sent `chatId` is stripped (a guessed id
 * would name somebody else's conversation). Every other tool's arguments are untouched.
 */
export function withHostChat(tool: string, args: Record<string, unknown>, hostChatId: number | null | undefined): Record<string, unknown> {
  if (!isChatLinkedCreateTool(tool)) return args;
  const { chatId: _modelChat, ...rest } = args;
  return hostChatId != null ? { ...rest, chatId: hostChatId } : rest;
}

/**
 * Who the chat-access guard checks. A cloud agent acting as ITSELF (`agentRef` set and no
 * separate human — its `userId` is its own ref) has no user identity to check membership
 * for: the chat it carries was stamped by its host from the run's originating chat, so it
 * is checked tenant-scoped (null), exactly like a gateway caller. A chat in another tenant
 * is still refused — `resolveChatAccess` always filters by tenant. Any human caller —
 * including the person an addressed-agent reply runs for — is checked as themselves.
 */
export function chatLinkAccessUser(caller: { userId?: string | null; agentRef?: string | null }): string | null {
  const userId = caller.userId ?? null;
  if (caller.agentRef && (userId == null || userId === caller.agentRef)) return null;
  return userId;
}

export type ChatLinkOutcome =
  | { linked: true; chatId: number; linkType: LinkType }
  | { linked: false; chatId: number; reason: string };

/**
 * Link the item a mapped create tool just produced to the chat stamped on its arguments.
 * Returns the result unchanged when the tool is not a mapped create, no chat was stamped,
 * or the result names no item; otherwise the result plus a `chatLink` outcome. Never throws.
 */
export async function linkCreatedWorkItemToChat(
  db: Db,
  call: { tenantId: number; tool: string; arguments: unknown; env?: Env; userId?: string | null; agentRef?: string | null },
  result: unknown,
): Promise<unknown> {
  if (!isChatLinkedCreateTool(call.tool)) return result;
  const chatId = stampedChatId(call.arguments);
  if (chatId == null) return result;
  const link = createdWorkItemLink(call.tool, result);
  if (!link) return result;
  let chatLink: ChatLinkOutcome;
  try {
    const linked = await new ChatTicketService(db, call.env as Env).linkTicket(call.tenantId, chatId, chatLinkAccessUser(call), {
      kind: link.kind, ref: link.ref, linkType: link.linkType, createdBy: call.agentRef ?? call.userId ?? null,
    });
    chatLink = 'error' in linked
      ? { linked: false, chatId, reason: linked.error }
      : { linked: true, chatId, linkType: link.linkType };
  } catch (error) {
    reportCaughtError(error, { source: 'application/brain/createdWorkItemChatLink.ts', operation: 'linkCreatedWorkItemToChat', context: { tenantId: call.tenantId, chatId, tool: call.tool } });
    chatLink = { linked: false, chatId, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ...(result as Record<string, unknown>), chatLink };
}
