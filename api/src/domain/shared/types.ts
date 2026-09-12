/** Branded type helpers to prevent ID mix-ups at compile time. */
export type ProjectId   = number & { readonly __brand: 'ProjectId' };
export type TaskId      = number & { readonly __brand: 'TaskId' };
export type TenantId    = number & { readonly __brand: 'TenantId' };
export type AgentId     = number & { readonly __brand: 'AgentId' };
export type AgentHostId      = number & { readonly __brand: 'AgentHostId' };
export type SkillId     = number & { readonly __brand: 'SkillId' };
export type ExecutionId = number & { readonly __brand: 'ExecutionId' };
/** User IDs are UUID strings (not sequential integers). */
export type UserId = string & { readonly __brand: 'UserId' };

export const asProjectId   = (n: number): ProjectId   => n as ProjectId;
export const asTaskId      = (n: number): TaskId      => n as TaskId;
export const asTenantId    = (n: number): TenantId    => n as TenantId;
export const asAgentId     = (n: number): AgentId     => n as AgentId;
export const asAgentHostId      = (n: number): AgentHostId      => n as AgentHostId;
export const asSkillId     = (n: number): SkillId     => n as SkillId;
export const asExecutionId = (n: number): ExecutionId => n as ExecutionId;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export enum ProjectStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
  ON_HOLD = 'on_hold',
}

export enum TaskStatus {
  BACKLOG = 'backlog',
  TODO = 'todo',
  READY = 'ready',
  IN_PROGRESS = 'in_progress',
  IN_REVIEW = 'in_review',
  DONE = 'done',
  BLOCKED = 'blocked',
}

/**
 * The statuses a ticket is still WORKABLE in — i.e. everything the manager grooms,
 * ranks, staffs, triages and counts as active.
 *
 * One definition because it was three: `ManagerService`, `runManagerSweep` and
 * `managerRoutes` each carried a private copy of the identical array. Three copies of
 * "which tickets are still open" is exactly the drift that lets the sweep pick up a
 * project the pass then considers empty, or a count on one surface disagree with the
 * board on another.
 *
 * `blocked` is deliberately INCLUDED: a blocked ticket has not left the board, it is
 * waiting on something, and the manager's whole job is to notice that.
 */
export const NON_TERMINAL_TASK_STATUSES: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED,
];

/** True when the ticket has left the board (done, cancelled, or any non-workable state). */
export function isTerminalTaskStatus(status: string | null | undefined): boolean {
  return !NON_TERMINAL_TASK_STATUSES.includes(status ?? '');
}

export enum TaskPriority {
  LOW     = 'low',
  MEDIUM  = 'medium',
  HIGH    = 'high',
  URGENT  = 'urgent',
}

/**
 * Task type — the fixed automation dimension (distinct from the free-form board
 * `status` lane key). An EPIC is a planning container that decomposes into child
 * TASKs which link back to it via `parentTaskId`. See migration 0112.
 */
export enum TaskType {
  TASK = 'task',
  EPIC = 'epic',
  /** Minted by the Validator agent when a reviewed Done item is found incomplete
   *  (migration 0270). A first-class, schedulable board item that carries a
   *  gapOriginTaskId back to the Done item it was found in. */
  GAP = 'gap',
  /** Minted by the Security agent for a SOC 2 audit finding (migration 0290). A
   *  first-class, schedulable board item carrying the finding's severity + Trust
   *  Service Criterion, and access-restricted via security_ticket_access — visible
   *  only to allowlisted/opted-in audiences plus Owner/Admin. */
  SECURITY = 'security',
  /** Opened by the Incident Manager agent for a help-desk ticket that reads as an
   *  incident (migration 0325). A first-class, schedulable board item carrying the
   *  incident's severity, status and affected system, bridged to a prodIncidents
   *  record (task.incidentId) that owns the MTTR/escalation lifecycle. */
  INCIDENT = 'incident',
  /** A defect report (migration 1160) — the spec's / BurnRateOS's ItemType BUG.
   *  Every other spec ItemType already had a platform owner (INITIATIVE →
   *  `initiatives`, EPIC → EPIC, STORY/TASK → TASK, SUBTASK → TASK +
   *  `parentTaskId`); a bug had none, so it is a kind value here rather than a
   *  second work-item table. Runs and schedules exactly like a TASK. */
  BUG = 'bug',
}

export enum AgentType {
  CLAUDE = 'claude',
  OPENAI = 'openai',
  OLLAMA = 'ollama',
  HTTP = 'http',
}

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export enum TenantRole {
  OWNER       = 'owner',
  MANAGER     = 'manager',
  DEVELOPER   = 'developer',
  /**
   * Seated by a canvas share that grants EDIT on a board (operator decision
   * 2026-09-12). A contributor reads the workspace like a viewer and writes only
   * the canvases they hold a `creation_session_members` row on — canvas writes are
   * gated by the BOARD role (`application/creation/sessionAccess.ts`), never by a
   * tenant tier. Ranked below developer so every `>= developer` gate refuses it.
   */
  CONTRIBUTOR = 'contributor',
  VIEWER      = 'viewer',
}

/** The role's wire/database spelling — accepted wherever a literal like `'manager'`
 *  is the natural thing to write, so callers need not import the enum to name one. */
export type TenantRoleName = `${TenantRole}`;

export enum TenantPlan {
  FREE = 'free',
  PRO = 'pro',
  TEAMS = 'teams',
}

export enum TenantBillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum TenantBillingStatus {
  NONE = 'none',
  PENDING = 'pending',
  ACTIVE = 'active',
  /** Inside the introductory 14-day Pro trial (see Tenant.create / effectivePlan). */
  TRIALING = 'trialing',
  PAST_DUE = 'past_due',
  CANCELLED = 'cancelled',
}

/**
 * THE tenant role ladder — ascending, higher index = more authority. The ONE
 * declaration: `application/tenant/tenantRoles.ts` used to carry a second copy
 * (`TENANT_ROLE_ORDER`), which is how a new role gets added to one ladder and not
 * the other. Callers ask "at least X?" via {@link hasMinRole} instead of listing
 * which roles qualify.
 *
 * Mirrors the `tenant_role` Postgres enum in `schema/kernel.ts`. Not derived from
 * it: pgEnum preserves declaration order, not authority order.
 */
export const ROLE_ORDER: readonly TenantRole[] = [
  TenantRole.VIEWER,
  TenantRole.CONTRIBUTOR,
  TenantRole.DEVELOPER,
  TenantRole.MANAGER,
  TenantRole.OWNER,
];

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (ROLE_ORDER as readonly string[]).includes(value);
}

/**
 * Does `actual` meet or exceed `required`?
 *
 * An unknown or absent role is FALSE, never a lenient default: a row carrying a
 * role this build does not know is corruption or a deploy running behind a
 * migration, and both should refuse rather than admit.
 */
export function hasMinRole(actual: string | null | undefined, required: TenantRole | TenantRoleName): boolean {
  const have = ROLE_ORDER.indexOf(actual as TenantRole);
  return have >= 0 && have >= ROLE_ORDER.indexOf(required as TenantRole);
}

// ---------------------------------------------------------------------------
// Execution / Runtime
// ---------------------------------------------------------------------------

export enum ExecutionStatus {
  PENDING   = 'pending',
  SUBMITTED = 'submitted',
  RUNNING   = 'running',
  COMPLETED = 'completed',
  FAILED    = 'failed',
  CANCELLED = 'cancelled',
  /** Non-terminal: a cloud run that called `ask_human` is waiting on a person to
   *  answer its question (migration 0120). It resumes when the answer lands. */
  PAUSED    = 'paused',
}

// ---------------------------------------------------------------------------
// Artifact assignments
// ---------------------------------------------------------------------------

/**
 * Migration 0982: `CONTENT` retired (browser-only content blocks that no table
 * held — they live in `knowledge_documents` now), `AGENT` admitted so a
 * marketplace agent's sale records in `marketplace_purchases` alongside every
 * other artifact rather than in a purchase table of its own.
 */
export enum ArtifactType {
  SKILL   = 'skill',
  PERSONA = 'persona',
  AGENT   = 'agent',
}

export enum AssignmentScope {
  AGENT   = 'agent',
  TENANT  = 'tenant',
  HOST    = 'host',
  PROJECT = 'project',
  TASK    = 'task',
}

export type ResolvedArtifacts = {
  skills:   string[];
  personas: string[];
  content:  string[];
  /**
   * Where each resolved slug came FROM — its most-specific assignment scope
   * ('agent' | 'task' | 'project' | 'host' | 'tenant').
   *
   * The resolver returns a UNION across the whole scope hierarchy, so a slug in
   * `skills` may be pinned to this agent or inherited from the tenant. Without the
   * scope the two are indistinguishable, and the `capabilities.load` timeline event
   * reported "the agent loaded X" for artifacts the agent never carried — which is
   * the difference between "this agent is configured for this" and "everyone is".
   *
   * Optional so older/synthetic resolutions stay valid; absent means "unlabelled",
   * never "tenant".
   */
  sources?: Record<string, AssignmentScope>;
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export enum AuditEventType {
  USER_REGISTERED       = 'user_registered',
  USER_LOGIN            = 'user_login',
  TASK_SUBMITTED        = 'task_submitted',
  TASK_CANCELLED        = 'task_cancelled',
  EXECUTION_STARTED     = 'execution_started',
  EXECUTION_COMPLETED   = 'execution_completed',
  EXECUTION_FAILED      = 'execution_failed',
  AGENT_REGISTERED      = 'agent_registered',
  MEMBER_ADDED          = 'member_added',
  MEMBER_REMOVED        = 'member_removed',
  PROJECT_CREATED       = 'project_created',
  PROJECT_UPDATED       = 'project_updated',
  TASK_CREATED          = 'task_created',
  TASK_UPDATED          = 'task_updated',
}
