/**
 * Chat ⇄ work linking — the single source for (a) the system-prompt directive that
 * tells the Brain to turn work it identifies or code it changes into a ticket LINKED
 * to the current conversation, and (b) the tool-name predicates that back the
 * deterministic "a code change is always tied to a ticket" guarantee.
 *
 * Why it lives here: the shared agent loop ({@link ./brainRunStore}) drives BOTH the
 * web Brain and the VS Code webview Brain, and it is the one place that always knows
 * the RESOLVED chatId of the run. Injecting the directive there (with the real id)
 * gives the primary Brain loop the same behaviour the server-side `@agent` reply loop
 * already has (BrainService.agentReply bakes the chatId in), so:
 *   1. when the agent's investigation determines work must be done, it CREATES the
 *      work item and links it to this chat (lineage), instead of only describing it;
 *   2. when the agent changes code, that change becomes a ticket linked to this chat.
 *
 * The predicates are also consumed by the loop's post-run backstop: if a run changed
 * code (a workspace file tool succeeded) but never itself recorded a ticket, the loop
 * mints one via `builtin_tickets_from_delta` tied to the chat — so an IDE edit is
 * never left invisible or unlinked.
 *
 * Kept framework-free (pure strings + Sets) so it is safe in every bundle.
 */

/**
 * Advertised (gateway `builtin_*`) names of the platform tools that RECORD work
 * against the chat. If the model calls any of these itself during a run, the turn
 * already tied its work to a ticket and the deterministic backstop stays quiet.
 */
export const TICKET_RECORDING_TOOLS: ReadonlySet<string> = new Set([
  'builtin_tickets_from_delta',
  'builtin_chats_link_ticket',
  'builtin_reviews_record',
]);

/**
 * Local workspace tools whose success means the agent CHANGED code on disk — the
 * surface-specific signal that a ticket must exist. Only the VS Code (IDE) surface
 * exposes these; the web Brain has no file tools, so a web run never trips the
 * backstop. `run_command` is intentionally excluded: it usually runs tests / build /
 * lint, not a durable code change, so treating it as one would mint spurious tickets.
 */
export const CODE_CHANGE_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'delete_file',
]);

export function isCodeChangeTool(name: string): boolean {
  return CODE_CHANGE_TOOLS.has(name);
}

/**
 * Advertised (gateway `builtin_*`) names of the platform tools that CREATE a
 * chat-linkable work item, mapped to the `chat_ticket_links` kind their result
 * represents. `builtin_tasks_create` is special-cased (its kind is the row's own
 * `taskType`: task | epic | gap), so it is not in this table. Adding an entry here
 * makes a create tool auto-link to the conversation — see {@link workItemLinkFromCreate}.
 */
const CREATE_TOOL_KIND: Readonly<Record<string, string>> = {
  builtin_objectives_create: 'objective',
  builtin_specs_create: 'spec',
  builtin_portfolios_create: 'portfolio',
  builtin_initiatives_create: 'initiative',
};

/** A work item a create tool just produced, in the shape `builtin_chats_link_ticket`
 *  wants: which tier it is, its ref, and whether it was newly created vs. an
 *  idempotent hit on a pre-existing item (so the link records the honest lineage). */
export interface CreatedWorkItemLink {
  kind: string;
  ref: string;
  linkType: 'created' | 'linked';
}

/**
 * Derive the chat-link descriptor for the result of a work-item CREATE tool, or null
 * when the tool is not a create (or the result carries no usable id). This is what
 * makes "an item the Brain creates is always tied to the conversation" DETERMINISTIC:
 * the run loop fires `builtin_chats_link_ticket` off this instead of hoping the model
 * remembers to. An idempotent-hit result (`{ deduped: true, … }`) links as 'linked'
 * (the item already existed) rather than 'created'.
 */
export function workItemLinkFromCreate(toolName: string, result: unknown): CreatedWorkItemLink | null {
  if (!result || typeof result !== 'object') return null;
  const row = result as Record<string, unknown>;
  const id = row.id;
  const ref = typeof id === 'number' ? String(id) : typeof id === 'string' && id.trim() ? id : null;
  if (!ref) return null;
  const linkType: 'created' | 'linked' = row.deduped === true ? 'linked' : 'created';
  if (toolName === 'builtin_tasks_create') {
    const t = typeof row.taskType === 'string' ? row.taskType : 'task';
    const kind = t === 'epic' || t === 'gap' ? t : 'task';
    return { kind, ref, linkType };
  }
  const kind = CREATE_TOOL_KIND[toolName];
  return kind ? { kind, ref, linkType } : null;
}

export function isTicketRecordingTool(name: string): boolean {
  return TICKET_RECORDING_TOOLS.has(name);
}

/** The workspace-relative path a code-change tool touched (for delta provenance),
 *  or null when the args carry no usable `path`. */
export function codeChangeFile(args: unknown): string | null {
  if (args && typeof args === 'object' && 'path' in args) {
    const p = (args as { path?: unknown }).path;
    if (typeof p === 'string' && p.trim()) return p;
  }
  return null;
}

/**
 * The system-prompt block that binds a chat's work to the conversation. Encodes BOTH
 * operator requirements: investigation-identified work → create + link; and a code
 * change → from_delta tied to this chat. Uses the advertised `builtin_*` tool names
 * the model actually sees on the gateway MCP relay.
 */
export function chatWorkLinkingDirective(chatId: number): string {
  return (
    `You are working inside Brain chat #${chatId}. Tie the work of this conversation back to it:\n` +
    `• When your investigation concludes that something needs to be DONE — a bug to fix, a missing capability, a follow-up, or a gap you identified — do not merely describe it. Create the work item now (builtin_tasks_create with taskType "task", "epic", or "gap"; or the matching builtin_*_create for an objective, spec, or roadmap item) AND link it to this conversation with builtin_chats_link_ticket (chatId=${chatId}, linkType="created"). To hand a large or long-horizon job off to run autonomously, set assignedAgentRef on the created task.\n` +
    `• When your turn ADDS or CHANGES code, record it with builtin_tickets_from_delta (chatId=${chatId}, the current projectId, the files you touched, kind improvement|fix|bug, modality "ide") so the change becomes a ticket linked to this chat that completes when it ships.\n` +
    `• Call builtin_chats_list_tickets (chatId=${chatId}) to see what is already linked before creating a duplicate. Never end a turn having identified actionable work or changed code without it being a ticket linked to this chat.`
  );
}
