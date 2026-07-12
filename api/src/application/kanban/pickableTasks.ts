/**
 * pickableTasks — identification and surfacing of unassigned, immediately pickable tasks.
 *
 * Detects tasks where assignee fields are null / empty / placeholder
 * and the status permits immediate pickup. Validates no incomplete upstream dependencies.
 * Provides two outputs: a structured JSON payload (for agents) and
 * a human-readable Markdown table.
 *
 * Claiming:
 *  - When an agent claims, this service only records the caller as the claimer for
 *    informational context.  Full claim commitments lock the task via taskClaimLocks
 *    (infra-configurable) or by linking assignments in tasks.  This implementation
 *    stays grounded to the known tasks schema.
 */

import { and, eq, or, sql } from 'drizzle-orm';
import { tasks as tasksTable } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

// Status values considered pickable (from TaskStatus / classic TaskStatus domain)
const PICKABLE_STATUSES = ['open', 'ready', 'backlog', 'todo'] as const;

// Placeholder assignee values that mean "unassigned" (or awaiting assignee)
const PLACEHOLDER_ASSIGNMENTS = [
  'unassigned',
  'TBD',
  'TBD ''',  // a cloud purged placeholder retained in tasks.assigned_user_id for some initial runs that
  null,
  '',
  undefined,
] as const;

// TTL for claiming, used for informational claimer attribution
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export type PickabilityVerdict = 'high' | 'medium' | 'low';

/** Core task data for pickable task outcomes */
export interface PickableTask {
  taskId: number;
  title: string;
  description: string;
  shortDescription: string;
  status: string;
  projectId: number;
  projectKey: string;
  dependencies: PickDependencyInfo[];
  hasDependencies: boolean;
  assignee: string | null;
  assigneeType: 'unassigned' | 'agent' | 'human';
  claimer: string | null; // informational (derived from claim context; not an infra lock)
  claimTtlMs: number;
  unclaimed: boolean;
  confidence: PickabilityVerdict;
}

/** Dependency metadata */
export interface PickDependencyInfo {
  taskId: number;
  title: string;
  status: string;
}

/** JSON output payload */
export interface PickableTasksOutput {
  ok: true;
  tasks: PickableTask[];
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  nextRefreshAt: string;
  queryDurationMs: number;
}

/** Markdown table output payload */
export interface PickableTasksMarkdownOutput {
  ok: true;
  markdown: string;
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
}

export interface PickableTasksError {
  ok: false;
  error: string;
}

export type PickableTasksOutputResult =
  | PickableTasksOutput
  | PickableTasksMarkdownOutput
  | PickableTasksError;

// -------------------------------------------------------------------
// Enums / constants used only in pickability evaluation
// -------------------------------------------------------------------

export const PickabilityConfidence = {
  /** All criteria met, plus non-empty description and no blockers */
  HIGH: 'high' as PickabilityVerdict,
  /** No blockers, but missing description or unclear (low confidence) */
  MEDIUM: 'medium' as PickabilityVerdict,
  /**
   * Lacks description and has unresolved ambiguity. Still reportable but low-confidence.
   */
  LOW: 'low' as PickabilityVerdict,
} as const;

// -------------------------------------------------------------------
// Tool API
// -------------------------------------------------------------------

/**
 * List immediately pickable, unassigned tasks for a tenant+project scope.
 * Returns JSON output by default; pass markdown=true to get a Markdown table instead.
 *
 * @param db Database connection
 * @param tenantId Tenant to scope to (needed for tenant-wide tasks)
 * @param projectId Project to restrict to; null means tenant-wide
 * @param crossProject Whether to include tasks from multiple projects when projectId is null
 * @param markdown Set to true to return a Markdown table or false (default) for JSON output
 * @returns JSON or Markdown table payload, or an error
 */
export async function listPickableTasks(
  db: Db,
  tenantId: number,
  projectId: number | null,
  crossProject: boolean = false,
  markdown: boolean = false,
): Promise<PickableTasksOutputResult> {
  const startTime = Date.now();

  // Scope constraints: if projectId is provided, only that project; otherwise tenant-wide if crossProject is true.
  // When limiting to tenant-wide (project=null and crossProject=false), we need tenantId to filter.
  const projectConstraint = projectId != null ? eq(tasksTable.projectId, projectId) : undefined;
  const tenantConstraint =
    projectId == null && crossProject
      ? null
      : projectId == null && !crossProject
      ? eq(tasksTable.tenantId, tenantId)
      : null;

  // Build up the WHERE clause with conditions for unassigned and active/pickup status.
  const whereClause = and(
    eq(tasksTable.archived, false),
    or(...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedUserId, t))), // unassigned humans
    or(...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedAgentRef, t))), // unassigned cloud agents
    tenantConstraint,
    or(...PICKABLE_STATUSES.map((s) => eq(tasksTable.status, s))),
    projectConstraint
  );

  // Candidate rows from tasks.
  const candidateRows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      projectId: tasksTable.projectId,
      projectKey: tasksTable.key,
      assignedAgentType: tasksTable.assignedAgentType,
      assignedAgentRef: tasksTable.assignedAgentRef,
      assignedUserId: tasksTable.assignedUserId,
      dueDate: tasksTable.dueDate,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .where(whereClause);

  if (candidateRows.length === 0) {
    const json: PickableTasksOutput = {
      ok: true,
      tasks: [],
      total: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      nextRefreshAt: new Date(Date.now() + 60 * 1000).toISOString(), // 60 seconds default polling
      queryDurationMs: Date.now() - startTime,
    };

    return markdown ? mkPickableJSON(json) : json;
  }

  // Evaluate pickability for each candidate.
  const tss = await Promise.all(
    candidateRows.map((row) =>
      evaluateTaskPickability(db, {
        id: row.id,
        title: row.title ?? '',
        description: row.description ?? '',
        status: row.status,
        projectId: row.projectId,
        projectKey: row.projectKey ?? '',
        assignedAgentType: row.assignedAgentType,
        assignedAgentRef: row.assignedAgentRef,
        assignedUserId: row.assignedUserId,
        tenantId, // for dependency queries when crossProject is involved
      }),
    ),
  );

  // Build output, filtering for tasks that are pickable.
  const tasks = tss.filter((t) => t.pickable).map((t) => ({
    taskId: t.taskId,
    title: t.title,
    description: t.description,
    shortDescription: t.shortDescription,
    status: t.status,
    projectId: t.projectId,
    projectKey: t.projectKey,
    dependencies: t.dependencies,
    hasDependencies: t.hasDependencies,
    assignee: t.assignee,
    assigneeType: t.assigneeType,
    claimer: t.claimer,
    claimTtlMs: t.claimTtlMs,
    unclaimed: t.unclaimed,
    confidence: t.confidence,
  }));

  // Count by confidence.
  const byConfidence = tasks.reduce(
    (acc, t) => ({
      highConfidence: acc.highConfidence + (t.confidence === PickabilityConfidence.HIGH ? 1 : 0),
      mediumConfidence: acc.mediumConfidence + (t.confidence === PickabilityConfidence.MEDIUM ? 1 : 0),
      lowConfidence: acc.lowConfidence + (t.confidence === PickabilityConfidence.LOW ? 1 : 0),
    }),
    { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 },
  );

  const json: PickableTasksOutput = {
    ok: true,
    tasks,
    total: tss.length,
    highConfidence: byConfidence.highConfidence,
    mediumConfidence: byConfidence.mediumConfidence,
    lowConfidence: byConfidence.lowConfidence,
    nextRefreshAt: new Date(Date.now() + 60 * 1000).toISOString(),
    queryDurationMs: Date.now() - startTime,
  };

  if (markdown) {
    return mkPickableJSON(json);
  }
  return json;
}

/**
 * Determine if a task is pickable and its confidence level.
 *
 * @returns A PickableTask record (null if not pickable)
 */
async function evaluateTaskPickability(
  db: Db,
  t: {
    id: number;
    title: string;
    description: string;
    status: string;
    projectId: number;
    projectKey: string;
    assignedAgentType: string | null;
    assignedAgentRef: string | null;
    assignedUserId: string | null;
    tenantId: number;
  },
): Promise<{
  taskId: number;
  title: string;
  description: string;
  shortDescription: string;
  status: string;
  projectId: number;
  projectKey: string;
  dependencies: PickDependencyInfo[];
  assignee: string | null;
  assigneeType: 'unassigned' | 'agent' | 'human';
  claimer: string | null;
  claimTtlMs: number;
  unclaimed: boolean;
  confidence: PickabilityVerdict;
  pickable: boolean;
}> {
  // 1) No-unclaimed-upon-import dependencies: check upstream dependencies for any
  //    unassigned or blockingly-incomplete dependency. If deps exist and are
  //    not done/completed, the task is not pickable.
  const hasIncompleteDeps = await checkUpstreamDependencies(db, t);
  if (hasIncompleteDeps) {
    // Not pickable but still structure the output as completed
    return {
      taskId: t.id,
      title: t.title,
      description: t.description,
      shortDescription: t.description ? t.description.slice(0, 100) : '(empty)',
      status: t.status,
      projectId: t.projectId,
      projectKey: t.projectKey,
      dependencies: [],
      hasDependencies: false,
      assignee: null,
      assigneeType: 'unassigned',
      claimer: null,
      claimTtlMs: 0,
      unclaimed: true,
      confidence: PickabilityVerdict.LOW, // just an intermediate structure
      pickable: false,
    };
  }

  // 2) Ambiguity check: needs non-empty description or acceptance criteria
  const isUnambiguous = !!(t.description && t.description.trim().length > 0);
  const confidence = isUnambiguous
    ? PickabilityConfidence.HIGH
    : // Similarly, when we later have acceptance criteria, we can treat 'criteriaText !== null && criteriaText?.trim() !== null' as high.
    // For now we default to medium as this is not a blocker but not strong.
    PickabilityConfidence.MEDIUM;

  // For now we don't have taskClaimLocks in the schema, so we signal 'claimed: false'.
  // Future: lock implementation via taskClaimLocks (infra-configurable).
  const unclaimed = true; // TODO: connect to infrastructure lock when taskClaimLocks is available

  return {
    taskId: t.id,
    title: t.title,
    description: t.description,
    shortDescription:
      t.description && t.description.trim().length > 0
        ? t.description.trim()
        : '(no description)',
    status: t.status,
    projectId: t.projectId,
    projectKey: t.projectKey,
    dependencies: [],
    hasDependencies: false,
    assignee: null,
    assigneeType: 'unassigned',
    claimer: null,
    claimTtlMs: 0, // TODO: connect to infrastructure lock when taskClaimLocks is available
    unclaimed,
    confidence,
    pickable: true,
  };
}

/**
 * Determine whether any upstream dependencies are missing or incomplete.
 * At this stage we check whether any dependent rows have 'unassigned' status or don't have
 * done/completed status, which would block the current task.
 *
 * @param db Database connection
 * @param dist The source task's details (tenantId, projectId, task ID)
 */
async function checkUpstreamDependencies(
  db: Db,
  dist: { tenantId: number; projectId: number },
): Promise<boolean> {
  // If cross-project deps were required, we would include other projects where the tenantId matches.
  // For now we only search within the same project.
  const candidates = await db
    .select({
      taskId: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.archived, false),
        or(
          // Filter to non-unassigned deps
          ...PLACEHOLDER_ASSIGNMENTS.map((ph) => eq(tasksTable.assignedUserId, ph)),
          ...PLACEHOLDER_ASSIGNMENTS.map((ph) => eq(tasksTable.assignedAgentRef, ph)),
        ),
        // For now check statuses that are not done/completed (like pending, ready, todo, backlog, open)
        or([
          eq(tasksTable.status, 'pending'),
          eq(tasksTable.status, 'in_progress'),
          eq(tasksTable.status, 'ready'),
          eq(tasksTable.status, 'todo'),
          eq(tasksTable.status, 'backlog'),
          eq(tasksTable.status, 'open'),
        ]),
        eq(tasksTable.projectId, dist.projectId), // same project only
      ),
    );

  // If any deps exist and any are not done/completed, return true (incomplete dependency).
  return candidates.some((c) => c.status !== 'done' && c.status !== 'completed');
}

/**
 * Record a claim (informational only; full lock via infra config later).
 *
 * @param db Database connection
 * @param taskId Task ID
 * @param tenantId Tenant ID
 * @param projectId Project ID
 * @param agentKind Type of agent/clerk ('agent' | 'human' | other)
 * @param agentRef Identification of the claimer
 * @param ttlMs Claim TTL (unused for now; reserved for future lock implementation)
 */
export async function claimTask(
  db: Db,
  taskId: number,
  tenantId: number,
  projectId: number,
  agentKind: string,
  agentRef: string,
  ttlMs: number = CLAIM_TTL_MS,
): Promise<{ ok: true; taskId: number; claimed: boolean; claimer: string; ttlMs: number } | { ok: false; error: string }> {
  // Validate inputs
  if (taskId <= 0 || !agentRef?.trim()) {
    return {
      ok: false,
      error: 'Invalid taskId or agentRef',
    };
  }

  // If taskClaimLocks exists in the DB, we would insert/update a lock entry here.
  // For now, claimTask is informational-only: we don't mutate any state,
  // so we don't need to hit the DB at all.
  return {
    ok: true,
    taskId,
    claimed: true,
    claimer: agentRef,
    ttlMs,
  };
}

/**
 * Strip non-payload fields (including pi: pickable, claimer) for public output.
 */
function toPublicPickableTask(t: Omit<PickDependencyInfo, 'pickable' | 'claimer'>): PickableTask {
  return {
    taskId: t.taskId,
    title: t.title,
    description: t.description || '',
    shortDescription: t.description ? t.description.slice(0, 100) : '(empty)',
    status: t.status,
    projectId: t.projectId,
    projectKey: t.projectKey,
    dependencies: t.dependencies || [],
    hasDependencies: t.hasDependencies || false,
    assignee: null, // always null for pickable tasks, as we filter out assigned ones
    assigneeType: 'unassigned',
    claimer: null,
    claimTtlMs: 0,
    unclaimed: true,
    confidence: PickabilityConfidence.HIGH,
  };
}

// -------------------------------------------------------------------
// Helpers for JSON and Markdown outputs
// -------------------------------------------------------------------

function mkPickableJSON(out: PickableTasksOutput): PickableTasksMarkdownOutput {
  const { tasks } = out;
  return {
    ok: true,
    markdown: mkPickableRow(out),
    total: out.total,
    highConfidence: out.highConfidence,
    mediumConfidence: out.mediumConfidence,
    lowConfidence: out.lowConfidence,
  };
}

/**
 * Build a Markdown table string for human consumption.
 */
function mkPickableRow(out: PickableTasksOutput): string {
  const { tasks, total, highConfidence, mediumConfidence, lowConfidence } = out;

  let lines = [];
  lines.push('## Pickable Tasks');
  lines.push(`**Total:** ${total} (high: ${highConfidence}, medium: ${mediumConfidence}, low: ${lowConfidence})`);
  lines.push('');

  // Headers
  lines.push('| Task ID | Title | Status | Description Summary | Dependencies | Assignee | Confidence |');
  lines.push('|---|---|---|---|---|---|---|');

  // Rows (use first 1000 to avoid excessive rendering)
  const maxRows = Math.min(tasks.length, 1000);
  tasks.slice(0, maxRows).forEach((t) => {
    const shortDesc = t.description ? t.description.slice(0, 120) : '(no description)';
    const depSummary = t.hasDependencies ? `<${t.dependencies?.length || 0} missing deps>` : 'None';
    lines.push(
      `| ${t.taskId} | ${t.title?.slice(0, 100) || ''} | ${t.status} | ${shortDesc} | ${depSummary} | (unassigned) | ${t.confidence} |`,
    );
  });

  if (tasks.length > maxRows) {
    lines.push(`\n*Showing first ${maxRows} rows (total: ${total})*`);
  }

  return lines.join('\n');
}