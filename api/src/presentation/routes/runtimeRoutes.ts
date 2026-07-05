import { Hono } from 'hono';
import type { Context } from 'hono';
import { neon } from '@neondatabase/serverless';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { resolveTicketRepoContext } from '../../application/repos/commitFileAsPendingChange';
import { readRepoFile } from '../../application/repos/readRepoContents';
import { importRepoContents } from '../../application/repos/importRepoContents';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { RuntimeService } from '../../application/runtime/RuntimeService';
import {
  resolveCloudSurface, chooseCloudExecutor, probeContainerHealth, cloudAgentTypeLabel,
  isTerminalExecutionStatus, parseCloudAgentRef, parseRepoId, buildFollowUpPayload, withDefaultModel, withExecutor,
} from '../../application/runtime/cloudDispatch';
import { mintContainerRunToken, verifyContainerRunToken } from '../../application/runtime/containerRunToken';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { enqueueExecutionMessage, listExecutionMessages, releasePendingSteers } from '../../application/runtime/executionSteering';
import { subscribeExecution, unsubscribeExecution, notifyExecutionSubscribers } from '../../application/runtime/executionEvents';
import {
  runCloudExecution, markCloudExecutionRunning, prepareCloudRun, gitSecret, recordCloudToolEvent, recordPrdDirective,
  handleContainerOp, loadContainerRunContext, resolveCloudAgent, agentAllowsHostExecution, DEFAULT_CLOUD_REF,
} from '../../application/runtime/cloudAgentEngine';
import { CONTAINER_MAX_STEPS } from '../../application/runtime/cloudAgentTools';
import { enforceCloudRunCap } from '../../application/runtime/cloudRunLedger';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import { millicentsToUsd } from '../../domain/shared/money';
import { parseJsonArray } from '../../domain/shared/json';
import type { Execution } from '../../domain/execution/Execution';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, boards, executions, projectInsightEvents, projectRepositories, projects, specs, tasks, toolAuditEvents, usageSnapshots } from '../../infrastructure/database/schema';
import { approvals } from '../../infrastructure/database/schema';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { resolveProjectInferenceModel } from '../../application/llm/projectEvermind';
import { executionTokenGate } from './executionTokenGate';

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

/** ide_agents.base_model sentinel meaning "no explicit model — use the default"
 *  (mirrors cloudAgentEngine.AGENT_DEFAULT_MODEL_SENTINEL). */
const AGENT_DEFAULT_MODEL_SENTINEL = 'builderforce-default';

/** Read-through cache key for a tenant's hired-agents runtime registry. Invalidated
 *  from the workforce hire/unhire routes. Exported so those routes stay DRY. */
export const runtimeHiredAgentsCacheKey = (tenantId: number): string => `rt:hired-agents:${tenantId}`;

/** A stable role handle for a hired agent — a slug of its name, falling back to its
 *  id so the runtime always has a usable, collision-resistant role key. */
function hiredAgentRoleKey(name: string | null | undefined, id: string): string {
  const slug = (name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || id;
}

/** Project a hired `ide_agents` row to the runtime's callable-role contract. */
function projectHiredAgent(r: { id: string; name: string | null; bio: string | null; skills: unknown; base_model: string | null }): {
  id: string; name: string; roleKey: string; systemPrompt: string; skills: string[]; model?: string;
} {
  const skills = parseJsonArray(r.skills).map(String);
  const rawModel = typeof r.base_model === 'string' ? r.base_model.trim() : '';
  const model = rawModel && rawModel !== AGENT_DEFAULT_MODEL_SENTINEL ? rawModel : undefined;
  return {
    id: r.id,
    name: r.name ?? r.id,
    roleKey: hiredAgentRoleKey(r.name, r.id),
    // No dedicated system_prompt column on ide_agents — `bio` holds the agent's
    // behavior/instructions text, so it is the best available projection.
    systemPrompt: r.bio ?? '',
    skills,
    ...(model ? { model } : {}),
  };
}

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
  /** users.id of the human who OWNS this ticket, if any. The swimlane agent that
   *  executes a stage must not seize ownership from an existing assignee (human or
   *  agent) — used to decide whether a run may claim an otherwise-unowned ticket. */
  assignedUserId: string | null;
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

/**
 * Whether running this task must first open a manager-approval request.
 *
 * Only HIGH/URGENT priority tickets are gated. A manager can OVERRIDE the gate
 * per board (boards.require_execution_approval = false) so high/urgent work on
 * that board runs without approval — see the board "Require manager approval"
 * setting. The board flag is read directly (not cached) so flipping the toggle
 * takes effect on the very next run rather than after a cache TTL; it is a single
 * indexed lookup on the manual-execution path, alongside the gate's own
 * uncached approvals query.
 */
async function requiresTaskExecutionApproval(db: Db, tenantId: number, task: ExecutionTaskRow): Promise<boolean> {
  if (task.priority !== 'high' && task.priority !== 'urgent') return false;

  const [board] = await db
    .select({ requireExecutionApproval: boards.requireExecutionApproval })
    .from(boards)
    .where(and(eq(boards.tenantId, tenantId), eq(boards.projectId, task.projectId)))
    .limit(1);

  // No board row yet → keep the default governance behaviour (gate on).
  return board?.requireExecutionApproval !== false;
}

/** Run context replayed when a `task.execution` approval is approved. */
export interface ApprovalReplay {
  taskId: number;
  /** The original submit payload (carries the cloud-agent ref + model + repo pin). */
  payload?: string;
  /** A per-run pinned host, if the gated run targeted one. */
  agentHostId?: number | null;
}

/**
 * Read the stored run context off a `task.execution` approval so approving it can
 * replay the original submit AS the same agent + model — the gate discards no run
 * detail (see {@link evaluateExecutionApprovalGate}). Returns null for approvals
 * without a parseable taskId (non-task.execution rows).
 */
export function parseApprovalReplay(metadata: string | null): ApprovalReplay | null {
  const taskId = parseApprovalTaskId(metadata);
  if (taskId == null || !metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { payload?: unknown; agentHostId?: unknown };
    const payload = typeof parsed.payload === 'string' ? parsed.payload : undefined;
    const agentHostId =
      typeof parsed.agentHostId === 'number' && Number.isFinite(parsed.agentHostId)
        ? parsed.agentHostId
        : null;
    return { taskId, payload, agentHostId };
  } catch {
    return { taskId };
  }
}

async function evaluateExecutionApprovalGate(
  db: Db,
  tenantId: number,
  requestedBy: string,
  task: ExecutionTaskRow,
  requestedAgentHostId: number | null,
  /** The original submit context, persisted so an approve replays the exact run. */
  submitContext?: { payload?: string },
): Promise<ExecutionApprovalGateResult> {
  if (!(await requiresTaskExecutionApproval(db, tenantId, task))) {
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
      // Persist the run context so approving the request replays the exact run
      // (as the same cloud agent + model + repo pin) — see parseApprovalReplay.
      payload: submitContext?.payload ?? null,
      agentHostId: task.assignedAgentHostId ?? requestedAgentHostId,
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


/** Minimal structural shape of a domain Execution returned by RuntimeService. */
type SubmittedExecution = { id: number; status: string; toPlain(): unknown };

/**
 * Resolve the runtime engine + display label for a cloud-agent run from its
 * `ide_agents.id`. The ref is the one the caller pinned, else the ticket's
 * assigned agent (see {@link dispatchAndQueue}). When a ref resolves, the name is
 * read from that agent's `ide_agents` record (authoritative, tenant-scoped); the
 * engine is always the current version (never read from the DB).
 *
 * One indexed lookup per execution-submit (not a hot read path), so it is not
 * cached. Never throws — falls back to the current engine with no label on any failure.
 */
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
  params: { taskId: number; tenantId: number; payload?: string; submittedBy?: string; agentHostId?: number | null },
): Promise<number | null> {
  const [taskRow] = await db
    .select({
      id: tasks.id, title: tasks.title, description: tasks.description,
      assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef,
      assignedUserId: tasks.assignedUserId,
      priority: tasks.priority, projectId: tasks.projectId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, params.taskId), eq(projects.tenantId, params.tenantId)))
    .limit(1);
  if (!taskRow) return null;

  // A per-run pinned host (e.g. an approved high-priority on-prem run) overrides
  // the task's assignee for THIS dispatch so host targeting survives the replay.
  const effectiveTaskRow = (params.agentHostId != null
    ? { ...taskRow, assignedAgentHostId: params.agentHostId }
    : taskRow) as ExecutionTaskRow;

  const execution = await runtimeService.submit({
    taskId: params.taskId,
    agentHostId: effectiveTaskRow.assignedAgentHostId ?? undefined,
    tenantId: params.tenantId,
    submittedBy: params.submittedBy ?? 'system:autofix',
    payload: params.payload,
  });
  await startDispatchedExecution(env, db, runtimeService, waitUntil, params.tenantId, execution as SubmittedExecution, effectiveTaskRow, params.payload);
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

  // The EXECUTING agent vs the ticket's OWNER are distinct roles. The swimlane's
  // agent works whatever stage (lane) the ticket is in — it executes AS itself
  // (resolved into `agent.ref` from the lane assignment / payload) and that run is
  // attributed to it via `executions.cloud_agent_ref`. But it must NOT seize
  // OWNERSHIP of the ticket: a ticket assigned to "bob" (an agent) during planning,
  // or to a human, stays assigned to them when a different lane agent runs a stage.
  // Self-assignment is therefore a CLAIM, only for a ticket that has no owner yet —
  // so the board shows who is working an otherwise-unowned ticket. Previously this
  // unconditionally overwrote `tasks.assignedAgentRef` with the executing agent,
  // clobbering the planned assignee every time a lane agent picked the ticket up.
  if (agent.ref) {
    const unowned = !taskRow.assignedAgentRef && taskRow.assignedAgentHostId == null && !taskRow.assignedUserId;
    await Promise.all([
      unowned
        ? db.update(tasks).set({ assignedAgentRef: agent.ref, updatedAt: new Date() })
            .where(eq(tasks.id, taskRow.id)).catch(() => { /* best-effort */ })
        : Promise.resolve(),
      // Always stamp the EXECUTION with the agent that ran it, so its logs/telemetry
      // stay scoped to THIS run even when ownership stays with someone else.
      db.update(executions).set({ cloudAgentRef: agent.ref })
        .where(eq(executions.id, execution.id)).catch(() => { /* best-effort */ }),
    ]);
  }

  // Fold the agent's own model into the payload up front so EVERY surface — the
  // on-prem host included — runs AS the agent's model, never silently the gateway
  // default. (The cloud branch reuses this same effective payload below.)
  //
  // Project Evermind consumer emitter (single point, all surfaces). When the agent
  // has NO explicit base model AND the project is configured to run on its own
  // self-learning model, default to the project's CURRENT Evermind head (a concrete
  // `evermind/<ref>`, resolved ONCE here — the run boundary → pull-on-boundary). Every
  // surface then agrees: the cloud loop hard-pins the `evermind/` route, on-prem sends
  // it to the gateway (which routes it to the evermind vendor). Precedence:
  // payload pin > agent.baseModel > project Evermind > gateway default. Off/unseeded →
  // undefined → today's behaviour. [[evermind-learning-architecture]]
  const projectEvermindPin = agent.baseModel
    ? undefined
    : await resolveProjectInferenceModel(env as Env, db, tenantId, taskRow.projectId);
  const effectivePayload = withDefaultModel(payload, agent.baseModel ?? projectEvermindPin);

  const message: DispatchMessage = {
    type: 'task.assign',
    executionId: execution.id,
    taskId: taskRow.id,
    payload: effectivePayload,
    engine: agent.engine,
    agentLabel: agent.label,
    repo: repoRef ? { repoId: repoRef.repoId, defaultBranch: repoRef.defaultBranch } : undefined,
    task: { title: taskRow.title, description: taskRow.description },
    artifacts,
  };

  // ONE agent engine (the V2 Agent) runs on three interchangeable long-lived
  // surfaces — see agent taxonomy ([[agent-types-taxonomy]]):
  //   • Durable Object (CloudRunnerDO)         — cloud, on-demand serverless.
  //   • Container (long-lived Cloudflare)      — cloud, persistent process + shell.
  //   • On-Prem machine                        — the client's machine, reached via
  //     the AGENT_HOST_RELAY. It is ALSO a long-lived runtime (equivalent to a
  //     container) and runs the SAME V2 Agent (Claude-Agent-SDK) the cloud surfaces
  //     do, so a V2 agent pinned to a host executes ON the machine — no engine fork.
  const surface = resolveCloudSurface(agent.runtimeSurface, pinnedHostId != null);
  const typeLabel = cloudAgentTypeLabel(surface);

  // Dispatch to an On-Prem host when one is explicitly pinned AND the agent's
  // declared `runtime_support` permits host execution (an agent marked cloud-only
  // is never delivered to a pinned host — it falls through to the cloud executor).
  // The engine no longer gates this: the on-prem host runtime runs the V2 Agent
  // natively, so V2 IS delivered to the machine (the surface is just where the one
  // engine runs). preferred_runtime (for runtime_support==='both') is resolved on
  // the swimlane path; here a host run still requires an explicit pin, so it cannot
  // route AWAY from a pinned host.
  const hostAllowed = agentAllowsHostExecution(agent.runtimeSupport);
  if (pinnedHostId != null && !hostAllowed) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
      toolName: 'runtime.route', category: 'planning',
      detail: { reason: 'agent runtime_support=cloud; pinned host ignored', pinnedHostId, ranOn: 'cloud' },
      result: `Agent "${agent.label ?? agent.ref ?? 'cloud agent'}" is cloud-only (runtime_support=cloud); the pinned On-Prem host was not used — running in the cloud.`,
    }).catch(() => { /* best-effort telemetry */ });
  }
  const delivered = pinnedHostId != null && hostAllowed
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
    // Cloud-compute gate: a cloud run executes on OUR infra (unlike on-prem/VSIX),
    // so it consumes the monthly "Cloud runs" allowance even when the tenant brings
    // their own model (BYO tokens are $0 to us, but the orchestration isn't). This
    // is the ONE choke point every cloud entry funnels through (Run-now, board,
    // autofix), so gating here covers them all. Over the cap → fail fast with an
    // upgrade hint rather than start a run we'd have to run for free. Superadmin /
    // unlimited plans pass; a metering error fails OPEN (never blocks a real run).
    const cloudGate = await enforceCloudRunCap(db, tenantId);
    if (!cloudGate.allowed) {
      const msg = `Monthly cloud-run allowance reached (${cloudGate.used}/${cloudGate.limit} on the ${cloudGate.effectivePlan} plan). Upgrade at builderforce.ai/pricing to run more cloud agents — on-prem and VS Code runs stay unlimited.`;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
        toolName: 'runtime.route', category: 'planning',
        detail: { reason: 'cloud_run_limit_exceeded', used: cloudGate.used, limit: cloudGate.limit, plan: cloudGate.effectivePlan },
        result: msg,
      }).catch(() => { /* best-effort telemetry */ });
      await runtimeService.update(execution.id, { status: ExecutionStatus.FAILED, errorMessage: msg }).catch(() => { /* terminal already */ });
      await notifyDone();
      return runtimeService.getExecution(execution.id).then((e) => e.toPlain()).catch(() => ({ id: execution.id, status: ExecutionStatus.FAILED }));
    }

    // Route a container-surface run to the REAL long-lived Cloudflare Container
    // (AgentContainerDO) when it's bound; everything else — a durable-surface run,
    // and a container run with no Container binding — runs on the durable executor
    // (CloudRunnerDO). The run carries its OWN model so it is never silently
    // attributed to the gateway default. (One engine: the V2 Agent; V1 is deleted.)
    const wantsContainer = surface === 'container';
    const hasContainerBinding = wantsContainer && !!env.AGENT_CONTAINER;
    const hasCloudRunner = !!env.CLOUD_RUNNER;

    // The payload the run is dispatched with. Once `orchestrate` resolves the executor
    // it re-stamps this (and the executions row) with `executor` so the orphan reaper /
    // read-path repair pick the right per-surface silence ceiling. The kickoff closures
    // read this variable (not `effectivePayload`) so they carry the stamped copy.
    let dispatchPayload = effectivePayload;

    const runWorkerFallback = async () => {
      await runCloudExecution(env, runtimeService, db, execution.id, taskRow, tenantId, taskRow.projectId, agent.label ?? 'BuilderForce Agent', agent.ref, dispatchPayload, artifacts);
      await notifyDone();
    };
    const startDurable = async () => {
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
            payload: dispatchPayload, artifacts,
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
    // Container executor — the caller (orchestrate) has already proved the container
    // is live via chooseCloudExecutor's health gate, so this just starts the run.
    // Any kickoff failure still degrades to the durable executor.
    const startContainer = async (stub: { fetch: (input: string, init?: RequestInit) => Promise<Response> }) => {
      try {
        const { systemPrompt, userContent } = await prepareCloudRun(
          env, db, execution.id, taskRow, tenantId, taskRow.projectId,
          agent.label ?? 'BuilderForce Agent', agent.baseModel, artifacts, agent.ref, dispatchPayload,
          { shell: true },
        );
        const token = await mintContainerRunToken(env.JWT_SECRET, execution.id);
        const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskRow.id);
        // Clone the ticket's HEAD branch (ctx.branch — where prior runs commit their
        // WIP), not just the base. A container that clones only the base branch starts
        // every run from a stale default and cannot see earlier passes' work; carrying
        // headBranch lets the container check it out and fall back to base on run #1
        // when the branch doesn't exist yet.
        const cloneSpec = repo.ok && repo.ctx.provider.startsWith('github')
          ? { cloneUrl: `https://x-access-token:${repo.ctx.token}@${repo.ctx.host}/${repo.ctx.owner}/${repo.ctx.repo}.git`, baseBranch: repo.ctx.base, headBranch: repo.ctx.branch }
          : null;
        const internalBaseUrl = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
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
        } else {
          // The container accepted the run and now drives the loop via callbacks to
          // /internal/container-op, which only flips the row at finalize. Without this
          // the execution would read PENDING for the whole live run. Mark it RUNNING
          // now — parity with the durable (CloudRunnerDO.start) and Worker
          // (runCloudExecution) executors, which both transition at kickoff.
          await markCloudExecutionRunning(runtimeService, execution.id);
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

    // Decide the executor INSIDE waitUntil: the container health probe is async and
    // must not block the submit response. The decision, the why-not-container note,
    // and the dispatch telemetry all reflect where the run ACTUALLY lands — not a
    // 202 that masks a dead container.
    const orchestrate = async () => {
      const stub = hasContainerBinding && env.AGENT_CONTAINER
        ? env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(`exec:${execution.id}`))
        : null;
      const containerHealthy = stub ? await probeContainerHealth(stub) : false;
      const executor = chooseCloudExecutor({ wantsContainer, hasContainerBinding, containerHealthy, hasCloudRunner });

      // Stamp the resolved executor onto the payload + the executions row so the orphan
      // reaper and read-path repair measure this run against the RIGHT silence ceiling:
      // a long-lived 'durable'/'container' run heartbeats once per alarm tick and a tick
      // spans one slow LLM step, so it must not be reaped at the serverless 90s wall
      // (execution #136). The row is what the reaper reads; the kickoff body carries the
      // same stamped copy so a self-heal re-dispatch keeps it.
      dispatchPayload = withExecutor(effectivePayload, executor);
      await db.update(executions).set({ payload: dispatchPayload })
        .where(eq(executions.id, execution.id)).catch(() => { /* best-effort — reaper falls back to the long-lived ceiling on an unstamped payload */ });

      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
        toolName: 'runtime.dispatch', category: 'planning',
        detail: { agentType: typeLabel, engine: agent.engine, surface, model: agent.baseModel ?? 'gateway-default', executor },
        result: `Dispatching ${typeLabel} to the ${executor} cloud executor (model: ${agent.baseModel ?? 'gateway default'}).`,
      });

      // Explain a container→durable/worker downgrade so the timeline shows WHY.
      if (wantsContainer && executor !== 'container') {
        const why = !hasContainerBinding ? 'no long-lived Cloudflare Container is bound' : 'the Cloudflare Container is not live (health probe failed)';
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { requestedSurface: 'container', ranOn: executor, reason: !hasContainerBinding ? 'no AGENT_CONTAINER binding' : 'container /health unreachable' },
          result: `${typeLabel}: ${why} — running on the ${executor} cloud executor instead, which executes the run to completion.`,
        });
      }

      if (executor === 'container' && stub) await startContainer(stub);
      else if (executor === 'durable') await startDurable();
      else await runWorkerFallback();
    };
    waitUntil(orchestrate());
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

/**
 * Load an execution ONLY if it belongs to the caller's tenant — the ownership guard for
 * every by-id execution read/mutate, so one tenant can't read/cancel/mutate another's
 * runs by guessing an execution/task id. Returns null (→ 404) on not-found or mismatch.
 */
async function loadOwnedExecution(
  c: Context<RuntimeHonoEnv>,
  runtimeService: RuntimeService,
  id: number,
): Promise<Execution | null> {
  if (!Number.isFinite(id)) return null;
  let execution: Execution;
  try {
    execution = await runtimeService.getExecution(id);
  } catch {
    return null;
  }
  return execution.toPlain().tenantId === c.get('tenantId') ? execution : null;
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
        assignedUserId: tasks.assignedUserId,
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

    // Token gate — no budget → no run (shared adapter, so Run-now + this path + the
    // board Run agree and the superadmin bypass is applied once). Fails open on a
    // scan error; superadmin / unlimited tenants pass through.
    const tokenBlock = await executionTokenGate(c, db);
    if (tokenBlock) return tokenBlock;

    const gate = await evaluateExecutionApprovalGate(
      db,
      c.get('tenantId'),
      c.get('userId'),
      taskRow,
      agentHostIdFromHeader ?? body.agentHostId ?? null,
      { payload: body.payload },
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
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);
    return c.json(owned.toPlain());
  });

  router.post('/tasks/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await loadOwnedExecution(c, runtimeService, id))) return c.json({ error: 'Execution not found' }, 404);
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
        assignedUserId: tasks.assignedUserId,
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

    // Token gate — no budget → no run (shared adapter, so Run-now + this path + the
    // board Run agree and the superadmin bypass is applied once). Fails open on a
    // scan error; superadmin / unlimited tenants pass through.
    const tokenBlock = await executionTokenGate(c, db);
    if (tokenBlock) return tokenBlock;

    const gate = await evaluateExecutionApprovalGate(
      db,
      c.get('tenantId'),
      c.get('userId'),
      taskRow,
      agentHostIdFromHeader ?? body.agentHostId ?? null,
      { payload: body.payload },
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

  // GET /api/runtime/hired-agents
  // The on-prem runtime fetches the tenant's HIRED agents to register them as
  // callable roles (agent-in-agent). Joins agent_purchases (active hires) to the
  // raw-SQL `ide_agents` workforce records and projects each agent's runnable
  // config. Authenticated by the same authMiddleware as every other runtime
  // endpoint — a tenant JWT OR an `agentHost:` runtime JWT, both of which resolve
  // c.get('tenantId'); the query is tenant-scoped on that.
  //
  // Contract (DO NOT change — another team codes against it):
  //   { agents: Array<{ id, name, roleKey, systemPrompt, skills: string[], model? }> }
  //
  // `ide_agents` has no dedicated system_prompt column, so `systemPrompt` projects
  // from the agent's `bio` (its behavior/instructions text). `roleKey` is a stable
  // slug derived from the name (falling back to the id) so the runtime has a stable
  // role handle. `model` is the agent's base_model unless it's the
  // "use the default" sentinel, in which case it is omitted. Read-through cached;
  // invalidated on hire/unhire (see workforceRoutes).
  router.get('/hired-agents', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await getOrSetCached(
      c.env as Env,
      runtimeHiredAgentsCacheKey(tenantId),
      () => neon(c.env.NEON_DATABASE_URL)`
        SELECT a.id, a.name, a.bio, a.skills, a.base_model
        FROM ide_agents a
        JOIN agent_purchases p ON p.agent_id = a.id
        WHERE p.tenant_id = ${tenantId} AND p.unhired_at IS NULL AND a.status = 'active'
        ORDER BY p.created_at DESC
        LIMIT 200
      ` as unknown as Promise<Array<{ id: string; name: string; bio: string | null; skills: unknown; base_model: string | null }>>,
    );

    const agents = rows.map((r) => projectHiredAgent(r));
    return c.json({ agents });
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
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);
    return c.json(owned.toPlain());
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
    // Only refs ACTIVE in the last 30 days — without this window a long-lived
    // busy tenant accrues an ever-growing chip list of every ref ever seen [1311].
    // (Still uncached by design: a debug surface that must reflect a run instantly,
    //  and caching would force a KV version-bump on the hot per-tool-call insert.)
    const activeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .selectDistinct({ ref: toolAuditEvents.cloudAgentRef })
      .from(toolAuditEvents)
      .where(and(
        eq(toolAuditEvents.tenantId, tenantId),
        isNull(toolAuditEvents.agentHostId),
        gte(toolAuditEvents.ts, activeSince),
      ));

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

    // Tenant-scope BEFORE streaming so a guessed execution id can't tap another
    // tenant's run status/result over the socket.
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) {
      server.send(JSON.stringify({ type: 'error', message: 'execution_not_found' }));
      server.close(1011, 'server_error');
      return new Response(null, { status: 101, webSocket: client });
    }
    server.send(JSON.stringify({
      type: 'status_change',
      executionId: id,
      status: owned.toPlain().status,
      execution: owned.toPlain(),
      ts: new Date().toISOString(),
    }));

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
    if (!(await loadOwnedExecution(c, runtimeService, id))) return c.json({ error: 'Execution not found' }, 404);
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
          .select({ id: tasks.id, title: tasks.title, description: tasks.description, assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef, assignedUserId: tasks.assignedUserId, priority: tasks.priority, projectId: tasks.projectId })
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

    // Build the follow-up payload BEFORE the gate so an approval persists (and
    // later replays) the run carrying this directive — not the bare prior payload.
    const followUpPayload = buildFollowUpPayload(plain.payload, { directive: text, priorExecutionId: id });

    const gate = await evaluateExecutionApprovalGate(db, tenantId, c.get('userId'), taskRow, plain.agentHostId ?? null, { payload: followUpPayload });
    if (!gate.allowed) {
      return c.json({ status: 'awaiting_approval', approvalId: gate.approvalId, taskId: taskRow.id, reason: gate.reason }, 202);
    }

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
    if (!(await loadOwnedExecution(c, runtimeService, id))) return c.json({ error: 'Execution not found' }, 404);
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
    const tenantId = c.get('tenantId');
    // Tenant-scope the result: listByTask is keyed only by taskId (a global serial),
    // so without this filter any authenticated tenant could read another tenant's
    // executions — including their result text — by guessing a taskId. The single-
    // execution and /trace endpoints already enforce this; mirror it here.
    const executions = await runtimeService.listByTask(taskId);
    return c.json(
      executions
        .map((e) => e.toPlain())
        .filter((e) => Number(e.tenantId) === Number(tenantId)),
    );
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
          estimatedCostUsd: millicentsToUsd(Number(r?.cost_mc ?? 0)),
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

  // GET /api/runtime/tasks/:taskId/repo-files
  // List the files on the task's AGENT WORKING BRANCH (the ticket branch the run
  // commits to), so the Brain composer's "Add context" can reference the agent's
  // in-progress workspace — not just the repo's default branch. Reads server-side
  // with the decrypted token via the SAME importRepoContents path the IDE hydrate
  // uses; the token never reaches the browser. Falls back to the base branch when
  // the ticket branch doesn't exist yet (a run that hasn't committed).
  //
  // Cached read-through keyed by a version token = the latest recorded file-change
  // ts for the task: a fresh agent write bumps the token → next read is live; a
  // settled run is served from cache, so re-opening the picker doesn't re-pull.
  router.get('/tasks/:taskId/repo-files', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ ok: false, reason: 'invalid task', files: [] }, 400);
    const env = c.env as Env;
    const tenantId = c.get('tenantId');

    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    if (!repo.ok) return c.json({ ok: false, reason: repo.reason, files: [] });
    const ctx = repo.ctx;

    const load = async () => {
      const read = { provider: ctx.provider, host: ctx.host, owner: ctx.owner, repo: ctx.repo, token: ctx.token };
      // Prefer the agent's working branch; a run that hasn't committed has no such
      // branch yet, so fall back to the base so the picker still shows the repo.
      let result = await importRepoContents({ ...read, ref: ctx.branch });
      let ref = ctx.branch;
      if (!result.ok) { result = await importRepoContents({ ...read, ref: ctx.base }); ref = ctx.base; }
      return {
        ok: result.ok,
        ref,
        branch: ctx.branch,
        base: ctx.base,
        files: result.files,
        truncated: result.truncated,
        ...(result.ok ? {} : { reason: result.error ?? 'Failed to read repository' }),
      };
    };

    // Version token = newest change row for this task (null when the run hasn't
    // written anything yet — then the branch content is stable at the base).
    const sql = neon(env.NEON_DATABASE_URL);
    const [ver] = (await sql`
      SELECT created_at AS "ts"
      FROM task_file_changes
      WHERE task_id = ${taskId} AND tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<{ ts: string }>;

    const body = await getOrSetCached(
      env,
      `task-repo-files:${tenantId}:${taskId}:${ctx.branch}:${ver?.ts ?? 'base'}`,
      load,
      { kvTtlSeconds: 300, l1TtlMs: 30_000 },
    );
    return c.json(body);
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
