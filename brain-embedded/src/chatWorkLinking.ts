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

/**
 * Read-only PLATFORM (gateway `builtin_*`) tool suffixes whose identical-args repeat
 * within a SINGLE run is safe to suppress (idempotent observation — the result is already
 * in the transcript above). Each entry is the FULL trailing verb of a CATALOG tool marked
 * `mutates: false`, and every one is DISJOINT from all mutating verbs — so a write can
 * NEVER be misread as a read and dropped (e.g. we list `_list_agents`, never bare
 * `_agents`, because the mutating `analytics.sync_agents` also ends `_agents`). This is the
 * fix for the Brain "keeps re-checking the same thing" loop: the read-dedupe used to cover
 * only the 3 LOCAL file tools, and any platform/MCP call (tasks.list, cloud_agents.list_mine,
 * chats.list_tickets, …) both went un-deduped AND wiped the file cache — so repeated roster
 * / ticket / task listings re-ran every turn until the iteration cap. Conservative by design:
 * a missed suffix costs one harmless re-read; a wrong one would drop a mutation, so the list
 * omits verbs shared with writes (`import`, `remember`).
 */
const READ_ONLY_PLATFORM_SUFFIXES: readonly string[] = [
  '_list', '_get', '_search', '_recall', '_read', '_assignees', '_audit', '_trace',
  '_tree', '_rollup', '_runs', '_graph', '_triggers', '_metrics', '_usage', '_query',
  '_health', '_models', '_providers', '_proposals', '_ticket_lineage', '_get_messages',
  '_run_targets', '_activity_calendar', '_check_key', '_browse_public', '_tool_audit',
  '_task_file_changes', '_list_active', '_list_agents', '_list_all', '_list_for_task',
  '_list_mine', '_list_recent', '_list_tickets', '_list_sessions', '_list_users',
  '_list_templates', '_list_purchased', '_list_directories', '_list_error_groups',
  '_list_pull_requests', '_get_session', '_get_stats', '_get_user', '_get_config',
  '_get_access', '_get_error_group',
];

/**
 * True for a read-only, idempotent PLATFORM tool (gateway `builtin_*`) whose exact-args
 * repeat within one run can be suppressed. Only `builtin_`-prefixed names qualify (local
 * file tools are handled by the caller's own set); classification is by a read-only verb
 * SUFFIX that no mutating tool shares, so it never returns true for a tool that writes.
 */
export function isReadOnlyPlatformTool(name: string): boolean {
  if (!name.startsWith('builtin_')) return false;
  return READ_ONLY_PLATFORM_SUFFIXES.some((s) => name.endsWith(s));
}

/**
 * Task-tier statuses that mean "not started yet" — mirrors the board's not-started
 * lanes (TaskStatus BACKLOG | TODO | READY). A linked ticket in one of these that a
 * code-changing run actively worked is advanced to `in_progress` by the loop backstop,
 * so "you worked a ticket but never moved it off backlog" can't happen silently.
 * `blocked` / `in_progress` / `in_review` / `done` are deliberately excluded — the run
 * must not un-block, re-open, or regress a ticket that already moved past the backlog.
 */
export const NOT_STARTED_TASK_STATUSES: ReadonlySet<string> = new Set(['backlog', 'todo', 'ready']);

/** Ticket tiers whose status lives on the tasks table (settable via builtin_tasks_update). */
const TASK_TIER_KINDS: ReadonlySet<string> = new Set(['task', 'epic', 'gap']);

/** A linked ticket the deterministic backstop should advance to in_progress. */
export interface LinkedTicketToAdvance {
  kind: string;
  ref: string;
}

/**
 * From a `builtin_chats_list_tickets` result, the task-tier tickets still sitting in a
 * not-started lane — the ones a code-changing run left behind in backlog. The loop
 * advances each to `in_progress` via `builtin_tasks_update`, closing the gap that let
 * the agent "start work on a ticket without ever updating its status". Tolerant of the
 * tool result arriving as a JSON string, a parsed array, or an error object (returns
 * [] for anything unusable), and skips deleted/unresolved links.
 */
export function linkedTicketsToAdvance(listResult: unknown): LinkedTicketToAdvance[] {
  let rows: unknown = listResult;
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];
  const out: LinkedTicketToAdvance[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as { kind?: unknown; ref?: unknown; status?: unknown; exists?: unknown };
    if (typeof row.kind !== 'string' || !TASK_TIER_KINDS.has(row.kind)) continue;
    if (row.exists === false) continue;
    const ref = typeof row.ref === 'number' ? String(row.ref) : typeof row.ref === 'string' && row.ref.trim() ? row.ref : null;
    if (!ref) continue;
    if (typeof row.status !== 'string' || !NOT_STARTED_TASK_STATUSES.has(row.status.toLowerCase())) continue;
    out.push({ kind: row.kind, ref });
  }
  return out;
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
    `• When your investigation concludes that something needs to be DONE — a bug to fix, a missing capability, a follow-up, or a gap you identified — do not merely describe it. First use builtin_tasks_assignees to select the ticket's accountable Coordinator/Manager, then create the work item (builtin_tasks_create with exactly one assignee and taskType "task", "epic", or "gap"; or the matching builtin_*_create for an objective, spec, or roadmap item) AND link it with builtin_chats_link_ticket (chatId=${chatId}, linkType="created"). The ticket assignee COORDINATES delivery; do not assume that person/agent performs every specialist contribution.\n` +
    `• Every created ticket must be resource-scoped before you report success: inspect its template manifest with builtin_kanban_participants; infer all additional roles required by its description and acceptance criteria; add each with builtin_kanban_assess_resource; then call builtin_kanban_accountability and explicitly report any unstaffed resource gaps. For an epic or multi-role ticket, call builtin_kanban_materialize_work_items so each required resource has an assigned child work item. Call builtin_kanban_coordinate when work should begin now. Never treat 0 required roles / 0 sign-offs as complete.\n` +
    `• When your turn ADDS or CHANGES code, record it with builtin_tickets_from_delta (chatId=${chatId}, the current projectId, the files you touched, kind improvement|fix|bug, modality "ide") so the change becomes a ticket linked to this chat that completes when it ships.\n` +
    `• Keep the board honest about STATUS. The MOMENT you start actively working an existing linked task/epic/gap — investigating its fix, editing code for it, or driving it — move it out of the backlog with builtin_tasks_update (id=<the ticket's ref>, status="in_progress"). When the work is finished and shipped, advance it to "in_review" (or "done" if it needs no review). Never leave a ticket you are actively working sitting in backlog.\n` +
    `• Call builtin_chats_list_tickets (chatId=${chatId}) to see what is already linked — both to AVOID creating a duplicate and to know which linked tickets need their status advanced. Never end a turn having identified actionable work or changed code without it being a ticket linked to this chat whose status reflects the work you did.`
  );
}
