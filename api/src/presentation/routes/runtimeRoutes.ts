import { Hono } from 'hono';
import type { Context } from 'hono';
import { neon } from '@neondatabase/serverless';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { commitPrdAsPendingChange } from '../../application/repos/commitPrdToRepo';
import { resolveTicketRepoContext, commitAgentFile, deleteAgentFile, type TicketRepoContext } from '../../application/repos/commitFileAsPendingChange';
import { createPullRequest } from '../../application/repos/createPullRequest';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from '../../application/repos/mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from '../../application/repos/recordPullRequestRow';
import { readRepoFile, listRepoFiles, searchRepoCode, listBranchDiff } from '../../application/repos/readRepoContents';
import { verifyWrittenFiles } from '../../application/repos/verifyWrittenFiles';
import { scanWrittenForPlaceholders } from '../../application/repos/scanForPlaceholders';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { RuntimeService } from '../../application/runtime/RuntimeService';
import { resolveCloudSurface } from '../../application/runtime/cloudDispatch';
import { mintContainerRunToken, verifyContainerRunToken } from '../../application/runtime/containerRunToken';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { loadCapabilityContext } from '../../application/artifact/capabilityContext';
import { llmProxyForPlan, pickCloudModel, type ChatMessage, type EffectivePlan } from '../../application/llm/LlmProxyService';
import { resolveTenantPlan } from './llmRoutes';
import { recordUsageRow } from '../../application/llm/usageLedger';
import { ensureTaskPrdRecord, appendTaskPrdRevision } from '../../application/prd/taskPrd';
import { enqueueExecutionMessage, pullPendingSteering, listExecutionMessages, releasePendingSteers } from '../../application/runtime/executionSteering';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, projectInsightEvents, projectRepositories, projects, specs, tasks, toolAuditEvents, usageSnapshots } from '../../infrastructure/database/schema';
import { approvals } from '../../infrastructure/database/schema';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';

/**
 * Runtime routes – task execution lifecycle.
 *
 * POST   /api/runtime/executions             – submit a task for execution
 * GET    /api/runtime/executions             – list executions (tenant-wide or filtered by sessionId)
 * GET    /api/runtime/sessions/:sessionId/executions – full execution timeline for a session
 * GET    /api/runtime/executions/:id         – get execution state
 * POST   /api/runtime/executions/:id/cancel  – cancel an execution
 * PATCH  /api/runtime/executions/:id/state   – agent callback: update state
 * GET    /api/runtime/tasks/:taskId/executions – history for a task
 * GET    /api/runtime/agents/:ref/tool-audit  – tool-audit timeline for one cloud agent
 */
type RuntimeHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    AGENT_HOST_RELAY: DurableObjectNamespace<AgentHostRelayDO>;
  };
};

type DispatchMessage = {
  type: 'task.assign' | 'task.broadcast';
  executionId: number;
  taskId: number;
  payload?: string;
  /** Agent runtime engine resolved from the run-target cloud agent (default v1). */
  engine?: string;
  /** Human label of the executing cloud agent (change traceability). */
  agentLabel?: string;
  /** Repo bound to the task's project, for cloning into the ticket workspace. */
  repo?: { repoId: string; defaultBranch: string | null };
  task: {
    title: string;
    description?: string | null;
  };
  artifacts?: ResolvedArtifacts;
};

type ExecutionTaskRow = {
  id: number;
  title: string;
  description: string | null;
  assignedAgentHostId: number | null;
  /** ide_agents.id of the cloud agent assigned to this ticket (the swimlane's
   *  agent). The authoritative cloud-agent identity for an "Auto" run when the
   *  caller doesn't pin one in the payload. */
  assignedAgentRef: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId: number;
};

type ExecutionApprovalGateResult =
  | { allowed: true }
  | {
      allowed: false;
      approvalId: string;
      status: 'pending';
      reason: string;
    };

type ExecutionTelemetryBody = {
  inputTokens?: number;
  outputTokens?: number;
  contextTokens?: number;
  contextWindowMax?: number;
  compactionCount?: number;
  ts?: string;
};

type ExecutionSubscriberEvent =
  | {
      type: 'status_change' | 'done';
      executionId: number;
      status: string;
      execution: unknown;
      ts: string;
    }
  | {
      /** A user direction sent to a running execution, or an assistant text delta. */
      type: 'message';
      executionId: number;
      role: 'user' | 'assistant';
      text: string;
      ts: string;
    }
  | {
      /** A file the agent created / modified / deleted during the run. */
      type: 'file_change';
      executionId: number;
      path: string;
      change: 'created' | 'modified' | 'deleted';
      ts: string;
    };

const executionSubscribers = new Map<number, Set<WebSocket>>();

function subscribeExecution(executionId: number, socket: WebSocket): void {
  const set = executionSubscribers.get(executionId) ?? new Set<WebSocket>();
  set.add(socket);
  executionSubscribers.set(executionId, set);
}

function unsubscribeExecution(executionId: number, socket: WebSocket): void {
  const set = executionSubscribers.get(executionId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) executionSubscribers.delete(executionId);
}

function notifyExecutionSubscribers(executionId: number, event: ExecutionSubscriberEvent): void {
  const set = executionSubscribers.get(executionId);
  if (!set || set.size === 0) return;

  const payload = JSON.stringify(event);
  for (const socket of set) {
    try {
      socket.send(payload);
    } catch {
      // ignore broken sockets; close handlers clean up subscriptions.
    }
  }
}

function parseOptionalNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseApprovalTaskId(metadata: string | null): number | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { taskId?: unknown };
    const value = parsed.taskId;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  } catch {
    return null;
  }
}

function requiresTaskExecutionApproval(task: ExecutionTaskRow): boolean {
  return task.priority === 'high' || task.priority === 'urgent';
}

async function evaluateExecutionApprovalGate(
  db: Db,
  tenantId: number,
  requestedBy: string,
  task: ExecutionTaskRow,
  requestedAgentHostId: number | null,
): Promise<ExecutionApprovalGateResult> {
  if (!requiresTaskExecutionApproval(task)) {
    return { allowed: true };
  }

  const now = new Date();
  const recentApprovals = await db
    .select({
      id: approvals.id,
      status: approvals.status,
      metadata: approvals.metadata,
      expiresAt: approvals.expiresAt,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(
      and(
        eq(approvals.tenantId, tenantId),
        eq(approvals.actionType, 'task.execution'),
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(100);

  const latestForTask = recentApprovals.find((row) => parseApprovalTaskId(row.metadata) === task.id);
  if (latestForTask) {
    if (latestForTask.status === 'approved' && (!latestForTask.expiresAt || latestForTask.expiresAt > now)) {
      return { allowed: true };
    }
    if (latestForTask.status === 'pending' && (!latestForTask.expiresAt || latestForTask.expiresAt > now)) {
      return {
        allowed: false,
        approvalId: latestForTask.id,
        status: 'pending',
        reason: 'Task execution is waiting for manager approval.',
      };
    }
  }

  const approvalId = crypto.randomUUID();
  await db.insert(approvals).values({
    id: approvalId,
    tenantId,
    agentHostId: task.assignedAgentHostId ?? requestedAgentHostId,
    requestedBy,
    actionType: 'task.execution',
    description: `Approve execution of task #${task.id}: ${task.title}`,
    metadata: JSON.stringify({
      taskId: task.id,
      priority: task.priority,
    }),
    createdAt: now,
    updatedAt: now,
  });

  return {
    allowed: false,
    approvalId,
    status: 'pending',
    reason: 'Task priority requires manager approval before execution.',
  };
}

function normalizeCodeChanges(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return null;
}

function extractCodeChangesFromResult(result?: string): number | null {
  if (!result?.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }

  const queue: unknown[] = [parsed];
  const visited = new Set<unknown>();
  const keys = [
    'codeChanges',
    'code_changes',
    'linesChanged',
    'lines_changed',
    'changedLines',
    'totalChangedLines',
    'total_changed_lines',
  ] as const;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of keys) {
      const direct = normalizeCodeChanges(record[key]);
      if (direct != null) return direct;
    }

    const insertions = normalizeCodeChanges(record.insertions ?? record.additions ?? record.addedLines ?? record.added_lines);
    const deletions = normalizeCodeChanges(record.deletions ?? record.removals ?? record.deletedLines ?? record.deleted_lines);
    if (insertions != null || deletions != null) {
      return (insertions ?? 0) + (deletions ?? 0);
    }

    for (const value of Object.values(record)) queue.push(value);
  }

  return null;
}

async function dispatchToAgentHost(env: RuntimeHonoEnv['Bindings'], agentHostId: number, message: DispatchMessage): Promise<boolean> {
  if (!env.AGENT_HOST_RELAY) return false;
  const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
  const response = await stub.fetch('https://relay.internal/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  return response.ok;
}

/**
 * Run an execution server-side via the gateway when NO online agentHost took the
 * dispatch (Auto / cloud agent with no self-hosted runtime). The task is run as a
 * single gateway completion using the chosen model (the cloud agent's, or the
 * default), so a cloud/auto run produces a deliverable instead of hanging in
 * `pending` forever. Coding tasks that need a real repo/runtime still belong on
 * an agentHost — this is the fallback so non-host runs complete. Never throws.
 */
/** Load the project's governance rules + architecture spec (the non-PRD context
 *  the deliverable must honor). Best-effort: '' on any miss. */
async function loadGovernanceContext(db: Db, tenantId: number, projectId: number): Promise<string> {
  const parts: string[] = [];
  try {
    const [spec] = await db
      .select({ archSpec: specs.archSpec })
      .from(specs)
      .where(and(eq(specs.tenantId, tenantId), eq(specs.projectId, projectId)))
      .orderBy(desc(specs.updatedAt))
      .limit(1);
    if (spec?.archSpec?.trim()) parts.push(`## Architecture Spec\n\n${spec.archSpec.trim()}`);
  } catch { /* skip */ }
  try {
    const [proj] = await db
      .select({ governance: projects.governance })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (proj?.governance?.trim()) parts.push(`## Project Rules / Governance (must be followed)\n\n${proj.governance.trim()}`);
  } catch { /* skip */ }
  return parts.join('\n\n');
}

/**
 * PRD-first step of the standard flow: ensure the project has a PRD for this
 * work. If one already exists it's reused; otherwise a WIP PRD is generated from
 * the task, **persisted to `specs`** (so it appears in the PRD tab and is
 * associated with the project) and surfaced as the first "file change" (PRD.md).
 * Returns the PRD markdown, or '' if generation failed. Never throws.
 *
 * NOTE: cloning the repo + analyzing the code before drafting (and writing
 * `PRD.md` into the actual repo) requires a connected runtime — see gap register.
 * Here we persist to the canonical PRD store the PRD tab reads.
 */
/** Record a durable, agent-attributed file change for the task's Changes tab. */
async function recordTaskFileChange(
  env: Env,
  tenantId: number,
  taskId: number,
  executionId: number,
  path: string,
  change: 'created' | 'modified' | 'deleted',
  agent: string,
): Promise<void> {
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    await sql`
      INSERT INTO task_file_changes (tenant_id, task_id, execution_id, path, change, agent)
      VALUES (${tenantId}, ${taskId}, ${executionId}, ${path}, ${change}, ${agent})
    `;
  } catch { /* best-effort */ }
}

/** Resolve the credential secret for git operations (mirrors agentHost routes). */
function gitSecret(env: Env): string {
  return (env as { INTEGRATION_ENCRYPTION_SECRET?: string }).INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
}

/**
 * The repo the agent will actually run against, surfaced up-front so a WRONG or
 * EMPTY binding is visible BEFORE the model spends a single LLM call. Bundles:
 *   • the bound repo's identity (or why none is bound),
 *   • a compact top-level listing of the base branch + total file count — the
 *     "is this the right repo?" signal (exec #54 returned a conceptual non-answer
 *     because the agent was never shown the repo only contained `agent-runtime`),
 *   • what a PRIOR pass committed to this task's branch (so a re-run reconciles
 *     and cleans up dead files rather than blindly appending).
 *
 * Resolves the ticket repo ONCE (was a separate call per concern). The base-branch
 * tree is slow-changing and re-read on every re-run of the same task, so it is
 * served through the read-through cache keyed by repo+base. Best-effort: any miss
 * yields an empty workspace (never throws — context prep must not fail on this).
 */
interface WorkspaceContext {
  /** Bound repo identity, or null when no usable repo is bound. */
  repo: { owner: string; repo: string; provider: string; base: string } | null;
  /** Why no repo (when `repo` is null) — surfaced to the agent + the timeline. */
  reason?: string;
  /** Top-level entries (dirs as `name/`, root files as `name`) on the base branch. */
  topLevel: string[];
  /** Total blob count on the base branch (capped by the tree lister). */
  fileCount: number;
  truncated: boolean;
  /** Files a prior pass already committed to this task's branch. */
  priorChanges: Array<{ path: string; status: string }>;
}

async function loadWorkspaceContext(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
): Promise<WorkspaceContext> {
  const empty: WorkspaceContext = { repo: null, topLevel: [], fileCount: 0, truncated: false, priorChanges: [] };
  try {
    const resolved = await resolveTicketRepoContext(db, secret, tenantId, taskId);
    if (!resolved.ok) return { ...empty, reason: resolved.reason };
    const { ctx } = resolved;
    const readCtx = { provider: ctx.provider, host: ctx.host, owner: ctx.owner, repo: ctx.repo, token: ctx.token, ref: ctx.base };

    const [listing, diff] = await Promise.all([
      getOrSetCached(
        env,
        `repo-tree:${ctx.repoId}:${ctx.base}`,
        () => listRepoFiles(readCtx),
        { kvTtlSeconds: 120, l1TtlMs: 30_000 },
      ),
      listBranchDiff({ ...readCtx, ref: ctx.branch }, ctx.base, ctx.branch),
    ]);

    let topLevel: string[] = [];
    let fileCount = 0;
    let truncated = false;
    if (listing.ok) {
      fileCount = listing.paths.length;
      truncated = listing.truncated;
      topLevel = [...new Set(listing.paths.map((p) => {
        const i = p.indexOf('/');
        return i === -1 ? p : `${p.slice(0, i)}/`;
      }))].sort().slice(0, 40);
    }

    return {
      repo: { owner: ctx.owner, repo: ctx.repo, provider: ctx.provider, base: ctx.base },
      topLevel,
      fileCount,
      truncated,
      priorChanges: diff.ok ? diff.files : [],
    };
  } catch {
    return empty;
  }
}

/**
 * Task-scoped PRD. Each TASK has its own PRD (via the `task_specs` link), drafted
 * with an attribution header naming the authoring agent (downstream agents append
 * their own attributed updates). The PRD is:
 *   • persisted to its task-scoped spec (PRD tab),
 *   • recorded as an agent-attributed `PRD.md` change (Changes tab),
 *   • committed to the ticket's git branch as a pending change (branch + PR),
 *     via the provider API so it works even on the cloud (no-runtime) path.
 */
async function ensureTaskPrd(
  env: Env,
  db: Db,
  executionId: number,
  taskRow: { title: string; description: string | null },
  tenantId: number,
  projectId: number,
  taskId: number,
  agentLabel: string,
  model: string | undefined,
): Promise<string> {
  // Shared generate→persist→link core (reused by the on-demand endpoint + swimlane gate).
  const ensured = await ensureTaskPrdRecord(db, env, { taskId, tenantId, projectId, title: taskRow.title, description: taskRow.description, agentLabel, model });
  if (!ensured) return '';
  const { prd, status } = ensured;
  if (status === 'reused') return prd; // already had a PRD — no new commit/notification

  await landPrdChange(env, db, {
    executionId, tenantId, taskId, taskTitle: taskRow.title, prd, agentLabel,
    isUpdate: status === 'updated',
    message: (branch) => branch
      ? `📝 ${agentLabel} drafted the PRD and committed it to branch \`${branch}\` (pending change — included in this task's single PR). See the PRD tab + Changes.`
      : `📝 ${agentLabel} drafted the PRD (saved to the PRD tab).`,
  });
  return prd;
}

/**
 * Land a PRD body change as a pending change on the ticket branch: record the
 * attributed PRD.md file change, commit it to the SAME branch the agent's code
 * commits to (single run PR covers it), surface the branch on the ticket, and
 * notify the execution stream. The single PRD-commit path — shared by the
 * first-draft ({@link ensureTaskPrd}) and per-run directive ({@link recordPrdDirective})
 * write-backs so commit/record/notify is never duplicated. Best-effort throughout.
 */
async function landPrdChange(
  env: Env,
  db: Db,
  args: {
    executionId: number;
    tenantId: number;
    taskId: number;
    taskTitle: string;
    prd: string;
    agentLabel: string;
    isUpdate: boolean;
    message: (branch: string | null) => string;
  },
): Promise<void> {
  const fileChange = args.isUpdate ? 'modified' : 'created';
  await recordTaskFileChange(env, args.tenantId, args.taskId, args.executionId, 'PRD.md', fileChange, args.agentLabel);

  const committed = await commitPrdAsPendingChange(db, gitSecret(env), args.tenantId, args.taskId, args.taskTitle, args.prd, args.agentLabel);
  if (committed.ok) {
    await db.update(tasks)
      .set({ gitBranch: committed.branch, updatedAt: new Date() })
      .where(eq(tasks.id, args.taskId))
      .catch(() => { /* best-effort */ });
  }

  notifyExecutionSubscribers(args.executionId, {
    type: 'file_change', executionId: args.executionId, path: 'PRD.md', change: fileChange, ts: new Date().toISOString(),
  });
  notifyExecutionSubscribers(args.executionId, {
    type: 'message', executionId: args.executionId, role: 'assistant',
    text: args.message(committed.ok ? committed.branch : null),
    ts: new Date().toISOString(),
  });
}

/**
 * Per-run PRD write-back: record a user directive (a steer to a running run, or a
 * follow-up that starts a new run) as a dated, signed revision on the task's PRD,
 * then land it on the ticket branch. This is what makes the PRD "update per run"
 * instead of being frozen at first draft. Best-effort — never blocks the steer/run.
 */
async function recordPrdDirective(
  env: Env,
  db: Db,
  args: { executionId: number; tenantId: number; projectId: number; taskId: number; taskTitle: string; agentLabel: string; directive: string },
): Promise<void> {
  const revised = await appendTaskPrdRevision(db, {
    taskId: args.taskId, tenantId: args.tenantId, projectId: args.projectId,
    agentLabel: args.agentLabel, directive: args.directive, executionId: args.executionId,
    isoTimestamp: new Date().toISOString(),
  });
  if (!revised) return;
  await landPrdChange(env, db, {
    executionId: args.executionId, tenantId: args.tenantId, taskId: args.taskId, taskTitle: args.taskTitle,
    prd: revised.prd, agentLabel: args.agentLabel, isUpdate: true,
    message: (branch) => branch
      ? `📝 ${args.agentLabel} recorded your direction in the PRD and committed the revision to branch \`${branch}\`. See the PRD tab + Changes.`
      : `📝 ${args.agentLabel} recorded your direction as a PRD revision (saved to the PRD tab).`,
  });
}

/**
 * Record one cloud-agent tool-audit event so cloud runs are observable on the
 * Timeline exactly like self-hosted agents (which push tool-audit via the relay).
 * Cloud runs have no agent_host_id / live session, so rows are keyed by the cloud
 * agent ref + execution id (migration 0092). Best-effort — never throws.
 */
async function recordCloudToolEvent(
  db: Db,
  args: {
    tenantId: number;
    cloudAgentRef?: string;
    executionId: number;
    toolName: string;
    category: string;
    toolCallId?: string;
    detail?: unknown;
    result?: string;
    durationMs?: number;
  },
): Promise<void> {
  try {
    await db.insert(toolAuditEvents).values({
      tenantId:     args.tenantId,
      agentHostId:  null,
      cloudAgentRef: args.cloudAgentRef ?? null,
      executionId:  args.executionId,
      sessionKey:   `exec:${args.executionId}`,
      toolCallId:   args.toolCallId ?? null,
      toolName:     args.toolName,
      category:     args.category,
      args:         args.detail != null ? JSON.stringify(args.detail) : null,
      result:       args.result ?? null,
      durationMs:   args.durationMs ?? null,
      ts:           new Date(),
    });
  } catch { /* telemetry is best-effort — never break the run */ }
}

/**
 * Record cloud-agent token usage for the run. Writes to BOTH ledgers so the two
 * views reconcile (previously cloud usage only hit usage_snapshots and was
 * invisible to the billing/cost log):
 *   • usage_snapshots — the per-execution trace view (context/compaction columns).
 *   • llm_usage_log   — the canonical usage/billing ledger, tagged with the cloud
 *     dimensions (cloud_agent_ref + execution_id) so cost can be split by
 *     cloud-vs-on-prem (migration 0096). Shared insert with the gateway path via
 *     recordUsageRow.
 * Best-effort — never throws.
 */
async function recordCloudUsage(
  env: Env,
  db: Db,
  args: { tenantId: number; cloudAgentRef?: string; executionId: number; taskId: number; projectId?: number | null; model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  try {
    await db.insert(usageSnapshots).values({
      tenantId:      args.tenantId,
      agentHostId:   null,
      cloudAgentRef: args.cloudAgentRef ?? null,
      executionId:   args.executionId,
      sessionKey:    `exec:${args.executionId}`,
      inputTokens:   args.inputTokens,
      outputTokens:  args.outputTokens,
      contextTokens: args.inputTokens + args.outputTokens,
    });
  } catch { /* best-effort */ }
  await recordUsageRow(db, env, {
    tenantId:   args.tenantId,
    userId:     null,
    llmProduct: 'builderforceLLM',
    model:      args.model,
    usage:      { promptTokens: args.inputTokens, completionTokens: args.outputTokens, totalTokens: args.inputTokens + args.outputTokens },
    metadata:   { engine: 'cloud', executionId: args.executionId, taskId: args.taskId, projectId: args.projectId ?? null },
    useCase:    'task_execution',
    // Attribute the spend to the run's cloud agent + ticket + project so cost
    // rolls up ticket → project → account (0104 / 0103).
    attribution: { cloudAgentRef: args.cloudAgentRef ?? null, executionId: args.executionId, taskId: args.taskId, projectId: args.projectId ?? null },
  });
}

/** Synthetic cloud-agent ref for runs dispatched to the gateway default (no named
 *  cloud agent) — so their telemetry is still attributable to a chip on the
 *  Observability timeline. Shared with the frontend via the cloud-agents list. */
const DEFAULT_CLOUD_REF = '__default__';

/** True when a finish summary claims a build / type-check / lint / test passed —
 *  which the serverless cloud executor cannot have run (it has no shell). Used to
 *  block a fabricated "checks pass" claim once and force an honest summary. Kept
 *  deliberately narrow (a check noun AND a success verb) to avoid false positives
 *  on legitimate descriptions of the work. */
export function assertsUnrunVerification(summary: string): boolean {
  const s = summary.toLowerCase();
  const check = /(type[\s-]?check|typecheck|typescript|\btsc\b|lint|eslint|\btest(s|ing|ed)?\b|\bbuild(s|ing)?\b|compil)/;
  const pass = /(pass(es|ed|ing)?|succeed(s|ed)?|success|green|no\s+errors?|error[\s-]?free|will\s+now\s+pass|are\s+resolved|is\s+resolved)/;
  return check.test(s) && pass.test(s);
}

/** Shape of one tool call in an OpenAI-compatible completion response. */
interface RawToolCall { id?: string; type?: string; function?: { name?: string; arguments?: string } }

/**
 * Tools the cloud (Worker) agent loop can actually execute. The Worker has no
 * filesystem/shell, so the toolset is provider-API-backed: `write_file` lands a
 * file on the ticket branch as a pending change; `finish` ends the run. Both V1
 * and V2 cloud runs use this same loop so they genuinely *execute tools* (not a
 * single completion) and every call is recorded to the Observability timeline.
 */
const CLOUD_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass a subdirectory to scope the listing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search the ENTIRE repo for a string/symbol in one call (indexed code search) — use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. 0 results means the term does not appear in the indexed codebase (so "remove all references to X" with 0 results means there is nothing to remove — say so, do not invent a change). Recently-pushed code may lag the index; confirm a specific file with read_file. Then read_file the matches you intend to edit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact text or symbol to find, e.g. a model id, function name, import path, or config key.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the FULL current contents of a repo file on the ticket branch. Always read a file before editing it so you preserve existing code and only change what is needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path, e.g. "src/feature.ts".' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or update a file on the ticket branch as a reviewable pending change (a PR is opened/updated for the run). Use once per deliverable file. Provide the FULL file content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path, e.g. "src/feature.ts".' },
          content: { type: 'string', description: 'Complete file content (no placeholders).' },
          summary: { type: 'string', description: 'One-line description of the change.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left — reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
          reason: { type: 'string', description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_checks',
      description: 'Statically validate the files you have written: it parses your committed JSON and YAML config files in-place and reports any syntax errors to fix BEFORE finishing. IMPORTANT: this serverless executor has NO shell, so it does NOT run the build, project-wide type-check, lint, or tests — those run in CI on the pull request your changes open (the source of truth). Call this after writing config files. Never claim the build/type-check/lint/tests passed — you cannot run those here; only the JSON/YAML syntax check is real.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call ONLY when the task is fully complete — every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed — you cannot run those here (CI on the PR verifies).',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'What was delivered.' } },
        required: ['summary'],
      },
    },
  },
] as const;

// Read→edit→write workflows on a multi-file task need many turns: explore the
// repo, read several files, then write each change — 10 was too few (a real run
// burned all 10 just exploring and shipped a PRD-only PR). The durable (DO)
// surface runs ONE step per alarm tick and heartbeats `executions.updated_at`
// every tick, so the orphan reaper measures liveness from the heartbeat, not the
// total step count — a long, healthy run never trips it. 30 gives room to finish
// real edits (the long-lived Container surface allows 40).
const MAX_CLOUD_TOOL_STEPS = 30;

// Anti-stub finish gate: how many times a single synchronous loop invocation will
// block a finish that still ships placeholder/stub code before letting the PR open
// anyway (human-reviewed, annotated unverified). The durable surface resets this
// per tick, so there it is effectively block-until-clean, bounded by the step cap.
const MAX_PLACEHOLDER_FINISH_BLOCKS = 2;

// The Container surface is a long-lived process (not a per-tick DO), and its
// real-shell build/verify loop legitimately needs more turns than the durable
// surface. The container heartbeats `executions.updated_at` on every LLM step so a
// healthy long run never trips the orphan reaper.
const CONTAINER_MAX_STEPS = 40;

/**
 * Toolset for the long-lived Container executor (the `container` runtime surface).
 * Same file tools as the durable loop, but `run_checks` (a no-op confessing "no
 * shell") is replaced by a REAL `run_command` — the Container's whole reason to
 * exist. list_files/read_file run against the container's local clone; write_file
 * mirrors to the ticket branch via the container-op endpoint; run_command runs in
 * the container's shell. The container drives this loop in its own process and
 * sends each assistant turn to the `llm` op (which calls the gateway with THIS
 * toolset), so the schema lives in one place.
 */
/** Pick a CLOUD_AGENT_TOOLS entry by name — name-based (not index) so adding a
 *  tool to the durable set can't silently re-map the container's toolset. */
const cloudTool = (name: string) => {
  const t = CLOUD_AGENT_TOOLS.find((x) => x.function.name === name);
  if (!t) throw new Error(`cloud tool '${name}' not found`);
  return t;
};
const CONTAINER_AGENT_TOOLS = [
  cloudTool('list_files'),
  // No search_code here: the container has a real shell, so it greps via
  // run_command natively (and only the Worker handler implements search_code).
  cloudTool('read_file'),
  cloudTool('write_file'),
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run, e.g. "npm install" or "npm test".' },
        },
        required: ['command'],
      },
    },
  },
  cloudTool('finish'),
] as const;

/** A cloud run's LLM routing — which model pool / vendor key its tenant's plan
 *  unlocks. Resolved once per run and reused, never recomputed per turn. */
export type CloudRouting = { effectivePlan: EffectivePlan; premiumOverride: boolean };

/** Resolve a tenant's cloud LLM routing, degrading to the free plan if the plan
 *  lookup throws — a background cloud run must never hard-fail on plan I/O. */
async function resolveCloudRouting(env: Env, tenantId: number): Promise<CloudRouting> {
  try {
    const r = await resolveTenantPlan(env, tenantId);
    return { effectivePlan: r.effectivePlan, premiumOverride: r.premiumOverride };
  } catch {
    return { effectivePlan: 'free', premiumOverride: false };
  }
}

/** Resolved per-run context for a container-op call, derived authoritatively from
 *  the execution id (the container never asserts its own tenant/task). */
interface ContainerRunContext {
  tenantId: number;
  taskId: number;
  projectId: number;
  taskTitle: string;
  taskDescription: string | null;
  cloudAgentRef?: string;
  agentLabel: string;
  model?: string;
  /** The tenant's LLM routing, resolved once at context build (and cached with it)
   *  so per-op `llm` calls pick the plan's pool/key without a per-call plan query. */
  effectivePlan: EffectivePlan;
  premiumOverride: boolean;
}

/** Load (and briefly cache) the container-run context for an execution. No secret
 *  is in this object, so it is safe to cache in the shared read-through cache. */
async function loadContainerRunContext(env: Env, db: Db, executionId: number): Promise<ContainerRunContext | null> {
  return getOrSetCached(env, `containerctx:${executionId}`, async () => {
    const [exec] = await db
      .select({ taskId: executions.taskId, tenantId: executions.tenantId, payload: executions.payload })
      .from(executions).where(eq(executions.id, executionId)).limit(1);
    if (!exec) return null;
    const [task] = await db
      .select({ title: tasks.title, description: tasks.description, projectId: tasks.projectId, assignedAgentRef: tasks.assignedAgentRef })
      .from(tasks).where(eq(tasks.id, exec.taskId)).limit(1);
    if (!task) return null;
    const ref = parseCloudAgentRef(exec.payload ?? undefined) ?? task.assignedAgentRef ?? undefined;
    const agent = await resolveCloudAgent(env, exec.tenantId, ref);
    let payloadModel: string | undefined;
    try {
      const p = exec.payload ? (JSON.parse(exec.payload) as { model?: unknown }) : null;
      if (p && typeof p.model === 'string' && p.model.trim()) payloadModel = p.model.trim();
    } catch { /* default model */ }
    const routing = await resolveCloudRouting(env, exec.tenantId);
    return {
      tenantId: exec.tenantId, taskId: exec.taskId, projectId: task.projectId,
      taskTitle: task.title, taskDescription: task.description,
      cloudAgentRef: agent.ref, agentLabel: agent.label ?? 'BuilderForce Agent',
      model: payloadModel ?? agent.baseModel,
      effectivePlan: routing.effectivePlan, premiumOverride: routing.premiumOverride,
    };
  }, { kvTtlSeconds: 600, l1TtlMs: 600_000 });
}

/** True when the execution has been flipped to CANCELLED from another isolate. */
async function isExecutionCancelled(db: Db, executionId: number): Promise<boolean> {
  try {
    const [row] = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, executionId)).limit(1);
    return row?.status === 'cancelled';
  } catch { return false; }
}

/**
 * Handle one container-op call from the long-lived Container executor. The container
 * runs the agent loop in its own process and delegates to the Worker for everything
 * that must stay server-side: the gateway LLM step (`llm`), per-file commit to the
 * ticket branch (`write`), arbitrary telemetry (`event`), the PR finalize
 * (`finalize`), and a cheap cancel poll (`status`). Reuses the exact same helpers as
 * the in-Worker loop, so there is ONE implementation of metering, commit, and
 * finalize. Authenticated by the per-run token (already verified by the caller).
 */
async function handleContainerOp(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  ctx: ContainerRunContext,
  executionId: number,
  op: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const { tenantId, taskId, projectId, cloudAgentRef, agentLabel, model } = ctx;
  const taskRow = { id: taskId, title: ctx.taskTitle, description: ctx.taskDescription };

  if (op === 'status') {
    return { status: 200, body: { cancelled: await isExecutionCancelled(db, executionId) } };
  }

  if (op === 'event') {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: String(args.toolName ?? 'tool'), category: String(args.category ?? 'tool'),
      toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : undefined,
      detail: args.detail, result: typeof args.result === 'string' ? args.result : undefined,
      durationMs: typeof args.durationMs === 'number' ? args.durationMs : undefined,
    });
    return { status: 200, body: { ok: true } };
  }

  if (op === 'llm') {
    const messages = Array.isArray(args.messages) ? (args.messages as unknown as Array<Record<string, unknown>>) : ([] as Array<Record<string, unknown>>);
    // Mid-run steering for the long-lived container: drain user follow-ups posted
    // since the last step and INJECT them into this turn's messages server-side, so
    // the steer reaches the model immediately — even on a container image that
    // predates steering support (no redeploy required). They are also returned in
    // `steering` so a steering-aware container persists them into its own loop state
    // for subsequent turns; the injection here is deduped by text so that does not
    // double them. Each steer is drained exactly once (consumed_at stamped).
    const steering = await pullPendingSteering(db, executionId);
    if (steering.length > 0) {
      const present = new Set(messages.filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content as string));
      for (const steer of steering) {
        if (!present.has(steer)) messages.push({ role: 'user', content: steer });
        await recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName: 'steer.applied', category: 'message', detail: { text: steer }, result: steer.slice(0, 280) });
        notifyExecutionSubscribers(executionId, { type: 'message', executionId, role: 'user', text: steer, ts: new Date().toISOString() });
      }
    }
    const tGen0 = Date.now();
    // Route through the tenant's plan pool/key (not the fixed free pool) and apply
    // the shared cloud model rule: explicit pick = hard pin, else the plan's best
    // coding model. The container holds its own loop state, so per-op pinning is
    // the caller's explicit `model`; the default lands on a strong coding model.
    const pick = pickCloudModel(model, ctx.effectivePlan, ctx.premiumOverride);
    const result = await llmProxyForPlan(env, ctx.effectivePlan, ctx.premiumOverride).complete({
      messages: messages as unknown as ChatMessage[], tools: CONTAINER_AGENT_TOOLS, tool_choice: 'auto',
      ...(pick.model ? { model: pick.model, ...(pick.strict ? { modelStrict: true } : {}) } : {}),
      useCase: 'task_execution',
    });
    const resolvedModel = result.resolvedModel ?? pick.model ?? 'default';
    if (result.usage) {
      await recordCloudUsage(env, db, {
        tenantId, cloudAgentRef, executionId, taskId, projectId, model: resolvedModel,
        inputTokens: result.usage.promptTokens ?? 0, outputTokens: result.usage.completionTokens ?? 0,
      });
    }
    // Heartbeat: a live container keeps the run out of the orphan reaper.
    await db.update(executions).set({ updatedAt: new Date() }).where(eq(executions.id, executionId)).catch(() => { /* best-effort */ });
    if (result.response.status >= 400) {
      const text = await result.response.text().catch(() => '');
      await recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName: 'llm.complete', category: 'llm', detail: { model: resolvedModel, status: result.response.status }, result: `gateway ${result.response.status}`, durationMs: Date.now() - tGen0 });
      return { status: 200, body: { error: `Gateway ${result.response.status}: ${text.slice(0, 300)}` } };
    }
    const json = (await result.response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> } | null;
    const choice = json?.choices?.[0]?.message;
    const content = typeof choice?.content === 'string' ? choice.content : '';
    const toolCalls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
    await recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName: 'llm.complete', category: 'llm', detail: { model: resolvedModel, traceId: result.traceId ?? null, toolCalls: toolCalls.length }, result: `${toolCalls.length} tool call(s)${content ? ` · ${content.length} chars` : ''}`, durationMs: Date.now() - tGen0 });
    if (content) {
      await recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName: 'agent.message', category: 'message', detail: { content }, result: content.slice(0, 280) });
      notifyExecutionSubscribers(executionId, { type: 'message', executionId, role: 'assistant', text: content, ts: new Date().toISOString() });
    }
    return { status: 200, body: { content, toolCalls, steering, cancelled: await isExecutionCancelled(db, executionId) } };
  }

  if (op === 'write') {
    const path = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const isNew = args.isNew !== false;
    if (!path || !content) return { status: 200, body: { ok: false, error: 'path and content are both required' } };
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    if (!repo.ok) return { status: 200, body: { ok: false, error: `no repo bound to this task (${repo.reason}); include the file contents in your final summary instead` } };
    const commit = await commitAgentFile(repo.ctx, path, content, `${isNew ? 'Add' : 'Update'} ${path} — task #${taskId} (${agentLabel})`);
    if (!commit.ok) return { status: 200, body: { ok: false, error: commit.reason } };
    // Label from whether the path actually existed in the repo (commit.existed),
    // not the caller's `isNew` hint — that defaults to true and mislabels edits as "created".
    const change = commit.existed ? 'modified' : 'created';
    await recordTaskFileChange(env, tenantId, taskId, executionId, path, change, agentLabel);
    notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change, ts: new Date().toISOString() });
    await recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName: 'write_file', category: 'tool', detail: { path, summary: args.summary }, result: `committed to ${repo.ctx.branch}` });
    return { status: 200, body: { ok: true, branch: repo.ctx.branch, commitUrl: commit.commitUrl } };
  }

  if (op === 'finalize') {
    const writtenPaths = new Set<string>(Array.isArray(args.writtenPaths) ? (args.writtenPaths as unknown[]).filter((p): p is string => typeof p === 'string') : []);
    const finalOutput = typeof args.finalOutput === 'string' ? args.finalOutput : '';
    const cancelled = args.cancelled === true || (await isExecutionCancelled(db, executionId));
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    const repoCtx = repo.ok ? repo.ctx : null;
    const fin = await finalizeCloudRun(env, db, { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, writtenPaths, finalOutput, cancelled });
    if (!cancelled) {
      await runtimeService.update(executionId, fin.ok ? { status: ExecutionStatus.COMPLETED, result: fin.output } : { status: ExecutionStatus.FAILED, errorMessage: fin.output }).catch(() => { /* terminal already */ });
      const updated = await runtimeService.getExecution(executionId).catch(() => null);
      if (updated) notifyExecutionSubscribers(executionId, { type: 'done', executionId, status: updated.status, execution: updated.toPlain(), ts: new Date().toISOString() });
    }
    return { status: 200, body: { ok: fin.ok, output: fin.output } };
  }

  return { status: 400, body: { error: `unknown op '${op}'` } };
}

/**
 * The cloud agent's tool-executing loop. Drives the gateway with the toolset
 * above, executes each requested tool, feeds results back, and repeats until the
 * model calls `finish`, stops requesting tools, or the step cap is hit. Records a
 * per-iteration `llm.complete` event, a per-call tool event, and a usage snapshot
 * — so the timeline shows real tool execution. Never throws.
 */
/** Mid-run state the durable (DO) surface persists between alarm ticks so it can
 *  resume the loop one step at a time. (The Worker surface runs the whole loop in
 *  one call and never sets this.) */
export interface CloudLoopState {
  messages: Array<Record<string, unknown>>;
  writtenPaths: string[];
  /** Next absolute step index to run. */
  step: number;
  /** Model pinned for the whole run, resolved on the first tick. Persisted so the
   *  durable (DO) surface keeps every tick on the SAME model instead of letting
   *  the gateway's round-robin cursor hop models between steps of one task. */
  pinnedModel?: string;
  /** The tenant's LLM routing, resolved on the first tick. Persisted so later DO
   *  ticks reuse it (which pool / vendor key) without re-querying the plan. */
  routing?: CloudRouting;
}
export interface CloudLoopOpts {
  /** Resume from this persisted state instead of starting fresh. */
  resume?: CloudLoopState;
  /** Max iterations to run THIS call (the DO passes 1 — one LLM step per tick). */
  maxSteps?: number;
  /** Skip the PR/merge finalize unless the run is actually finished — so the DO
   *  doesn't ship a half-done run between ticks. */
  deferFinalize?: boolean;
}
export interface CloudLoopResult {
  ok: boolean;
  output: string;
  cancelled: boolean;
  /** True when the run reached a terminal point (finished / step cap / error /
   *  cancel) — i.e. the finalize ran (or was skipped because cancelled). When
   *  false, `state` carries the resume point for the next tick. */
  finished: boolean;
  state?: CloudLoopState;
}

export async function runCloudToolLoop(
  env: Env,
  db: Db,
  executionId: number,
  tenantId: number,
  taskRow: { id: number; title: string; description: string | null },
  cloudAgentRef: string | undefined,
  agentLabel: string,
  model: string | undefined,
  systemPrompt: string,
  userContent: string,
  isCancelled: () => Promise<boolean>,
  projectId: number,
  opts?: CloudLoopOpts,
): Promise<CloudLoopResult> {
  const repoResolved = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskRow.id);
  const repoCtx: TicketRepoContext | null = repoResolved.ok ? repoResolved.ctx : null;
  const repoMiss = repoResolved.ok ? '' : repoResolved.reason;
  const writtenPaths = new Set<string>(opts?.resume?.writtenPaths ?? []);

  // The PRD (committed to the ticket branch during prep) is part of this task's
  // single PR. Seed it into writtenPaths on the first tick so the finalize opens a
  // PR — and lists PRD.md — even if the agent ends up writing zero code files. Done
  // once (resume is undefined on the first tick); thereafter it rides resume state.
  if (repoCtx && !opts?.resume) {
    const prdOnBranch = await readRepoFile({ ...repoCtx, ref: repoCtx.branch }, 'PRD.md').catch(() => null);
    if (prdOnBranch?.ok) writtenPaths.add('PRD.md');
  }

  // Resume from persisted state (DO surface) or start fresh (Worker surface).
  const messages: Array<Record<string, unknown>> = opts?.resume?.messages ?? [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
  const startStep = opts?.resume?.step ?? 0;
  const maxThisCall = opts?.maxSteps ?? MAX_CLOUD_TOOL_STEPS;

  // Resolve the tenant's plan routing once (which model pool / vendor key), then
  // dispatch through THAT plan proxy — so a Pro cloud agent reaches premium coding
  // models instead of the fixed free pool. Reused across every turn (and persisted
  // so DO ticks don't re-query the plan).
  const routing = opts?.resume?.routing ?? await resolveCloudRouting(env, tenantId);
  const proxy = llmProxyForPlan(env, routing.effectivePlan, routing.premiumOverride);

  // Per-run model pin. A coding agent must drive the WHOLE task on one model, not
  // hop between pool models per turn (the gateway's round-robin cursor would
  // otherwise pick a different model each step → inconsistent behaviour).
  //   • Explicit selection (user pick / agent base_model, when it's a real catalog
  //     id) → hard pin via `modelStrict`: the gateway dispatches ONLY that model,
  //     no silent swap.
  //   • No (or typo'd) selection → the plan's best coding model as a soft seed,
  //     then lock onto whatever the gateway resolved on the first turn (so a cold
  //     model can fail over once — but only once, at the start).
  // The resolved pin rides CloudLoopState so the DO surface keeps every tick on it.
  const pick = pickCloudModel(model, routing.effectivePlan, routing.premiumOverride);
  const strictPin = pick.strict;
  let activeModel: string = opts?.resume?.pinnedModel ?? pick.model;

  let finalOutput = '';
  let finished = false;
  let cancelled = false;
  let step = startStep;
  // Honesty gate: this executor has no shell, so it can never actually run a
  // build/type-check/test. Reject a finish that claims one passed — once — to force
  // an honest summary; the opened PR is annotated unverified regardless.
  let finishBlockedOnce = false;
  // Anti-stub gate: count finish attempts blocked because committed files still
  // contain placeholder/stub code, so the agent is forced to ship a real
  // implementation (or delete the dead file) — see MAX_PLACEHOLDER_FINISH_BLOCKS.
  let placeholderBlocks = 0;

  // Hard cancel: a background watcher polls the (cross-isolate) execution status
  // and aborts the in-flight gateway fetch the instant it sees CANCELLED, so a
  // cancel mid-completion stops token spend immediately instead of running the
  // current step to completion. The per-step check below still covers the gap
  // between steps; together they make cancel a true interrupt.
  const abortController = new AbortController();
  let watcherDone = false;
  const cancelWatcher = (async () => {
    while (!watcherDone && !abortController.signal.aborted) {
      await new Promise((r) => setTimeout(r, 2000));
      if (watcherDone) break;
      if (await isCancelled()) { abortController.abort(); cancelled = true; break; }
    }
  })();

  try {
  for (; step < MAX_CLOUD_TOOL_STEPS && !finished && (step - startStep) < maxThisCall; step++) {
    // Between-step guard: stop before issuing the next (paid) call if cancelled.
    if (cancelled || abortController.signal.aborted || await isCancelled()) { cancelled = true; break; }

    // Mid-run steering: drain any user follow-ups posted to this execution since the
    // previous step and splice them in as user turns BEFORE the next paid call, so a
    // cloud agent (V1 / V2-durable / V2-container fallback) actually changes course
    // mid-run instead of the message being a no-op. Each steer is drained once
    // (consumed_at is stamped by pullPendingSteering).
    const steers = await pullPendingSteering(db, executionId);
    for (const steer of steers) {
      messages.push({ role: 'user', content: steer });
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'steer.applied', category: 'message',
        detail: { step, text: steer },
        result: steer.slice(0, 280),
      });
      notifyExecutionSubscribers(executionId, { type: 'message', executionId, role: 'user', text: steer, ts: new Date().toISOString() });
    }

    const tGen0 = Date.now();
    let result: Awaited<ReturnType<typeof proxy.complete>>;
    try {
      result = await proxy.complete(
        {
          messages: messages as unknown as ChatMessage[],
          tools: CLOUD_AGENT_TOOLS,
          tool_choice: 'auto',
          ...(activeModel ? { model: activeModel, ...(strictPin ? { modelStrict: true } : {}) } : {}),
          useCase: 'task_execution',
        },
        undefined,
        undefined,
        abortController.signal,
      );
    } catch (e) {
      // The watcher aborted the fetch (cancel mid-call) → stop cleanly.
      if (abortController.signal.aborted) { cancelled = true; break; }
      throw e;
    }
    const genMs = Date.now() - tGen0;
    const resolvedModel = result.resolvedModel ?? activeModel ?? 'default';
    // Lock the non-strict run onto the model the gateway actually used on the
    // first turn, so every later turn (and DO tick) stays on it. Strict pins
    // already resolve to `activeModel`, so this is a no-op for them.
    if (!strictPin && result.resolvedModel) activeModel = result.resolvedModel;
    if (result.usage) {
      await recordCloudUsage(env, db, {
        tenantId, cloudAgentRef, executionId, taskId: taskRow.id, projectId, model: resolvedModel,
        inputTokens: result.usage.promptTokens ?? 0,
        outputTokens: result.usage.completionTokens ?? 0,
      });
    }
    if (result.response.status >= 400) {
      const body = await result.response.text().catch(() => '');
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'llm.complete', category: 'llm',
        detail: { model: resolvedModel, traceId: result.traceId ?? null, step },
        result: `gateway ${result.response.status}`, durationMs: genMs,
      });
      return { ok: false, output: `Gateway ${result.response.status}: ${body.slice(0, 300)}`, cancelled, finished: true };
    }

    const json = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> }
      | null;
    const choice = json?.choices?.[0]?.message;
    const content = typeof choice?.content === 'string' ? choice.content : '';
    const toolCalls = Array.isArray(choice?.tool_calls) ? (choice!.tool_calls as RawToolCall[]) : [];
    if (content) finalOutput = content;

    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'llm.complete', category: 'llm',
      detail: { model: resolvedModel, traceId: result.traceId ?? null, step, toolCalls: toolCalls.length },
      result: `${toolCalls.length} tool call(s)${content ? ` · ${content.length} chars` : ''}`,
      durationMs: genMs,
    });

    // The agent's natural-language turns are part of "what the agent did" — record
    // each as its own event so the Logs/Timeline show the actual message text, not
    // just an llm.complete counter. (Output streams the final turn separately.)
    if (content) {
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'agent.message', category: 'message',
        detail: { step, content },
        result: content.slice(0, 280),
      });
    }

    if (toolCalls.length === 0) { finished = true; break; }

    // Echo the assistant turn (with its tool_calls) so tool results attach to it.
    messages.push({ role: 'assistant', content, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name ?? 'unknown';
      let parsed: Record<string, unknown> = {};
      try { parsed = tc.function?.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {}; } catch { /* leave empty */ }
      const tStart = Date.now();
      let toolResult: Record<string, unknown>;

      // Read/list against the ticket branch only once it exists (created on the
      // first commit). Before any write, the branch ref 404s — read from `base`
      // instead, so the agent sees the real codebase rather than mistaking the
      // missing branch for "no repo access".
      const readRef = repoCtx ? (writtenPaths.size > 0 ? repoCtx.branch : repoCtx.base) : '';

      if (name === 'list_files') {
        if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss})` };
        } else {
          const sub = typeof parsed.path === 'string' ? parsed.path : undefined;
          const ls = await listRepoFiles({ ...repoCtx, ref: readRef }, sub);
          toolResult = ls.ok ? { ok: true, ref: readRef, paths: ls.paths, truncated: ls.truncated } : { ok: false, error: ls.reason };
        }
      } else if (name === 'search_code') {
        const query = typeof parsed.query === 'string' ? parsed.query : '';
        if (!query.trim()) {
          toolResult = { ok: false, error: 'query is required' };
        } else if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss})` };
        } else {
          const sr = await searchRepoCode({ ...repoCtx, ref: readRef }, query, { maxResults: 30 });
          toolResult = sr.ok
            ? { ok: true, query, total: sr.total, truncated: sr.truncated, matches: sr.matches,
                ...(sr.total === 0 ? { note: 'No matches in the indexed codebase — the term is not referenced. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.' } : {}) }
            : { ok: false, error: sr.reason };
        }
      } else if (name === 'read_file') {
        const path = typeof parsed.path === 'string' ? parsed.path : '';
        if (!path) {
          toolResult = { ok: false, error: 'path is required' };
        } else if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss})` };
        } else {
          const rf = await readRepoFile({ ...repoCtx, ref: readRef }, path);
          toolResult = rf.ok ? { ok: true, path: rf.path, content: rf.content, truncated: rf.truncated } : { ok: false, error: rf.reason };
        }
      } else if (name === 'write_file') {
        const path = typeof parsed.path === 'string' ? parsed.path : '';
        const fileContent = typeof parsed.content === 'string' ? parsed.content : '';
        if (!path || !fileContent) {
          toolResult = { ok: false, error: 'path and content are both required' };
        } else if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss}); include the file contents in your final summary instead` };
        } else {
          const firstWriteThisRun = !writtenPaths.has(path);
          const commit = await commitAgentFile(repoCtx, path, fileContent, `${firstWriteThisRun ? 'Add' : 'Update'} ${path} — task #${taskRow.id} (${agentLabel})`);
          if (commit.ok) {
            writtenPaths.add(path);
            // created vs modified comes from whether the path pre-existed in the repo
            // (commit.existed), not first-write-this-run — a pre-existing file edited
            // for the first time this run is a modification, not a creation.
            const change = commit.existed ? 'modified' : 'created';
            await recordTaskFileChange(env, tenantId, taskRow.id, executionId, path, change, agentLabel);
            notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change, ts: new Date().toISOString() });
            toolResult = { ok: true, branch: repoCtx.branch, commitUrl: commit.commitUrl };
          } else {
            toolResult = { ok: false, error: commit.reason };
          }
        }
      } else if (name === 'delete_file') {
        const path = typeof parsed.path === 'string' ? parsed.path : '';
        if (!path) {
          toolResult = { ok: false, error: 'path is required' };
        } else if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss})` };
        } else {
          const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? ` — ${parsed.reason.trim()}` : '';
          const del = await deleteAgentFile(repoCtx, path, `Remove ${path} — task #${taskRow.id} (${agentLabel})${reason}`);
          if (del.ok) {
            writtenPaths.delete(path);
            await recordTaskFileChange(env, tenantId, taskRow.id, executionId, path, 'deleted', agentLabel);
            notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: 'deleted', ts: new Date().toISOString() });
            toolResult = { ok: true, branch: repoCtx.branch, commitUrl: del.commitUrl };
          } else if (del.code === 'not_found') {
            // Not on the branch — nothing to remove. Report as a benign no-op so the
            // model doesn't treat it as a failure and retry.
            toolResult = { ok: true, deleted: false, note: `'${path}' is not on the branch, so there is nothing to delete.` };
          } else {
            toolResult = { ok: false, error: del.reason };
          }
        }
      } else if (name === 'run_checks') {
        // Real (if scoped) verification: statically validate the config files we
        // CAN parse in-Worker (JSON/YAML) so broken config is caught BEFORE the PR.
        // Build / project-wide type-check / lint / tests still need a shell, so
        // those remain CI's job — be honest about that so the agent doesn't claim
        // they passed.
        if (!repoCtx) {
          toolResult = { ok: true, ran: false, note: `No repository is bound (${repoMiss}) — nothing to validate here; return the deliverable in your finish summary.` };
        } else if (writtenPaths.size === 0) {
          toolResult = { ok: true, ran: false, note: 'No files written yet — write your changes first, then call run_checks to statically validate config files.' };
        } else {
          const v = await verifyWrittenFiles({ ...repoCtx, ref: readRef }, writtenPaths);
          toolResult = v.ok
            ? {
                ok: true, ran: true, kind: 'static-validation',
                checked: v.checked, skipped: v.skipped,
                note: `Static syntax validation PASSED for ${v.checked.length} JSON/YAML config file(s)`
                  + `${v.skipped.length ? ` (${v.skipped.length} non-config file(s) can't be parsed without a shell)` : ''}. `
                  + 'This executor has NO shell, so it did NOT run the build, project-wide type-check, lint, or tests — CI on the pull request verifies those. Do not claim those passed; ensure your code is correct.',
              }
            : {
                ok: false, ran: true, kind: 'static-validation',
                errors: v.errors,
                note: `Static validation FAILED on ${v.errors.length} file(s) — fix the parse error(s) below with write_file, then call run_checks again.`,
              };
        }
      } else if (name === 'finish') {
        const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
        // Two finish gates, in order. Either yields a block message that forces the
        // agent to call finish again once it has corrected the run; null = ship.
        let finishBlock: string | null = null;
        if (summary && !finishBlockedOnce && assertsUnrunVerification(summary)) {
          // (1) Honesty: the summary claims a check passed, but nothing was (or
          // could be) run. Block once and force an honest restatement.
          finishBlockedOnce = true;
          finishBlock =
            'You stated that a build/type-check/lint/test passed or is resolved, but this executor cannot run any of those — CI on the pull request verifies them. Call finish again with a summary that does NOT claim a check passed (describe what you changed and that CI will verify), or call run_checks first.';
        } else if (repoCtx && writtenPaths.size > 0 && placeholderBlocks < MAX_PLACEHOLDER_FINISH_BLOCKS) {
          // (2) Anti-stub: refuse to ship placeholder/scaffold code. Read the
          // committed files back and block if any still contain stub markers — the
          // agent must implement them for real (using the existing infrastructure)
          // or remove the dead file with delete_file.
          const scan = await scanWrittenForPlaceholders({ ...repoCtx, ref: repoCtx.branch }, writtenPaths);
          if (scan.flagged.length) {
            placeholderBlocks += 1;
            finishBlock =
              `Cannot finish — ${scan.flagged.length} committed file(s) still contain placeholder/stub code instead of a real implementation. `
              + 'Replace each stub with a working implementation that uses the existing infrastructure (search_code for it first), or if a file is dead code that should not ship in this PR, remove it with delete_file. Then call finish again.\n'
              + scan.flagged.map((f) => `- ${f.path}: ${f.markers.join('; ')}`).join('\n');
            await recordCloudToolEvent(db, {
              tenantId, cloudAgentRef, executionId,
              toolName: 'finish.blocked', category: 'tool',
              detail: { reason: 'placeholders', files: scan.flagged },
              result: `Blocked finish: ${scan.flagged.map((f) => f.path).join(', ')}`,
            });
          }
        }
        if (finishBlock) {
          toolResult = { ok: false, error: finishBlock };
        } else {
          if (summary) finalOutput = summary;
          finished = true;
          toolResult = { ok: true };
        }
      } else {
        toolResult = { ok: false, error: `unknown tool '${name}'. Available tools: search_code, list_files, read_file, write_file, delete_file, run_checks, finish. This executor has no shell and cannot run code, builds, or tests — do not claim a check passed; CI on the PR verifies.` };
      }

      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: name, category: 'tool', toolCallId: tc.id,
        detail: name === 'write_file' ? { path: parsed.path, summary: parsed.summary } : parsed,
        result: JSON.stringify(toolResult).slice(0, 300),
        durationMs: Date.now() - tStart,
      });

      messages.push({ role: 'tool', tool_call_id: tc.id ?? '', content: JSON.stringify(toolResult) });
    }
  }
  } finally {
    // Stop the cancel watcher (and let it settle) so its timer can't outlive the run.
    watcherDone = true;
    abortController.abort();
    await cancelWatcher.catch(() => { /* ignore */ });
  }

  // Durable (DO) surface: the per-tick budget is exhausted but the run isn't done
  // (not finished, not cancelled, more steps remain). Hand back the resume state
  // for the next alarm tick WITHOUT shipping — finalize only happens once the run
  // truly finishes. (The Worker surface never sets deferFinalize, so it always
  // falls through to the finalize below — behavior unchanged.)
  const runDone = finished || cancelled || step >= MAX_CLOUD_TOOL_STEPS;
  if (!runDone && opts?.deferFinalize) {
    return {
      ok: true,
      output: '',
      cancelled,
      finished: false,
      state: { messages, writtenPaths: [...writtenPaths], step, pinnedModel: activeModel, routing },
    };
  }

  const fin = await finalizeCloudRun(env, db, {
    tenantId, cloudAgentRef, executionId, taskRow, agentLabel,
    repoCtx, writtenPaths, finalOutput, cancelled,
  });
  return { ok: fin.ok, output: fin.output, cancelled, finished: true };
}

/**
 * Land a finished cloud run: open a PR (recording it for the in-product approval
 * flow), optionally auto-merge, and emit the `pr_opened` / `merge_to_main` timeline
 * events. The single finalize implementation, shared by the in-worker tool loop
 * ({@link runCloudToolLoop}) and the long-lived Container executor (which runs the
 * loop in its own process and calls this via the internal container-op endpoint).
 * By default the run STOPS with the PR open — nothing merges to the deploy branch
 * until a human approves (or `CLOUD_AUTOMERGE_ENABLED` ships it). Never throws.
 */
export async function finalizeCloudRun(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    cloudAgentRef: string | undefined;
    executionId: number;
    taskRow: { id: number; title: string };
    agentLabel: string;
    repoCtx: TicketRepoContext | null;
    writtenPaths: Set<string>;
    finalOutput: string;
    cancelled: boolean;
  },
): Promise<{ ok: boolean; output: string }> {
  const { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, writtenPaths, finalOutput, cancelled } = args;
  // The run is settling — release any steer that arrived after the loop's last step
  // so it can't dangle unconsumed (the stopped loop will never read it). The single
  // terminal chokepoint for every cloud surface (Worker loop, DO-finished tick, and
  // the container's finalize op all route through here).
  await releasePendingSteers(db, executionId);
  let prOpened = false;
  let merged = false;
  let mergeNote = '';
  if (repoCtx && writtenPaths.size > 0 && !cancelled) {
    const pr = await createPullRequest({
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
      title: `Task #${taskRow.id}: ${taskRow.title}`,
      body: `Changes for task #${taskRow.id}, by ${agentLabel}. Files: ${[...writtenPaths].join(', ')}.\n\n> ⚠ **Not verified in-agent.** This serverless executor has no shell and ran no build, type-check, lint, or tests. CI on this PR is the source of truth — do not merge on the agent's summary alone.`,
    }).catch(() => ({ ok: false as const, code: 'provider_error' as const, reason: 'pr failed' }));
    prOpened = pr.ok;

    const autoMerge = cloudAutoMergeEnabled(env);

    // Record the PR row so the in-product Pull Request tab / approval flow can act
    // on it. Status reflects the policy: 'open' when awaiting human approval; when
    // auto-merge is enabled, it lands as 'merged' (or stays 'open' pending green CI).
    // Keep the row id so the immediate-merge branch can stamp its merge SHA (which
    // correlates the post-merge build back to this task).
    let prRowId: string | null = null;
    if (pr.ok) {
      const recordedStatus = autoMerge && !cloudAutoMergeRequiresGreen(env) ? 'merged' : 'open';
      const prRow = await recordPullRequestRow(db, {
        tenantId, segmentId: repoCtx.segmentId, projectId: repoCtx.projectId, repoId: repoCtx.repoId,
        taskId: taskRow.id, provider: repoCtx.provider, number: pr.number, url: pr.url,
        branchName: repoCtx.branch, baseBranch: repoCtx.base, status: recordedStatus,
      }).catch(() => null);
      prRowId = prRow?.id ?? null;
    }

    await db.update(tasks)
      .set({ gitBranch: repoCtx.branch, ...(pr.ok ? { githubPrUrl: pr.url, githubPrNumber: pr.number } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, taskRow.id))
      .catch(() => { /* best-effort */ });

    if (!autoMerge) {
      // Approval-gated default: open the PR and stop. A human merges in-product.
      mergeNote = prOpened ? ` — opened a PR for review (awaiting approval before merge to \`${repoCtx.base}\`)` : '';
      merged = false;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'pr_opened', category: 'tool',
        detail: { base: repoCtx.base, head: repoCtx.branch },
        result: prOpened ? `opened PR #${pr.ok ? pr.number : ''} — awaiting human approval` : `pr failed: ${pr.ok ? '' : pr.reason}`.slice(0, 300),
      });
    } else if (cloudAutoMergeRequiresGreen(env)) {
      // Auto-merge enabled, gated on green CI: a successful CI webhook merges later.
      mergeNote = ` — pending CI (will merge to \`${repoCtx.base}\` on green)`;
      merged = true; // not a merge failure; the gate intentionally defers it
    } else {
      // Auto-merge enabled, immediate: ship to the deploy branch now.
      const m = await mergeBranchToBase({
        provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
        token: repoCtx.token, base: repoCtx.base, head: repoCtx.branch,
        message: `Task #${taskRow.id}: ${taskRow.title} (BuilderForce auto-merge by ${agentLabel})`,
      });
      merged = m.ok;
      // Stamp the merge SHA so the post-merge deploy-branch build correlates back
      // to this task (build validation + auto-fix loop).
      if (m.ok && prRowId) {
        await markPullRequestMergedById(db, prRowId, tenantId, { mergeSha: m.sha ?? null }).catch(() => { /* best-effort */ });
      }
      mergeNote = m.ok
        ? ` and auto-merged to \`${repoCtx.base}\` (deploy triggered)`
        : ` — auto-merge to \`${repoCtx.base}\` failed: ${m.reason}`;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'merge_to_main', category: 'tool',
        detail: { base: repoCtx.base, head: repoCtx.branch },
        result: m.ok ? `merged${m.merged ? '' : ' (already up to date)'}${m.sha ? ` · ${m.sha.slice(0, 7)}` : ''}` : `failed: ${m.reason}`.slice(0, 300),
      });
    }
  }

  const output =
    finalOutput ||
    (writtenPaths.size > 0
      ? `Committed ${writtenPaths.size} file(s) to \`${repoCtx?.branch}\`${prOpened ? ', opened a PR' : ''}${mergeNote}.`
      : cancelled ? 'Run cancelled before any output was produced.' : '(no output produced)');
  // Only a FAILED auto-merge breaks the "ship it" contract. Approval-gated runs end
  // with the PR open by design, so an unmerged PR there is success, not failure.
  const autoMergeFailed = prOpened && cloudAutoMergeEnabled(env) && !merged;
  // Mark the result unverified whenever a PR was opened: nothing was built or tested
  // in-agent, so the summary's claims are not authoritative — CI on the PR is.
  const unverifiedNote = prOpened
    ? '\n\n⚠ Not verified in-agent — this serverless executor ran no build/type-check/tests. CI on the PR is the source of truth.'
    : '';
  return { ok: !autoMergeFailed, output: output + unverifiedNote };
}

/**
 * Prep shared by both cloud surfaces (Worker `runCloudExecution` and the durable
 * `CloudRunnerDO`): ensure a task PRD, load governance + assigned capabilities (all
 * parallel reads), record the `context.prepare` + `capabilities.load` timeline
 * events, and build the system + user prompts the tool loop runs against. Returns
 * the two prompts. Never throws on the telemetry writes (best-effort).
 */
export async function prepareCloudRun(
  env: Env,
  db: Db,
  executionId: number,
  taskRow: { id: number; title: string; description: string | null },
  tenantId: number,
  projectId: number,
  agentLabel: string,
  model: string | undefined,
  artifacts: ResolvedArtifacts | undefined,
  cloudAgentRef?: string,
  payload?: string,
  opts?: { shell?: boolean },
): Promise<{ systemPrompt: string; userContent: string }> {
  const tPrep0 = Date.now();
  const [prd, governance, capabilities, workspace] = await Promise.all([
    ensureTaskPrd(env, db, executionId, taskRow, tenantId, projectId, taskRow.id, agentLabel, model),
    loadGovernanceContext(db, tenantId, projectId),
    loadCapabilityContext(env, db, artifacts),
    // The repo the agent runs against — its identity + top-level shape (so a wrong/
    // empty binding is visible before any LLM spend) AND what a prior pass already
    // committed to this branch (so a re-run reconciles instead of blindly appending).
    // Best-effort: a clean first run / no repo yields an empty workspace.
    loadWorkspaceContext(env, db, gitSecret(env), tenantId, taskRow.id),
  ]);
  const priorChanges = workspace.priorChanges;
  const repoLabel = workspace.repo ? `${workspace.repo.owner}/${workspace.repo.repo}` : null;
  await recordCloudToolEvent(db, {
    tenantId, cloudAgentRef, executionId,
    toolName: 'context.prepare', category: 'planning',
    detail: { steps: ['prd', 'governance', 'workspace', 'diff'], repo: repoLabel, fileCount: workspace.fileCount, priorFiles: priorChanges.length },
    result: `${prd ? 'PRD ready' : 'no PRD'} · ${governance ? 'governance loaded' : 'no governance'}`
      + ` · ${repoLabel ? `workspace ${repoLabel} (${workspace.fileCount}${workspace.truncated ? '+' : ''} file(s))` : `no repo bound${workspace.reason ? ` (${workspace.reason})` : ''}`}`
      + ` · ${priorChanges.length ? `${priorChanges.length} prior file(s) on branch` : 'clean branch'}`,
    durationMs: Date.now() - tPrep0,
  });

  // Record capability loading as its own timeline event so the Observability
  // timeline shows exactly which Skills/Personas/Content the cloud agent loaded.
  const cap = capabilities.summary;
  if (cap.skills.length || cap.personas.length || cap.content.length) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'capabilities.load', category: 'context',
      detail: cap,
      result: `${cap.personas.length} persona(s), ${cap.skills.length} skill(s), ${cap.content.length} content`
        + (cap.missing.length ? ` · ${cap.missing.length} unresolved: ${cap.missing.join(', ')}` : ''),
    });
  }

  // Auto-fix runs carry a remediation block (the post-merge build failure) in the
  // payload — surface it prominently so the agent fixes the REAL failing build.
  const remediation = parseRemediation(payload);

  // A "Send" on a TERMINAL run starts a NEW run carrying the user's message as a
  // follow-up directive. Surface it as the HEADLINE instruction so the run treats
  // the message as the goal — building on the prior run's committed work and the
  // (now PRD-recorded) directive, not redoing the task from scratch.
  const followUp = parseFollowUp(payload);

  // Show the agent the repo it's about to edit BEFORE it spends an LLM call, so a
  // wrong/empty binding is caught up-front instead of after a conceptual non-answer
  // (the exec #54 failure: the agent never saw that only `agent-runtime` was bound).
  const workspaceBlock = workspace.repo
    ? `## Repository / workspace\n\n`
      + `Your changes run against **${repoLabel}** (base \`${workspace.repo.base}\`), which currently contains ${workspace.fileCount}${workspace.truncated ? '+' : ''} file(s). Top-level entries:\n\n`
      + (workspace.topLevel.length ? workspace.topLevel.map((p) => `- \`${p}\``).join('\n') : '_(empty repository)_')
      + `\n\nIf these files are clearly UNRELATED to what the task asks for (e.g. the task is about a website but this repo holds none of its code), do NOT invent a conceptual answer or edit unrelated files — say so plainly in your summary, name the bound repository (${repoLabel}), and state that the correct repo must be bound. Explore with list_files / search_code before concluding.`
    : `## Repository / workspace\n\n`
      + `⚠ No repository is bound to this task${workspace.reason ? ` (${workspace.reason})` : ''}, so there are no files to edit. Return the complete deliverable in your final summary and state that a repository must be bound before code can ship.`;

  const priorChangesBlock = priorChanges.length
    ? `## Files already on this branch from prior passes\n\n`
      + `A previous run already committed these files to this task's branch. They are part of the OPEN pull request. `
      + `Reconcile against this list: update what's still needed, and **delete any that are dead code** — stubs, placeholders, unreferenced files, or anything that should not ship in this PR — with the delete_file tool. Do not leave orphaned files just because a prior pass created them.\n\n`
      + priorChanges.map((c) => `- \`${c.path}\` (${c.status})`).join('\n')
    : null;

  const userContent = [
    remediation
      ? `## Build failure to fix (attempt ${remediation.attempt}/${remediation.maxAttempts})\n\nA previous change for this task was merged but the build then FAILED. Fix the cause below — do not re-do unrelated work.\n\n${remediation.buildError}${remediation.runUrl ? `\n\nCI run: ${remediation.runUrl}` : ''}`
      : null,
    followUp
      ? `## Follow-up directive (act on this first)\n\nThe user reviewed the previous run${followUp.priorExecutionId != null ? ` (execution #${followUp.priorExecutionId})` : ''} and sent this new direction. Treat it as the primary goal for THIS run, building on the work already committed to the task's branch (see the prior-files list below) rather than starting over:\n\n${followUp.directive}`
      : null,
    prd ? `## Product Requirements Document (PRD)\n\n${prd}` : null,
    governance || null,
    workspaceBlock,
    priorChangesBlock,
    `## Your Task\n\n${taskRow.title}\n\n${taskRow.description ?? ''}`.trim(),
  ].filter(Boolean).join('\n\n---\n\n');

  // The tool loop runs against a real repository. The verification sentence differs
  // by executor: the durable surface has NO shell (CI verifies), the Container
  // surface has a REAL shell (run_command) so the agent verifies before finishing.
  const shellLine = opts?.shell
    ? 'You HAVE a real shell: use run_command to install dependencies and run the project build, type-check, lint, and tests in the checked-out repo BEFORE you finish. Fix anything that fails. Only claim a check passed if you actually ran it and saw it pass; CI on the PR re-verifies.'
    : 'You CANNOT run builds, type-checks, lint, or tests here — this executor has no shell. Those run in CI on the pull request your changes open, and that CI is the source of truth. There is NO run_code/run_command tool; if you want to acknowledge verification, call run_checks. NEVER state that a check passed, succeeded, is clean, or is resolved — you cannot run one. Write correct, complete code and finish with an honest summary.';
  const systemPrompt = [
    'You are a BuilderForce agent executing a project task against a real repository. Follow the PRD, architecture spec, and project rules exactly. ' +
    'Workflow: use search_code FIRST to locate where a symbol/string/feature lives across the whole repo (one call) — do NOT read files one by one to find references; ' +
    'use list_files to understand structure, read_file to read any file you intend to change (preserve existing code — only change what the task needs), ' +
    'then write_file with the FULL updated content (no bracketed placeholders) for each deliverable file. ' +
    'If search_code returns 0 matches for the thing a task says to change/remove, that means it is not in the codebase — say so in your summary instead of inventing an unrelated edit. ' +
    'If the bound repository (see "Repository / workspace") has no files related to the task, report that the wrong repo appears bound and name it — do NOT produce a conceptual stand-in against unrelated code. ' +
    'Do NOT call finish while any deliverable file is still a stub/placeholder or any requirement in the task/PRD is unimplemented — keep listing, reading and writing files until the task is genuinely complete. ' +
    'Reconcile the branch against the task, do not just append: if a file already on this branch (see "Files already on this branch") is dead code — a stub, an unreferenced file, or something that should not ship in this PR — remove it with delete_file (confirm it is unused via search_code first). The PR should contain only the files the task genuinely needs. ' +
    'When you finish, your committed changes are opened as a PULL REQUEST for human review (a person approves the merge in-product); they are NOT auto-deployed — so the PR must contain the COMPLETE, working change, not a partial scaffold. Call finish with a summary only once everything the task requires has been written. ' +
    shellLine + ' ' +
    'If no repository is bound, return the complete deliverable in your final summary instead. Make explicit, reasonable assumptions where specifics are unknown.',
    capabilities.promptBlock || null,
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userContent };
}

/**
 * Run an execution server-side via the gateway (the interim `durable`-surface
 * executor when the CloudRunnerDO binding is absent). Standard flow:
 * (1) ensure a PRD exists (generate + persist + emit as first change), then
 * (2) produce the deliverable honoring the PRD + project rules. Never throws.
 */
async function runCloudExecution(
  env: Env,
  runtimeService: RuntimeService,
  db: Db,
  executionId: number,
  taskRow: { id: number; title: string; description: string | null },
  tenantId: number,
  projectId: number,
  agentLabel: string,
  cloudAgentRef?: string,
  payload?: string,
  artifacts?: ResolvedArtifacts,
): Promise<void> {
  let model: string | undefined;
  try {
    const p = payload ? (JSON.parse(payload) as { model?: unknown }) : null;
    if (p && typeof p.model === 'string' && p.model.trim()) model = p.model.trim();
  } catch { /* payload not JSON — use default model */ }

  // Cross-isolate cancel check: the /cancel endpoint flips the DB row to
  // CANCELLED from a different request/isolate; the background loop polls this
  // between paid steps and stops instead of running to completion.
  const isCancelled = async (): Promise<boolean> => {
    try {
      return (await runtimeService.getExecution(executionId)).status === ExecutionStatus.CANCELLED;
    } catch { return false; }
  };

  try {
    // Already cancelled before we even started running → don't transition or spend.
    if (await isCancelled()) return;
    const running = await runtimeService.update(executionId, { status: ExecutionStatus.RUNNING });
    notifyExecutionSubscribers(executionId, {
      type: 'status_change',
      executionId,
      status: running.status,
      execution: running.toPlain(),
      ts: new Date().toISOString(),
    });

    const { systemPrompt, userContent } = await prepareCloudRun(
      env, db, executionId, taskRow, tenantId, projectId, agentLabel, model, artifacts, cloudAgentRef, payload,
    );
    const { ok, output, cancelled } = await runCloudToolLoop(
      env, db, executionId, tenantId, taskRow, cloudAgentRef, agentLabel, model, systemPrompt, userContent, isCancelled, projectId,
    );

    // Run was cancelled mid-loop: the row is already CANCELLED (a terminal
    // state). Don't attempt a COMPLETED/FAILED transition (it would throw) —
    // just surface the partial output to subscribers and stop.
    if (cancelled || (await isCancelled())) {
      notifyExecutionSubscribers(executionId, {
        type: 'message', executionId, role: 'assistant',
        text: output || 'Run cancelled.', ts: new Date().toISOString(),
      });
      return;
    }

    notifyExecutionSubscribers(executionId, {
      type: 'message',
      executionId,
      role: 'assistant',
      text: output,
      ts: new Date().toISOString(),
    });
    await runtimeService.update(
      executionId,
      ok
        ? { status: ExecutionStatus.COMPLETED, result: output }
        : { status: ExecutionStatus.FAILED, errorMessage: output },
    );
  } catch (e) {
    // Don't clobber a cancellation (terminal) with a FAILED transition.
    if (await isCancelled()) return;
    await runtimeService.update(executionId, {
      status: ExecutionStatus.FAILED,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Minimal structural shape of a domain Execution returned by RuntimeService. */
type SubmittedExecution = { id: number; status: string; toPlain(): unknown };

/**
 * Resolve the runtime engine + display label for a cloud-agent run from its
 * `ide_agents.id`. The ref is the one the caller pinned, else the ticket's
 * assigned agent (see {@link dispatchAndQueue}). When a ref resolves, the engine
 * and name are read from that agent's `ide_agents` record (authoritative,
 * tenant-scoped); otherwise V1 with no label (gateway-default bucket).
 *
 * One indexed lookup per execution-submit (not a hot read path), so it is not
 * cached. Never throws — defaults to 'builderforce-v1' on any failure.
 */
function parseCloudAgentRef(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { cloudAgentRef?: unknown };
    return typeof p.cloudAgentRef === 'string' && p.cloudAgentRef.trim() ? p.cloudAgentRef.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run-time repo selection off the payload. Returns:
 *   • a trimmed repo id  — pin this run to that repo,
 *   • ''                 — explicitly clear the pin (Auto-resolve),
 *   • undefined          — key absent, leave the existing pin untouched.
 * The tri-state lets "Auto" un-pin without clobbering a pin set by a prior run.
 */
function parseRepoId(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { repoId?: unknown };
    if (!('repoId' in p)) return undefined;
    return typeof p.repoId === 'string' ? p.repoId.trim() : '';
  } catch {
    return undefined;
  }
}

interface FollowUpContext { directive: string; priorExecutionId: number | null }

/**
 * Parse a follow-up directive off a re-run's payload. A "Send" on a TERMINAL run
 * starts a NEW execution carrying `{ followUp: { directive, priorExecutionId } }`;
 * prepareCloudRun surfaces the directive as the headline instruction so the new
 * run treats the user's message as the goal (on top of the task + evolved PRD).
 */
export function parseFollowUp(payload: string | undefined): FollowUpContext | null {
  if (!payload) return null;
  try {
    const f = (JSON.parse(payload) as { followUp?: { directive?: unknown; priorExecutionId?: unknown } }).followUp;
    const directive = typeof f?.directive === 'string' ? f.directive.trim() : '';
    if (!directive) return null;
    const prior = typeof f?.priorExecutionId === 'number' && Number.isFinite(f.priorExecutionId) ? f.priorExecutionId : null;
    return { directive, priorExecutionId: prior };
  } catch {
    return null;
  }
}

/** Terminal = the run has settled and has no live session to steer. A "Send" to a
 *  terminal run therefore starts a NEW run instead of being a silent no-op. */
export function isTerminalExecutionStatus(status: string | null | undefined): boolean {
  return status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED || status === ExecutionStatus.CANCELLED;
}

/**
 * Build the payload for a follow-up run started from a terminal run's "Send": keep
 * the prior run's agent/model/repo pin so the re-run executes AS the same agent,
 * drop any stale one-shot blocks (a prior remediation/follow-up), and attach the
 * new directive. The directive becomes the headline instruction in prepareCloudRun.
 */
export function buildFollowUpPayload(priorPayload: string | null | undefined, followUp: { directive: string; priorExecutionId: number }): string {
  let obj: Record<string, unknown> = {};
  if (priorPayload) {
    try { obj = JSON.parse(priorPayload) as Record<string, unknown>; } catch { obj = {}; }
  }
  delete obj.remediation; // a re-run is not the prior run's auto-fix attempt
  obj.followUp = { directive: followUp.directive, priorExecutionId: followUp.priorExecutionId };
  return JSON.stringify(obj);
}

interface RemediationContext { attempt: number; maxAttempts: number; buildError: string; runUrl: string | null }

/** Parse the post-merge build-failure remediation block off an auto-fix run's payload. */
function parseRemediation(payload: string | undefined): RemediationContext | null {
  if (!payload) return null;
  try {
    const r = (JSON.parse(payload) as { remediation?: Record<string, unknown> }).remediation;
    if (!r || r.kind !== 'build_failure' || typeof r.buildError !== 'string') return null;
    return {
      attempt: typeof r.attempt === 'number' ? r.attempt : 1,
      maxAttempts: typeof r.maxAttempts === 'number' ? r.maxAttempts : 2,
      buildError: r.buildError,
      runUrl: typeof r.runUrl === 'string' ? r.runUrl : null,
    };
  } catch {
    return null;
  }
}

interface ResolvedCloudAgent {
  engine: string;
  label?: string;
  ref?: string;
  runtimeSurface: string;
  /** The agent's own gateway model, or undefined to use the default. A V2 cloud
   *  agent must execute AS this model so a run is never silently attributed to the
   *  v1 gateway default. */
  baseModel?: string;
}

/** `ide_agents.base_model` sentinel meaning "no explicit model — use the default". */
const AGENT_DEFAULT_MODEL_SENTINEL = 'builderforce-default';

async function resolveCloudAgent(
  env: Env,
  tenantId: number,
  ref: string | undefined,
): Promise<ResolvedCloudAgent> {
  const DEFAULT: ResolvedCloudAgent = { engine: 'builderforce-v1', ref, runtimeSurface: 'durable' };
  if (!ref) return DEFAULT;
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = (await sql`SELECT engine, name, runtime_surface, base_model FROM ide_agents WHERE id = ${ref} AND tenant_id = ${tenantId} LIMIT 1`) as Array<{ engine?: string; name?: string; runtime_surface?: string; base_model?: string }>;
    const engine = typeof rows[0]?.engine === 'string' && rows[0].engine ? rows[0].engine : 'builderforce-v1';
    const label = typeof rows[0]?.name === 'string' && rows[0].name ? rows[0].name : undefined;
    const runtimeSurface = rows[0]?.runtime_surface === 'container' ? 'container' : 'durable';
    const rawModel = typeof rows[0]?.base_model === 'string' ? rows[0].base_model.trim() : '';
    const baseModel = rawModel && rawModel !== AGENT_DEFAULT_MODEL_SENTINEL ? rawModel : undefined;
    return { engine, label, ref, runtimeSurface, baseModel };
  } catch {
    return DEFAULT;
  }
}

/**
 * Human-readable name for a cloud agent's type — the canonical taxonomy. Used in
 * dispatch telemetry so the timeline says exactly which of the three cloud agent
 * types (and surface) actually ran, not a bare engine string.
 */
function cloudAgentTypeLabel(engine: string, surface: string): string {
  if (engine !== 'builderforce-v2') return 'V1 Cloud Agent';
  return surface === 'container' ? 'V2 Cloud Agent (Node/Container)' : 'V2 Cloud Agent (Durable Object)';
}

/**
 * Ensure the execution payload carries a model: an explicitly-pinned model wins,
 * otherwise fall back to the agent's own `base_model` so a V2 cloud run executes
 * AS the agent's model rather than the v1 gateway default. Returns the payload
 * unchanged when there is nothing to add (no fallback, or it can't be parsed).
 */
function withDefaultModel(payload: string | undefined, baseModel: string | undefined): string | undefined {
  if (!baseModel) return payload;
  let obj: Record<string, unknown> = {};
  if (payload) {
    try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { return payload; }
  }
  if (typeof obj.model === 'string' && obj.model.trim()) return payload;
  obj.model = baseModel;
  return JSON.stringify(obj);
}

/**
 * Shared post-submit dispatch path for `/executions` and `/tasks/submit`.
 *
 * Tries online self-hosted agentHosts first. If none take the work, the cloud
 * run is QUEUED rather than awaited: the handler returns immediately with the
 * execution still `pending`, and the LLM completion runs in the background via
 * `executionCtx.waitUntil` (the Workers-native queue). Status transitions and
 * output stream to WebSocket subscribers, so the caller never blocks on the
 * agent and the UI updates live (or via polling fallback).
 */
async function dispatchAndQueue(
  c: Context<RuntimeHonoEnv>,
  runtimeService: RuntimeService,
  db: Db,
  execution: SubmittedExecution,
  taskRow: ExecutionTaskRow,
  payload: string | undefined,
): Promise<unknown> {
  return startDispatchedExecution(
    c.env as Env, db, runtimeService,
    (p) => c.executionCtx.waitUntil(p),
    c.get('tenantId'), execution, taskRow, payload,
  );
}

/**
 * Context-free dispatch: create AND start a cloud run for a task. Used by the
 * CI-webhook auto-fix loop (no request context — it has only `env`, `db`, the
 * injected `runtimeService`, and `waitUntil`). Returns the new execution id, or
 * null if the task can't be resolved for the tenant.
 */
export async function dispatchCloudRunForTask(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  waitUntil: (p: Promise<unknown>) => void,
  params: { taskId: number; tenantId: number; payload?: string; submittedBy?: string },
): Promise<number | null> {
  const [taskRow] = await db
    .select({
      id: tasks.id, title: tasks.title, description: tasks.description,
      assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef,
      priority: tasks.priority, projectId: tasks.projectId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, params.taskId), eq(projects.tenantId, params.tenantId)))
    .limit(1);
  if (!taskRow) return null;

  const execution = await runtimeService.submit({
    taskId: params.taskId,
    agentHostId: taskRow.assignedAgentHostId ?? undefined,
    tenantId: params.tenantId,
    submittedBy: params.submittedBy ?? 'system:autofix',
    payload: params.payload,
  });
  await startDispatchedExecution(env, db, runtimeService, waitUntil, params.tenantId, execution as SubmittedExecution, taskRow as ExecutionTaskRow, params.payload);
  return execution.id;
}

/** The post-submit dispatch core, free of any request context. */
async function startDispatchedExecution(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  waitUntil: (p: Promise<unknown>) => void,
  tenantId: number,
  execution: SubmittedExecution,
  taskRow: ExecutionTaskRow,
  payload: string | undefined,
): Promise<unknown> {
  // On-Prem (hosted) execution happens ONLY when a host is explicitly pinned on the
  // task — a cloud agent is never broadcast to a client machine. Resolve a dispatch
  // target only for a pinned host (skips a needless all-online-hosts scan on the
  // common cloud-run path).
  const pinnedHostId = taskRow.assignedAgentHostId;
  const hostTargets = pinnedHostId != null ? await getDispatchTargets(db, tenantId, pinnedHostId) : [];

  // The executing cloud agent is whoever the caller pinned in the payload, else
  // the ticket's assigned agent (the swimlane's agent — `tasks.assignedAgentRef`).
  // Without this fallback an "Auto" run on a ticket assigned to a custom cloud
  // agent silently executed + was attributed as the gateway default, not the
  // assigned agent. Used for BOTH per-agent capability resolution (scope='agent')
  // and run attribution (engine/label/ref).
  const cloudAgentRef = parseCloudAgentRef(payload) ?? taskRow.assignedAgentRef ?? undefined;

  // Run-time repo selection: a caller can pin which of the project's repos this run
  // (and its sticky finalize/CI/PRD) targets. Persist it on the task BEFORE we
  // resolve the repo below so resolveDefaultRepoForTask honors the pin; '' clears it
  // (Auto). Pin only a repo that actually belongs to this task's project — the
  // picker is project-scoped; this guards a stale/cross-project id.
  const repoIdSel = parseRepoId(payload);
  if (repoIdSel !== undefined) {
    const repoId = repoIdSel || null;
    const valid = repoId == null
      || (await db.select({ id: projectRepositories.id }).from(projectRepositories)
            .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.projectId, taskRow.projectId), eq(projectRepositories.tenantId, tenantId)))
            .limit(1)).length > 0;
    if (valid) {
      await db.update(tasks).set({ explicitRepoId: repoId, updatedAt: new Date() })
        .where(eq(tasks.id, taskRow.id)).catch(() => { /* best-effort */ });
    }
  }

  const [artifacts, agent, repoRef] = await Promise.all([
    resolveArtifacts(db, {
      tenantId,
      taskId: taskRow.id,
      agentHostId: taskRow.assignedAgentHostId ?? undefined,
      cloudAgentRef,
    }),
    resolveCloudAgent(env, tenantId, cloudAgentRef),
    resolveDefaultRepoForTask(db, tenantId, taskRow.id),
  ]);

  // Agents are first-class assignees: when a cloud agent runs the ticket, it
  // self-assigns as it starts the work. Also stamp the EXECUTION with the agent
  // that ran it, so its logs/telemetry stay scoped to THIS run even after a later
  // run reassigns the ticket (the "logs show the wrong agent" bug).
  if (agent.ref) {
    await Promise.all([
      db.update(tasks).set({ assignedAgentRef: agent.ref, updatedAt: new Date() })
        .where(eq(tasks.id, taskRow.id)).catch(() => { /* best-effort */ }),
      db.update(executions).set({ cloudAgentRef: agent.ref })
        .where(eq(executions.id, execution.id)).catch(() => { /* best-effort */ }),
    ]);
  }

  const message: DispatchMessage = {
    type: 'task.assign',
    executionId: execution.id,
    taskId: taskRow.id,
    payload,
    engine: agent.engine,
    agentLabel: agent.label,
    repo: repoRef ? { repoId: repoRef.repoId, defaultBranch: repoRef.defaultBranch } : undefined,
    task: { title: taskRow.title, description: taskRow.description },
    artifacts,
  };

  // The three CLOUD agent types — see agent taxonomy ([[agent-types-taxonomy]]):
  //   • V1 Cloud Agent                  — engine builderforce-v1.
  //   • V2 Cloud Agent (Durable Object) — engine builderforce-v2, surface durable.
  //   • V2 Cloud Agent (Node/Container) — engine builderforce-v2, surface container.
  // ALL cloud agents execute ONLY in the cloud (all Cloudflare) — a cloud agent is
  // NEVER dispatched to an On-Prem (hosted) agent. On-Prem hosts run as a host
  // only when one is explicitly pinned on the task.
  const surface = resolveCloudSurface(agent.runtimeSurface, pinnedHostId != null);
  const isV2 = agent.engine === 'builderforce-v2';
  const typeLabel = cloudAgentTypeLabel(agent.engine, surface);

  // Dispatch to an On-Prem host ONLY for an explicitly pinned host run (legacy
  // AgentHost path). A V2 cloud agent never reaches a host: the 'container' surface
  // targets a long-lived Cloudflare Container (cloud), not a client machine.
  const delivered = pinnedHostId != null && !isV2
    ? (await Promise.all(hostTargets.map((targetId) => dispatchToAgentHost(env as RuntimeHonoEnv['Bindings'], targetId, message).catch(() => false)))).some(Boolean)
    : false;

  const notifyDone = async () => {
    const updated = await runtimeService.getExecution(execution.id);
    notifyExecutionSubscribers(execution.id, {
      type: 'done',
      executionId: execution.id,
      status: updated.status,
      execution: updated.toPlain(),
      ts: new Date().toISOString(),
    });
  };

  if (!delivered) {
    // Route a V2 Cloud Agent (Node/Container) to the REAL long-lived Cloudflare
    // Container (AgentContainerDO) when it's bound; everything else — V1 Cloud
    // Agent, V2 Cloud Agent (Durable Object), and a container run with no Container
    // binding — runs on the durable executor (CloudRunnerDO). A V2 run carries its
    // OWN model so it is never silently executed/attributed as the v1 gateway default.
    const wantsContainer = isV2 && surface === 'container';
    const hasContainer = wantsContainer && !!env.AGENT_CONTAINER;
    const executor: 'container' | 'durable' = hasContainer ? 'container' : 'durable';
    // Only note a degradation when the Container surface was wanted but no binding
    // exists; a bound-but-failed container records its own fallback note below.
    const containerFallback = wantsContainer && !hasContainer;
    const effectivePayload = withDefaultModel(payload, agent.baseModel);

    // Up-front diagnostics: record exactly which cloud agent type is dispatching,
    // on which surface, with which model, so the timeline shows the routing
    // decision (not just the eventual llm.complete calls).
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
      toolName: 'runtime.dispatch', category: 'planning',
      detail: { agentType: typeLabel, engine: agent.engine, surface, model: agent.baseModel ?? 'gateway-default', executor },
      result: `Dispatching ${typeLabel} to the ${executor} cloud executor (model: ${agent.baseModel ?? 'gateway default'}).`,
    });

    const runWorkerFallback = async () => {
      await runCloudExecution(env, runtimeService, db, execution.id, taskRow, tenantId, taskRow.projectId, agent.label ?? 'BuilderForce Agent', agent.ref, effectivePayload, artifacts);
      await notifyDone();
    };
    const startDurable = async () => {
      if (containerFallback) {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { requestedSurface: 'container', ranOn: 'durable' },
          result: `${typeLabel}: no long-lived Cloudflare Container is online yet — running on the durable (serverless) cloud executor instead. The run still executes fully in the cloud.`,
        });
      }
      const cloudRunner = env.CLOUD_RUNNER;
      if (!cloudRunner) {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { reason: 'no CLOUD_RUNNER binding', ranOn: 'worker' },
          result: 'Durable Object binding (CLOUD_RUNNER) not configured — running on the interim Worker loop (may not survive long multi-step runs).',
        });
        await runWorkerFallback();
        return;
      }
      try {
        const stub = cloudRunner.get(cloudRunner.idFromName(`exec:${execution.id}`));
        const res = await stub.fetch('https://cloud-runner/start', {
          method: 'POST',
          body: JSON.stringify({
            executionId: execution.id, tenantId, projectId: taskRow.projectId,
            taskId: taskRow.id, taskTitle: taskRow.title, taskDescription: taskRow.description,
            cloudAgentRef: agent.ref, agentLabel: agent.label ?? 'BuilderForce Agent',
            payload: effectivePayload, artifacts,
          }),
        });
        if (!res.ok) {
          await recordCloudToolEvent(db, {
            tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
            toolName: 'runtime.fallback', category: 'planning',
            detail: { reason: `CloudRunnerDO /start ${res.status}`, ranOn: 'worker' },
            result: `Durable Object kickoff returned ${res.status} — running on the interim Worker loop instead.`,
          });
          await runWorkerFallback();
        }
      } catch (e) {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { reason: e instanceof Error ? e.message : String(e), ranOn: 'worker' },
          result: 'Durable Object kickoff threw — running on the interim Worker loop instead.',
        });
        await runWorkerFallback();
      }
    };

    // Start the run in a real long-lived Cloudflare Container: prep the prompts
    // (shell-capable variant), mint the per-run callback token, hand the container a
    // tokened clone URL for its local workspace, and POST /run. The container drives
    // the loop in its own process and calls back into /internal/container-op. Any
    // failure to reach the container degrades to the durable executor.
    const startContainer = async () => {
      const agentNs = env.AGENT_CONTAINER;
      if (!agentNs) { await startDurable(); return; }
      try {
        const { systemPrompt, userContent } = await prepareCloudRun(
          env, db, execution.id, taskRow, tenantId, taskRow.projectId,
          agent.label ?? 'BuilderForce Agent', agent.baseModel, artifacts, agent.ref, effectivePayload,
          { shell: true },
        );
        const token = await mintContainerRunToken(env.JWT_SECRET, execution.id);
        const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskRow.id);
        const cloneSpec = repo.ok && repo.ctx.provider.startsWith('github')
          ? { cloneUrl: `https://x-access-token:${repo.ctx.token}@${repo.ctx.host}/${repo.ctx.owner}/${repo.ctx.repo}.git`, baseBranch: repo.ctx.base }
          : null;
        const internalBaseUrl = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
        const stub = agentNs.get(agentNs.idFromName(`exec:${execution.id}`));
        const res = await stub.fetch('https://agent-container/run', {
          method: 'POST',
          body: JSON.stringify({
            executionId: execution.id,
            internalBaseUrl,
            token,
            systemPrompt,
            userContent,
            maxSteps: CONTAINER_MAX_STEPS,
            repo: cloneSpec,
          }),
        });
        if (!res.ok) {
          await recordCloudToolEvent(db, {
            tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
            toolName: 'runtime.fallback', category: 'planning',
            detail: { reason: `AgentContainerDO /run ${res.status}`, ranOn: 'durable' },
            result: `Cloudflare Container kickoff returned ${res.status} — running on the durable executor instead.`,
          });
          await startDurable();
        }
      } catch (e) {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { reason: e instanceof Error ? e.message : String(e), ranOn: 'durable' },
          result: 'Cloudflare Container kickoff threw — running on the durable executor instead.',
        });
        await startDurable();
      }
    };

    waitUntil(hasContainer ? startContainer() : startDurable());
  }

  // Announce the queued/dispatched execution immediately.
  notifyExecutionSubscribers(execution.id, {
    type: 'status_change',
    executionId: execution.id,
    status: execution.status,
    execution: execution.toPlain(),
    ts: new Date().toISOString(),
  });

  return execution.toPlain();
}

async function getDispatchTargets(db: Db, tenantId: number, assignedAgentHostId?: number | null): Promise<number[]> {
  if (assignedAgentHostId != null) {
    const [row] = await db
      .select({ id: agentHosts.id })
      .from(agentHosts)
      .where(
        and(
          eq(agentHosts.id, assignedAgentHostId),
          eq(agentHosts.tenantId, tenantId),
        ),
      );
    return row ? [row.id] : [];
  }

  const rows = await db
    .select({ id: agentHosts.id })
    .from(agentHosts)
    .where(
      and(
        eq(agentHosts.tenantId, tenantId),
        agentHostOnlineCondition(),
      ),
    );
  return rows.map((row) => row.id);
}

export function createRuntimeRoutes(runtimeService: RuntimeService, db: Db): Hono<RuntimeHonoEnv> {
  const router = new Hono<RuntimeHonoEnv>();

  // Internal container-op endpoint — called by the long-lived Container executor
  // (AgentContainerDO), NOT by a browser/tenant. Registered BEFORE authMiddleware so
  // it bypasses tenant JWT auth and instead authenticates with the per-run token
  // (HMAC of the execution id). The container delegates each LLM step / commit /
  // finalize here so metering, commit, and PR logic stay server-side (one impl).
  router.post('/internal/container-op', async (c) => {
    const body = await c.req.json<{ executionId?: number; token?: string; op?: string; args?: Record<string, unknown> }>().catch(() => null);
    if (!body || typeof body.executionId !== 'number' || typeof body.token !== 'string' || typeof body.op !== 'string') {
      return c.json({ error: 'executionId, token and op are required' }, 400);
    }
    const ok = await verifyContainerRunToken(c.env.JWT_SECRET, body.executionId, body.token);
    if (!ok) return c.json({ error: 'invalid run token' }, 403);
    const ctx = await loadContainerRunContext(c.env as Env, db, body.executionId);
    if (!ctx) return c.json({ error: 'execution not found' }, 404);
    const res = await handleContainerOp(c.env as Env, db, runtimeService, ctx, body.executionId, body.op, body.args ?? {});
    return c.json(res.body as Record<string, unknown>, res.status as 200);
  });

  router.use('*', authMiddleware);

  // Legacy compatibility (BuilderForce Link) ----------------------------------------------------
  // The original AgentHostLink transport adapter used /api/runtime/sessions and
  // /api/runtime/tasks/submit. These endpoints are kept for CLI/agent compatibility.

  router.post('/sessions', async (c) => {
    const body = await c.req.json<{ sessionId?: string }>().catch(() => ({} as any));
    const sessionId = body.sessionId ?? crypto.randomUUID();
    return c.json({ sessionId }, 201);
  });

  router.post('/tasks/submit', async (c) => {
    const body = await c.req.json<{
      taskId:   number;
      agentId?: number;
      agentHostId?:  number | null;
      sessionId?: string;
      payload?: string;
    }>();

    const agentHostIdFromHeader = parseOptionalNumber(c.req.header('X-AgentHost-Id'));

    const [taskRow] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        assignedAgentHostId: tasks.assignedAgentHostId,
        assignedAgentRef: tasks.assignedAgentRef,
        priority: tasks.priority,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(tasks.id, body.taskId),
          eq(projects.tenantId, c.get('tenantId')),
        ),
      );

    if (!taskRow) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const gate = await evaluateExecutionApprovalGate(
      db,
      c.get('tenantId'),
      c.get('userId'),
      taskRow,
      agentHostIdFromHeader ?? body.agentHostId ?? null,
    );
    if (!gate.allowed) {
      return c.json(
        {
          status: 'awaiting_approval',
          approvalId: gate.approvalId,
          taskId: taskRow.id,
          reason: gate.reason,
        },
        202,
      );
    }

    const execution = await runtimeService.submit({
      taskId:      body.taskId,
      agentId:     body.agentId,
      agentHostId:      agentHostIdFromHeader ?? body.agentHostId,
      tenantId:    c.get('tenantId'),
      submittedBy: c.get('userId'),
      sessionId:   body.sessionId,
      payload:     body.payload,
    });

    const result = await dispatchAndQueue(c, runtimeService, db, execution, taskRow, body.payload);
    return c.json(result, 201);
  });

  router.get('/tasks/:id/state', async (c) => {
    const id = Number(c.req.param('id'));
    const execution = await runtimeService.getExecution(id);
    return c.json(execution.toPlain());
  });

  router.post('/tasks/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    const execution = await runtimeService.cancel(id, c.get('userId'));
    return c.json(execution.toPlain());
  });

  // Submit a task for execution
  router.post('/executions', async (c) => {
    const body = await c.req.json<{
      taskId:   number;
      agentId?: number;
      agentHostId?:  number | null;
      sessionId?: string;
      payload?: string;
    }>();
    const agentHostIdFromHeader = parseOptionalNumber(c.req.header('X-AgentHost-Id'));

    const [taskRow] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        assignedAgentHostId: tasks.assignedAgentHostId,
        assignedAgentRef: tasks.assignedAgentRef,
        priority: tasks.priority,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(tasks.id, body.taskId),
          eq(projects.tenantId, c.get('tenantId')),
        ),
      );

    if (!taskRow) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const gate = await evaluateExecutionApprovalGate(
      db,
      c.get('tenantId'),
      c.get('userId'),
      taskRow,
      agentHostIdFromHeader ?? body.agentHostId ?? null,
    );
    if (!gate.allowed) {
      return c.json(
        {
          status: 'awaiting_approval',
          approvalId: gate.approvalId,
          taskId: taskRow.id,
          reason: gate.reason,
        },
        202,
      );
    }

    const execution = await runtimeService.submit({
      taskId:      body.taskId,
      agentId:     body.agentId,
      agentHostId:      agentHostIdFromHeader ?? body.agentHostId,
      tenantId:    c.get('tenantId'),
      submittedBy: c.get('userId'),
      sessionId:   body.sessionId,
      payload:     body.payload,
    });

    const result = await dispatchAndQueue(c, runtimeService, db, execution, taskRow, body.payload);
    return c.json(result, 201);
  });

  // List executions for the caller's tenant
  router.get('/executions', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const sessionId = (c.req.query('sessionId') ?? '').trim();
    const executions = sessionId
      ? await runtimeService.listBySession(c.get('tenantId'), sessionId, limit)
      : await runtimeService.listByTenant(c.get('tenantId'), limit);
    return c.json(executions.map(e => e.toPlain()));
  });

  // Tenant-level runtime dashboard aggregates derived from recent execution history.
  router.get('/dashboard', async (c) => {
    const tenantId = c.get('tenantId');
    const limit = Math.min(Number(c.req.query('limit') ?? '500'), 2_000);
    const executionRows = await runtimeService.listByTenant(tenantId, limit);
    const executionsPlain = executionRows.map((execution) => execution.toPlain());

    const totals = {
      totalExecutions: executionsPlain.length,
      pending: 0,
      submitted: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      successRate: 0,
      avgDurationMs: 0,
    };

    let durationSamples = 0;
    let durationTotalMs = 0;

    const agentHostStats = new Map<number, {
      agentHostId: number;
      totalExecutions: number;
      completed: number;
      failed: number;
      running: number;
      pending: number;
      cancelled: number;
      lastExecutionAt: string | null;
    }>();

    for (const execution of executionsPlain) {
      switch (execution.status) {
        case 'pending':
          totals.pending += 1;
          break;
        case 'submitted':
          totals.submitted += 1;
          break;
        case 'running':
          totals.running += 1;
          break;
        case 'completed':
          totals.completed += 1;
          break;
        case 'failed':
          totals.failed += 1;
          break;
        case 'cancelled':
          totals.cancelled += 1;
          break;
      }

      if (execution.startedAt && execution.completedAt) {
        durationSamples += 1;
        durationTotalMs += new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();
      }

      if (execution.agentHostId != null) {
        const current = agentHostStats.get(execution.agentHostId) ?? {
          agentHostId: execution.agentHostId,
          totalExecutions: 0,
          completed: 0,
          failed: 0,
          running: 0,
          pending: 0,
          cancelled: 0,
          lastExecutionAt: null,
        };

        current.totalExecutions += 1;
        if (execution.status === 'completed') current.completed += 1;
        if (execution.status === 'failed') current.failed += 1;
        if (execution.status === 'running') current.running += 1;
        if (execution.status === 'pending' || execution.status === 'submitted') current.pending += 1;
        if (execution.status === 'cancelled') current.cancelled += 1;

        const createdAtIso = new Date(execution.createdAt).toISOString();
        if (!current.lastExecutionAt || createdAtIso > current.lastExecutionAt) {
          current.lastExecutionAt = createdAtIso;
        }

        agentHostStats.set(execution.agentHostId, current);
      }
    }

    const terminalCount = totals.completed + totals.failed + totals.cancelled;
    totals.successRate = terminalCount > 0 ? totals.completed / terminalCount : 0;
    totals.avgDurationMs = durationSamples > 0 ? Math.round(durationTotalMs / durationSamples) : 0;

    const agentHostIds = Array.from(agentHostStats.keys());
    const agentHostNames = new Map<number, string>();
    if (agentHostIds.length > 0) {
      const hostRows = await db
        .select({ id: agentHosts.id, name: agentHosts.name })
        .from(agentHosts)
        .where(inArray(agentHosts.id, agentHostIds));
      hostRows.forEach((agentHost) => agentHostNames.set(agentHost.id, agentHost.name));
    }

    const byAgentHost = Array.from(agentHostStats.values())
      .map((entry) => ({
        ...entry,
        name: agentHostNames.get(entry.agentHostId) ?? `AgentHost ${entry.agentHostId}`,
        successRate: entry.completed + entry.failed + entry.cancelled > 0
          ? entry.completed / (entry.completed + entry.failed + entry.cancelled)
          : 0,
      }))
      .sort((left, right) => right.totalExecutions - left.totalExecutions);

    return c.json({
      tenantId,
      window: { sampledExecutions: executionsPlain.length, limit },
      totals,
      byAgentHost,
    });
  });

  // Fleet "what's running right now" — every non-terminal execution for the
  // tenant (pending / submitted / running), with task title, the executing agent
  // (host id or cloud agent ref), and how long it's been going. This is the live
  // fleet view the dashboard's rolled-up counts couldn't give, and the single
  // source the UI uses to mark a cloud agent as actively running.
  // Intentionally uncached: a live operational surface that must reflect the
  // fleet's state this instant (same rationale as /cloud-agents).
  router.get('/active', async (c) => {
    const tenantId = c.get('tenantId');
    const limit = Math.min(Number(c.req.query('limit') ?? '200'), 500);
    const rows = await db
      .select({
        id: executions.id,
        status: executions.status,
        taskId: executions.taskId,
        taskTitle: tasks.title,
        agentHostId: executions.agentHostId,
        cloudAgentRef: tasks.assignedAgentRef,
        submittedBy: executions.submittedBy,
        startedAt: executions.startedAt,
        createdAt: executions.createdAt,
      })
      .from(executions)
      .innerJoin(tasks, eq(tasks.id, executions.taskId))
      .where(and(eq(executions.tenantId, tenantId), inArray(executions.status, ['pending', 'submitted', 'running'])))
      .orderBy(desc(executions.createdAt))
      .limit(limit);

    const now = Date.now();
    const active = rows.map((r) => {
      const isCloud = r.agentHostId == null;
      const since = r.startedAt ?? r.createdAt;
      return {
        ...r,
        kind: isCloud ? ('cloud' as const) : ('on-prem' as const),
        cloudAgentRef: isCloud ? (r.cloudAgentRef ?? DEFAULT_CLOUD_REF) : null,
        elapsedMs: since ? Math.max(0, now - new Date(since).getTime()) : null,
      };
    });
    return c.json({ active, runningCloudRefs: [...new Set(active.filter((a) => a.kind === 'cloud').map((a) => a.cloudAgentRef))] });
  });

  // Full execution timeline for one session (newest first)
  router.get('/sessions/:sessionId/executions', async (c) => {
    const sessionId = c.req.param('sessionId').trim();
    const limit = Number(c.req.query('limit') ?? '200');
    if (!sessionId) {
      return c.json({ error: 'sessionId is required' }, 400);
    }
    const executions = await runtimeService.listBySession(c.get('tenantId'), sessionId, limit);
    return c.json({ sessionId, executions: executions.map((e) => e.toPlain()) });
  });

  // Get a single execution by ID
  router.get('/executions/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const execution = await runtimeService.getExecution(id);
    return c.json(execution.toPlain());
  });

  // Legacy telemetry / trace endpoints (used by some older integrations)
  router.post('/executions/:id/telemetry', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req
      .json<ExecutionTelemetryBody>()
      .catch((): ExecutionTelemetryBody => ({}));

    const execution = await runtimeService.getExecution(id);
    const plain = execution.toPlain();
    const callerTenantId = c.get('tenantId');

    // Keep telemetry endpoint tenant-safe.
    if (plain.tenantId !== callerTenantId) {
      return c.json({ error: 'Execution not found' }, 404);
    }

    if (plain.agentHostId == null || !plain.sessionId) {
      return c.json({ id, status: 'ignored', reason: 'execution_missing_agent_host_or_session' });
    }

    const num = (v: unknown): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    };

    const ts = body.ts ? new Date(body.ts) : new Date();
    const safeTs = Number.isNaN(ts.getTime()) ? new Date() : ts;

    await db.insert(usageSnapshots).values({
      tenantId: plain.tenantId,
      agentHostId: plain.agentHostId,
      sessionKey: plain.sessionId,
      inputTokens: num(body.inputTokens),
      outputTokens: num(body.outputTokens),
      contextTokens: num(body.contextTokens),
      contextWindowMax: num(body.contextWindowMax),
      compactionCount: num(body.compactionCount),
      ts: safeTs,
    });

    return c.json({ id, status: 'stored' });
  });

  router.get('/executions/:id/trace', async (c) => {
    const id = Number(c.req.param('id'));
    const execution = await runtimeService.getExecution(id);
    const plain = execution.toPlain();
    const callerTenantId = c.get('tenantId');

    if (plain.tenantId !== callerTenantId) {
      return c.json({ error: 'Execution not found' }, 404);
    }

    // Self-hosted runs are keyed by (agent_host_id, session_key); cloud runs have
    // neither, so their telemetry (0092) is keyed by execution_id. Pick the filter
    // that matches the run shape rather than bailing out for cloud executions.
    const hostId = plain.agentHostId;
    const sessionId = plain.sessionId;
    const isCloudRun = hostId == null || !sessionId;
    const usageFilter = isCloudRun
      ? and(eq(usageSnapshots.tenantId, plain.tenantId), eq(usageSnapshots.executionId, id))
      : and(
          eq(usageSnapshots.tenantId, plain.tenantId),
          eq(usageSnapshots.agentHostId, hostId!),
          eq(usageSnapshots.sessionKey, sessionId!),
        );
    const toolFilter = isCloudRun
      ? and(eq(toolAuditEvents.tenantId, plain.tenantId), eq(toolAuditEvents.executionId, id))
      : and(
          eq(toolAuditEvents.tenantId, plain.tenantId),
          eq(toolAuditEvents.agentHostId, hostId!),
          eq(toolAuditEvents.sessionKey, sessionId!),
        );

    const usage = await db
      .select({
        id: usageSnapshots.id,
        ts: usageSnapshots.ts,
        inputTokens: usageSnapshots.inputTokens,
        outputTokens: usageSnapshots.outputTokens,
        contextTokens: usageSnapshots.contextTokens,
        contextWindowMax: usageSnapshots.contextWindowMax,
        compactionCount: usageSnapshots.compactionCount,
      })
      .from(usageSnapshots)
      .where(usageFilter)
      .orderBy(desc(usageSnapshots.ts))
      .limit(500);

    const toolEvents = await db
      .select({
        id: toolAuditEvents.id,
        ts: toolAuditEvents.ts,
        toolName: toolAuditEvents.toolName,
        category: toolAuditEvents.category,
        durationMs: toolAuditEvents.durationMs,
        args: toolAuditEvents.args,
        result: toolAuditEvents.result,
        runId: toolAuditEvents.runId,
        toolCallId: toolAuditEvents.toolCallId,
      })
      .from(toolAuditEvents)
      .where(toolFilter)
      .orderBy(desc(toolAuditEvents.ts))
      .limit(500);

    // The durable steering/chat thread (0109) — so a steer survives a reload and
    // the Output tab can render the real conversation, not just optimistic echoes.
    const messages = await listExecutionMessages(db, id);

    return c.json({
      execution: plain,
      trace: {
        source: isCloudRun ? 'cloud-telemetry' : 'runtime-fallback',
        usageSnapshots: usage,
        toolEvents,
        messages,
      },
    });
  });

  // GET /api/runtime/cloud-agents
  // The cloud agents that have ACTUALLY run (distinct cloud_agent_ref in the
  // telemetry), tenant-scoped — so the Observability directory surfaces every
  // cloud run, not just agents registered in the workforce pool. Runs dispatched
  // to the gateway default (no named agent) land under the DEFAULT_CLOUD_REF
  // bucket so their telemetry is still attributable to a chip.
  // Intentionally uncached: this is a low-QPS interactive debug surface that must
  // reflect a run the instant it finishes; the alternative (a cached list keyed by
  // a version token) would force a KV write on the hot per-tool-call insert path —
  // a worse trade than an indexed SELECT DISTINCT over a tiny per-tenant keyspace.
  router.get('/cloud-agents', async (c) => {
    const tenantId = c.get('tenantId');
    const rows = await db
      .selectDistinct({ ref: toolAuditEvents.cloudAgentRef })
      .from(toolAuditEvents)
      .where(and(eq(toolAuditEvents.tenantId, tenantId), isNull(toolAuditEvents.agentHostId)));

    const namedRefs = rows.map((r) => r.ref).filter((r): r is string => !!r);
    const hasDefault = rows.some((r) => r.ref == null);

    // Resolve display names from the raw-SQL ide_agents table (best-effort).
    const nameByRef = new Map<string, string>();
    if (namedRefs.length > 0) {
      try {
        const sql = neon((c.env as Env).NEON_DATABASE_URL);
        const named = (await sql`
          SELECT id, name FROM ide_agents WHERE tenant_id = ${tenantId} AND id = ANY(${namedRefs})
        `) as Array<{ id: string; name: string }>;
        for (const n of named) nameByRef.set(String(n.id), n.name);
      } catch { /* names are cosmetic — fall back to the ref */ }
    }

    const agents = [
      ...(hasDefault ? [{ ref: DEFAULT_CLOUD_REF, name: 'BuilderForce Cloud (default)' }] : []),
      ...namedRefs.map((r) => ({ ref: r, name: nameByRef.get(r) ?? `Cloud agent ${r}` })),
    ];
    return c.json({ agents });
  });

  // GET /api/runtime/agents/:ref/tool-audit?limit=
  // Tool-audit events for ONE cloud agent (ide_agents.id, or DEFAULT_CLOUD_REF for
  // gateway-default runs), tenant-scoped, newest first — the cloud-side analogue of
  // /agent-hosts/:id/tool-audit. Feeds the unified Observability timeline so cloud
  // agents are as observable as hosts.
  router.get('/agents/:ref/tool-audit', async (c) => {
    const ref = c.req.param('ref');
    const tenantId = c.get('tenantId');
    const limitRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;
    // Optional per-execution scope: when set, return only this run's events
    // (precise per-execution telemetry, robust to later agent re-assignment).
    const execRaw = Number(c.req.query('executionId'));
    const executionId = Number.isFinite(execRaw) && execRaw > 0 ? execRaw : null;

    // DEFAULT_CLOUD_REF = cloud runs with no named agent (cloud_agent_ref IS NULL);
    // scope to cloud rows (agent_host_id IS NULL) so a host run never leaks in.
    // An explicit executionId is authoritative (the events carry it directly), so
    // it scopes regardless of which ref the run was attributed to.
    const refCond = executionId != null
      ? eq(toolAuditEvents.executionId, executionId)
      : ref === DEFAULT_CLOUD_REF
        ? and(isNull(toolAuditEvents.cloudAgentRef), isNull(toolAuditEvents.agentHostId))
        : eq(toolAuditEvents.cloudAgentRef, ref);

    const events = await db
      .select({
        id: toolAuditEvents.id,
        runId: toolAuditEvents.runId,
        sessionKey: toolAuditEvents.sessionKey,
        toolCallId: toolAuditEvents.toolCallId,
        toolName: toolAuditEvents.toolName,
        category: toolAuditEvents.category,
        args: toolAuditEvents.args,
        result: toolAuditEvents.result,
        durationMs: toolAuditEvents.durationMs,
        executionId: toolAuditEvents.executionId,
        ts: toolAuditEvents.ts,
      })
      .from(toolAuditEvents)
      .where(and(eq(toolAuditEvents.tenantId, tenantId), refCond))
      .orderBy(desc(toolAuditEvents.ts))
      .limit(limit);

    // Read-path repair: a run that FAILED before the failure-telemetry emit
    // existed (or via any path that missed it) has its reason only on
    // executions.error_message, so the Logs/Timeline (telemetry-only views) never
    // show it — the timeline just stops at the last successful tool call. When
    // scoped to one execution, synthesize the terminal `run.failed` event from the
    // execution row if it failed and no persisted failure event is present. Self-
    // healing and idempotent (mirrors RuntimeService.reapIfOrphaned's read repair);
    // one indexed PK lookup, only on the per-execution path.
    if (executionId != null && !events.some((e) => e.toolName === 'run.failed')) {
      const [exec] = await db
        .select({ status: executions.status, errorMessage: executions.errorMessage, completedAt: executions.completedAt, updatedAt: executions.updatedAt })
        .from(executions)
        .where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId)))
        .limit(1);
      if (exec?.status === 'failed') {
        events.unshift({
          id: -executionId,
          runId: null,
          sessionKey: `exec:${executionId}`,
          toolCallId: null,
          toolName: 'run.failed',
          category: 'error',
          args: null,
          result: exec.errorMessage ?? 'Run failed',
          durationMs: null,
          executionId,
          ts: exec.completedAt ?? exec.updatedAt,
        });
      }
    }

    return c.json({ events });
  });

  // P0-2: WebSocket streaming endpoint for a single execution.
  // GET /api/runtime/executions/:id/stream?token=<jwt>
  // Upgrades to a WebSocket and streams status_change/done events as execution
  // transitions are written by submit/cancel/update handlers in this worker.
  // Falls back to a 426 if the client does not send an Upgrade header, so the
  // existing REST endpoints remain a canonical fallback.
  router.get('/executions/:id/stream', async (c) => {
    const upgrade = c.req.header('Upgrade');
    if (upgrade !== 'websocket') {
      return c.text('This endpoint requires a WebSocket upgrade.', 426);
    }

    const id = Number(c.req.param('id'));
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    try {
      const execution = await runtimeService.getExecution(id);
      const plain = execution.toPlain();

      server.send(JSON.stringify({
        type: 'status_change',
        executionId: id,
        status: plain.status,
        execution: plain,
        ts: new Date().toISOString(),
      }));
    } catch {
      server.send(JSON.stringify({ type: 'error', message: 'execution_not_found' }));
      server.close(1011, 'server_error');
      return new Response(null, { status: 101, webSocket: client });
    }

    subscribeExecution(id, server);

    server.addEventListener('close', () => {
      unsubscribeExecution(id, server);
    });

    return new Response(null, { status: 101, webSocket: client });
  });

  // Cancel an execution. Beyond flipping the DB row to CANCELLED, this actually
  // STOPS the work: self-hosted runs get an `execution.cancel` frame relayed to
  // the host (which aborts the live session); cloud runs are halted by the
  // background loop's per-step cancel poll (see runCloudToolLoop). Without this,
  // cancel was cosmetic and the agent kept burning tokens to completion.
  router.post('/executions/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    const execution = await runtimeService.cancel(id, c.get('userId'));
    const plain = execution.toPlain() as { agentHostId?: number | null };

    // Terminal now — drop any pending steer so it can't dangle unconsumed.
    await releasePendingSteers(db, id);

    if (plain.agentHostId != null) {
      const stub = c.env.AGENT_HOST_RELAY?.get(
        c.env.AGENT_HOST_RELAY.idFromName(String(plain.agentHostId)),
      );
      await stub?.fetch('https://relay.internal/execution-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: id }),
      }).catch(() => { /* best effort; status is already CANCELLED */ });
    }

    notifyExecutionSubscribers(execution.id, {
      type: 'done',
      executionId: execution.id,
      status: execution.status,
      execution: execution.toPlain(),
      ts: new Date().toISOString(),
    });

    return c.json(execution.toPlain());
  });

  // Send a follow-up direction to a running/queued execution so the user can
  // steer it mid-run. The message is broadcast to the execution's stream
  // subscribers immediately. For self-hosted runs it is also relayed to the
  // assigned agentHost (which feeds it into the live agent session as the next
  // turn). Cloud completions are one-shot today — see gap register for resume.
  // "Send" on an execution's Output tab. Behaviour depends on whether the run is
  // live or settled:
  //   • RUNNING / queued → STEER it: persist the directive as a pending user turn
  //     (the cloud agent loop — V1 / V2-durable / V2-container — drains it on its
  //     next step; a self-hosted host also gets it relayed) and record it as a PRD
  //     revision so the spec evolves with the run.
  //   • TERMINAL (completed/failed/cancelled) → there is no live session to steer,
  //     so START A NEW run seeded with the directive as the headline instruction
  //     (built on the prior run's committed work + the evolved PRD), and return the
  //     new execution id so the UI can follow it. This replaces the old silent
  //     no-op, which only ever forwarded to a live host and dropped everything else.
  router.post('/executions/:id/messages', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
    const text = body.text?.trim();
    if (!text) return c.json({ error: 'text is required' }, 400);

    const execution = await runtimeService.getExecution(id).catch(() => null);
    if (!execution) return c.json({ error: 'Execution not found' }, 404);
    const plain = execution.toPlain() as { tenantId?: number; agentHostId?: number | null; status?: string; taskId?: number; payload?: string | null; cloudAgentRef?: string | null };
    const tenantId = c.get('tenantId');
    if (plain.tenantId != null && plain.tenantId !== tenantId) {
      return c.json({ error: 'Execution not found' }, 404);
    }

    // Task essentials for PRD write-back and (on a terminal run) the re-run dispatch.
    const [taskRow] = plain.taskId != null
      ? await db
          .select({ id: tasks.id, title: tasks.title, description: tasks.description, assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef, priority: tasks.priority, projectId: tasks.projectId })
          .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(and(eq(tasks.id, plain.taskId), eq(projects.tenantId, tenantId))).limit(1)
      : [undefined];

    // Label the PRD revision / attribution with the agent that ran THIS execution.
    const directiveAgentRef = plain.cloudAgentRef ?? parseCloudAgentRef(plain.payload ?? undefined) ?? taskRow?.assignedAgentRef ?? undefined;
    const agentLabel = (await resolveCloudAgent(c.env as Env, tenantId, directiveAgentRef)).label ?? 'BuilderForce Agent';

    if (!isTerminalExecutionStatus(plain.status)) {
      // ── Steer the live run ──────────────────────────────────────────────────
      await enqueueExecutionMessage(db, { executionId: id, tenantId, role: 'user', text });

      if (plain.agentHostId != null) {
        const stub = c.env.AGENT_HOST_RELAY?.get(c.env.AGENT_HOST_RELAY.idFromName(String(plain.agentHostId)));
        await stub?.fetch('https://relay.internal/execution-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId: id, text }),
        }).catch(() => { /* best effort; the loop still drains the persisted steer */ });
      }

      notifyExecutionSubscribers(id, { type: 'message', executionId: id, role: 'user', text, ts: new Date().toISOString() });

      if (taskRow) {
        c.executionCtx.waitUntil(recordPrdDirective(c.env as Env, db, {
          executionId: id, tenantId, projectId: taskRow.projectId, taskId: taskRow.id, taskTitle: taskRow.title, agentLabel, directive: text,
        }));
      }
      return c.json({ ok: true, steered: true });
    }

    // ── Terminal run → start a NEW run carrying the directive ─────────────────
    if (!taskRow) return c.json({ error: 'Task no longer exists' }, 409);

    const gate = await evaluateExecutionApprovalGate(db, tenantId, c.get('userId'), taskRow, plain.agentHostId ?? null);
    if (!gate.allowed) {
      return c.json({ status: 'awaiting_approval', approvalId: gate.approvalId, taskId: taskRow.id, reason: gate.reason }, 202);
    }

    const followUpPayload = buildFollowUpPayload(plain.payload, { directive: text, priorExecutionId: id });
    const newExecution = await runtimeService.submit({
      taskId: taskRow.id,
      agentHostId: plain.agentHostId ?? undefined,
      tenantId,
      submittedBy: c.get('userId'),
      payload: followUpPayload,
    });

    // Echo the directive on the new run's thread (display-only — it is already the
    // run's headline instruction, so it must NOT be re-drained as a steer).
    await enqueueExecutionMessage(db, { executionId: newExecution.id, tenantId, role: 'user', text, pending: false });
    c.executionCtx.waitUntil(recordPrdDirective(c.env as Env, db, {
      executionId: newExecution.id, tenantId, projectId: taskRow.projectId, taskId: taskRow.id, taskTitle: taskRow.title, agentLabel, directive: text,
    }));

    const dispatch = await dispatchAndQueue(c, runtimeService, db, newExecution as SubmittedExecution, taskRow as ExecutionTaskRow, followUpPayload);
    return c.json({ ok: true, rerun: { executionId: newExecution.id, dispatch } });
  });

  // Agent callback: update execution state (running / completed / failed)
  router.patch('/executions/:id/state', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{
      status:        ExecutionStatus;
      result?:       string;
      errorMessage?: string;
      codeChanges?:  number;
    }>();
    const execution = await runtimeService.update(id, body);

    // On a terminal transition (this is the self-hosted host callback path), drop
    // any pending steer so it can't dangle unconsumed after the run stops.
    if (body.status === ExecutionStatus.COMPLETED || body.status === ExecutionStatus.FAILED || body.status === ExecutionStatus.CANCELLED) {
      await releasePendingSteers(db, id);
    }

    notifyExecutionSubscribers(execution.id, {
      type: (body.status === ExecutionStatus.COMPLETED || body.status === ExecutionStatus.FAILED || body.status === ExecutionStatus.CANCELLED)
        ? 'done'
        : 'status_change',
      executionId: execution.id,
      status: execution.status,
      execution: execution.toPlain(),
      ts: new Date().toISOString(),
    });

    if (body.status === ExecutionStatus.COMPLETED) {
      const explicitCodeChanges = normalizeCodeChanges(body.codeChanges);
      const inferredCodeChanges = extractCodeChangesFromResult(body.result);
      const codeChanges = explicitCodeChanges ?? inferredCodeChanges;

      if (codeChanges != null) {
        const [taskRow] = await db
          .select({
            projectId: tasks.projectId,
          })
          .from(executions)
          .innerJoin(tasks, eq(tasks.id, executions.taskId))
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(
            and(
              eq(executions.id, id),
              eq(projects.tenantId, c.get('tenantId')),
            ),
          )
          .limit(1);

        if (taskRow) {
          await db.insert(projectInsightEvents).values({
            tenantId: c.get('tenantId'),
            projectId: taskRow.projectId,
            userId: c.get('userId') as string,
            executionId: id,
            codeChanges,
          });
        }
      }
    }

    return c.json(execution.toPlain());
  });

  // Execution history for a specific task
  router.get('/tasks/:taskId/executions', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    const executions = await runtimeService.listByTask(taskId);
    return c.json(executions.map(e => e.toPlain()));
  });

  // GET /api/runtime/tasks/:taskId/cost
  // Ticket-level spend: the finest grain in the ticket → project → account
  // rollup (0104). Sums the authoritative cost_usd_millicents stamped on every
  // usage row for this task. Cached read-through (60s): an aggregate over the
  // append-heavy usage log that doesn't need to be to-the-second — same rationale
  // as /dashboard/usage; the short TTL bounds staleness without an
  // invalidate-on-every-LLM-call hook.
  router.get('/tasks/:taskId/cost', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    const tenantId = c.get('tenantId');
    if (!Number.isFinite(taskId)) return c.json({ estimatedCostUsd: 0, totalTokens: 0, requests: 0 });
    const payload = await getOrSetCached(
      c.env as Env,
      `task-cost:v1:${tenantId}:${taskId}`,
      async () => {
        const sql = neon((c.env as Env).NEON_DATABASE_URL);
        const rows = (await sql`
          SELECT COALESCE(SUM(cost_usd_millicents), 0)::bigint AS cost_mc,
                 COALESCE(SUM(total_tokens), 0)::bigint       AS tokens,
                 COUNT(*)::int                                 AS requests
            FROM llm_usage_log
           WHERE tenant_id = ${tenantId} AND task_id = ${taskId}
        `) as Array<{ cost_mc: string; tokens: string; requests: number }>;
        const r = rows[0];
        return {
          estimatedCostUsd: Number(r?.cost_mc ?? 0) / 100_000,
          totalTokens: Number(r?.tokens ?? 0),
          requests: Number(r?.requests ?? 0),
        };
      },
      { kvTtlSeconds: 60, l1TtlMs: 30_000 },
    );
    return c.json(payload);
  });

  // Per-agent file-change traceability for a task's shared ticket workspace.
  // A live tail (changes as agents run), so it is not cached; the Changes tab
  // polls it only while a run is in-flight. Tenant-scoped.
  router.get('/tasks/:taskId/file-changes', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ changes: [] });
    const sql = neon((c.env as Env).NEON_DATABASE_URL);
    const rows = (await sql`
      SELECT path, change, agent, execution_id AS "executionId", created_at AS "createdAt"
      FROM task_file_changes
      WHERE task_id = ${taskId} AND tenant_id = ${c.get('tenantId')}
      ORDER BY created_at DESC
      LIMIT 500
    `) as Array<{ path: string; change: string; agent: string; executionId: number | null; createdAt: string }>;
    return c.json({ changes: rows });
  });

  // GET /api/runtime/tasks/:taskId/file-content?path=<repo-relative path>
  // Reads one changed file's CURRENT (ticket branch) and BASE (fork point)
  // contents so the Changes tab can render it in a Monaco diff viewer — the same
  // way the IDE shows a change. The agent's `write_file` content is intentionally
  // not persisted as telemetry (runtimeRoutes write_file event strips it), so the
  // canonical source is the committed file on the branch, read back here with the
  // same provider read path the cloud agent's read_file tool uses.
  //
  // Cached read-through keyed by a version token (the latest recorded change ts
  // for this path): a fresh agent write bumps the token → next read is live;
  // after the run settles the content is stable and served from cache. Falls
  // through to a live read when the path has no recorded change row.
  router.get('/tasks/:taskId/file-content', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    const path = (c.req.query('path') ?? '').trim();
    if (!Number.isFinite(taskId) || !path) {
      return c.json({ bound: false, reason: 'taskId and path are required', path, current: null, base: null }, 400);
    }
    const env = c.env as Env;
    const tenantId = c.get('tenantId');

    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    if (!repo.ok) {
      return c.json({ bound: false, reason: repo.reason, path, current: null, base: null });
    }
    const ctx = repo.ctx;

    const load = async () => {
      // Read both refs in parallel: the ticket branch (current) and its base
      // (original). A 404 on either side is expected — created files have no base,
      // deleted files have no current — and surfaces as a null so the viewer can
      // pick add / delete / modify rendering.
      const [cur, base] = await Promise.all([
        readRepoFile({ ...ctx, ref: ctx.branch }, path),
        readRepoFile({ ...ctx, ref: ctx.base }, path),
      ]);
      return {
        bound: true,
        path,
        branch: ctx.branch,
        baseBranch: ctx.base,
        current: cur.ok ? cur.content : null,
        base: base.ok ? base.content : null,
        currentTruncated: cur.ok ? cur.truncated : false,
        baseTruncated: base.ok ? base.truncated : false,
      };
    };

    // Version token = newest change row for this path (null when unrecorded).
    const sql = neon(env.NEON_DATABASE_URL);
    const [ver] = (await sql`
      SELECT created_at AS "ts"
      FROM task_file_changes
      WHERE task_id = ${taskId} AND tenant_id = ${tenantId} AND path = ${path}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<{ ts: string }>;

    if (!ver?.ts) return c.json(await load());
    const body = await getOrSetCached(
      env,
      `task-file-content:${tenantId}:${taskId}:${path}:${ver.ts}`,
      load,
      { kvTtlSeconds: 600 },
    );
    return c.json(body);
  });

  // GET /api/runtime/tasks/:taskId/repo-status
  // Pre-run check for the Run control: can the agent actually commit code for this
  // task? Reuses the same resolution the cloud loop uses (repo bound + credential
  // decryptable), so the UI can warn "bind a repo + credential" before a run
  // silently degrades to a text-only summary. Intentionally uncached: repo binding
  // and credentials change interactively in Source Control, and a stale "not bound"
  // right after the user binds one would be a worse UX than this low-QPS check.
  router.get('/tasks/:taskId/repo-status', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ bound: false, hasCredential: false, reason: 'invalid task' }, 400);
    const r = await resolveTicketRepoContext(db, gitSecret(c.env as Env), c.get('tenantId'), taskId);
    if (r.ok) {
      return c.json({ bound: true, hasCredential: true, repo: `${r.ctx.owner}/${r.ctx.repo}`, base: r.ctx.base });
    }
    // resolveTicketRepoContext returns a single reason; distinguish "no repo" from
    // "no credential" so the UI can point at the right fix.
    const noRepo = /no repo bound/i.test(r.reason);
    return c.json({ bound: !noRepo, hasCredential: false, reason: r.reason });
  });

  // Broadcast an existing task to all currently connected agentHosts in the tenant.
  router.post('/tasks/:taskId/broadcast', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    const body = await c.req.json<{ payload?: string }>().catch((): { payload?: string } => ({}));

    const [taskRow] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(tasks.id, taskId),
          eq(projects.tenantId, c.get('tenantId')),
        ),
      );

    if (!taskRow) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const execution = await runtimeService.submit({
      taskId,
      tenantId: c.get('tenantId'),
      submittedBy: c.get('userId'),
      payload: body.payload,
    });

    const targets = await getDispatchTargets(db, c.get('tenantId'), null);
    const message: DispatchMessage = {
      type: 'task.broadcast',
      executionId: execution.id,
      taskId: taskRow.id,
      payload: body.payload,
      task: {
        title: taskRow.title,
        description: taskRow.description,
      },
    };

    const results = await Promise.all(targets.map(async (targetId) => ({
      agentHostId: targetId,
      delivered: await dispatchToAgentHost(c.env, targetId, message).catch(() => false),
    })));

    return c.json({
      execution: execution.toPlain(),
      dispatched: results,
    });
  });

  return router;
}
