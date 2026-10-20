/**
 * chatTicketTypes — the chat ↔ ticket CONTRACT: which work-item kinds a chat can be
 * tied to, how a ticket is addressed (kind, ref), and the health/link/lineage shapes
 * every chat-ticket use case returns. No queries live here.
 *
 * A "ticket" is any planning/project work item, addressed as (kind, ref):
 *   kind ∈ portfolio | objective | initiative | roadmap | spec | epic | gap | task | retro | poker
 *   ref  = tasks.id as text (epic/gap/task) OR a UUID (every other tier)
 */

/**
 * The work-item kinds a chat can be tied to (planning spine + roadmap + spec + gap +
 * the two team CEREMONIES).
 *
 * `retro` and `poker` were long excluded on the grounds that they are "ceremony
 * sessions, not health-bearing work items". That reasoning does not survive contact
 * with what they are: a retrospective and an estimation session are work a TEAM
 * performs, they have an outcome, and they are exactly the kind of thing a chat gets
 * opened about. Excluding them meant a conversation that planned or ran one had
 * nowhere to record it, so the lineage simply went missing.
 */
export const TICKET_KINDS = ['portfolio', 'objective', 'initiative', 'roadmap', 'spec', 'epic', 'gap', 'task', 'retro', 'poker'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export type LinkType = 'linked' | 'created';

/** Lifecycle phases a run can narrate into its linked chats. `started`/`completed`/`failed`
 *  come from `RuntimeService.update`; `paused` (ask_human), `resumed` (the answer arriving),
 *  and `cancelled` are posted from the sites that write the execution row directly and bypass
 *  `update`; `failed` is ALSO posted by the orphan/stale reapers so a run that dies silently
 *  still reports its death to the humans driving the linked chats. */
export type RunMilestonePhase = 'started' | 'completed' | 'failed' | 'paused' | 'resumed' | 'cancelled';

/** Chat-ticket kind for a task row's `task_type` — epics and gaps keep their own kind,
 *  everything else addresses as 'task'. Shared by every run-milestone producer
 *  (RuntimeService, the stale-execution reaper) so `chat_ticket_links` lookups agree. */
export function ticketKindForTaskType(taskType?: string | null): 'epic' | 'gap' | 'task' {
  return taskType === 'epic' || taskType === 'gap' ? taskType : 'task';
}

export function isTicketKind(v: string): v is TicketKind {
  return (TICKET_KINDS as readonly string[]).includes(v);
}

/**
 * The work item a ticket hangs UNDER — the epic a task belongs to, or the epic a
 * sub-epic sits beneath. Task, epic and gap all live in the `tasks` table and hang
 * off `tasks.parent_task_id`, so ONE resolution names the parent of all three.
 */
export interface TicketParent {
  kind: 'epic' | 'task' | 'gap';
  ref: string;
  /** The parent's title, for display ("in Advisor Platform"). */
  label: string;
}

export interface TicketHealth {
  kind: TicketKind;
  ref: string;
  /** Display title/name; '(deleted)' when the target no longer resolves. */
  label: string;
  /** Raw status string of the work item (free-form for tasks). */
  status: string;
  /**
   * 0–100 completion percentage. Leaf task/gap = done?100:0 (50 while
   * in_progress/in_review); container (epic/initiative/portfolio) = round(done/total);
   * objective = rounded key-result rollup; roadmap/spec = 100 when its own status
   * is terminal.
   *
   * `progressPct === 100` EMISSION RULE — the authoritative completion signal:
   * - Emitted ONLY once the work item is fully complete: for a leaf, when it is
   *   marked done (`completedAt != null` OR status ∈ {done, completed, archived});
   *   for a container, when EVERY child/target that counts is complete
   *   (`done === total`). It is NEVER reported before completion — an item that is
   *   in progress reports a value < 100 (e.g. 50), never 100.
   * - Idempotent, not "fired once": health is derived live on every read (this
   *   value is deliberately uncached), so a completed item reports 100 on every
   *   subsequent read. Consumers must treat 100 as an idempotent terminal state,
   *   not a one-shot event, and must not assume it is delivered exactly once.
   * - Values approaching 100 (e.g. 99) are NOT completion. Only an exact 100 is the
   *   completion signal; do not treat a near-100 value as done.
   * - `progressPct === 100` corresponds to `done === total` and, for a leaf, to a
   *   terminal `status`. Both agree by construction — there is no state where
   *   `progressPct` is 100 while the item is not complete, except the cap below.
   * - EXCEPTION — unsupported delivery. An epic whose children (or own status)
   *   read complete, but a live execution on the epic or a direct child exists and
   *   no coder run left a non-documentation file, does NOT emit 100. `progressPct`
   *   is capped at `UNSUPPORTED_DELIVERY_PROGRESS_CAP` and `unsupportedDelivery`
   *   is set. No executions means unknown, not unsupported — absence is not
   *   evidence, so 100 is still emitted. The cap is applied before the value is
   *   stored, so a consumer that ignores the flag still cannot read 100.
   */
  progressPct: number;
  /**
   * Set when this epic's 100 was withheld because delivery evidence does not
   * support it. Absent when delivery is supported or there is nothing to judge.
   */
  unsupportedDelivery?: boolean;
  done: number;
  total: number;
  /** False when the referenced ticket no longer exists in the tenant. */
  exists: boolean;
  /**
   * The work item this ticket belongs to — the epic above a task, or the epic above
   * a sub-epic. Set for the task-tier kinds (task/epic/gap) whose `parentTaskId`
   * resolves inside the tenant; ABSENT for a top-level item, an orphan whose parent
   * was deleted, and for every other tier (portfolio/objective/initiative/roadmap/
   * spec/retro/poker have no `tasks.parent_task_id`).
   *
   * This is what lets a chat's ticket rail say WHICH epic each chip belongs to
   * instead of rendering a flat list where a hierarchy cannot be told apart.
   */
  parent?: TicketParent;
}

export interface ChatTicketLink extends TicketHealth {
  linkId: number;
  linkType: LinkType;
  createdBy: string | null;
  createdAt: Date;
}

/** One typeahead hit — the minimal shape the link picker renders (ref + label). */
export interface TicketSearchHit {
  ref: string;
  label: string;
}

export interface LinkedChatRef {
  chatId: number;
  title: string;
  linkType: LinkType;
  projectId: number | null;
  createdAt: Date;
  updatedAt: Date;
  isArchived: boolean;
  mergedIntoChatId: number | null;
}

/** Health for a (kind, ref) that no longer resolves in the tenant. */
export function missingTicket(kind: TicketKind, ref: string): TicketHealth {
  return { kind, ref, label: '(deleted)', status: 'unknown', progressPct: 0, done: 0, total: 0, exists: false };
}

/** `${kind}:${ref}` — the key every health map is indexed by. */
export function ticketKey(kind: string, ref: string): string {
  return `${kind}:${ref}`;
}
