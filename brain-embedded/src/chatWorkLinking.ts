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
