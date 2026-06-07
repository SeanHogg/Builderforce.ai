import { Hono } from 'hono';
import type { Context } from 'hono';
import { neon } from '@neondatabase/serverless';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { RuntimeService } from '../../application/runtime/RuntimeService';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { ideProxy } from '../../application/llm/LlmProxyService';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, projectInsightEvents, projects, specs, tasks, toolAuditEvents, usageSnapshots } from '../../infrastructure/database/schema';
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

/** Extract the assistant text from a gateway chat-completion response. */
function extractCompletion(raw: unknown): string {
  const c = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0];
  return typeof c?.message?.content === 'string' ? c.message.content : '';
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
/** Associate a spec (PRD) with the task so it surfaces on the task's PRD tab. */
async function linkSpecToTask(db: Db, taskId: number, specId: string): Promise<void> {
  try {
    await db.update(tasks).set({ specId, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  } catch { /* best-effort */ }
}

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

async function ensureProjectPrd(
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
  let existingId: string | undefined;
  try {
    const [existing] = await db
      .select({ id: specs.id, prd: specs.prd })
      .from(specs)
      .where(and(eq(specs.tenantId, tenantId), eq(specs.projectId, projectId)))
      .orderBy(desc(specs.updatedAt))
      .limit(1);
    if (existing?.prd?.trim()) {
      if (existing.id) await linkSpecToTask(db, taskId, existing.id); // keep the task linked
      return existing.prd.trim(); // PRD already exists — reuse
    }
    existingId = existing?.id;
  } catch { /* fall through to generate */ }

  let prd = '';
  try {
    const gen = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: 'You are a senior product architect drafting the WIP Product Requirements Document (PRD) that every downstream agent on this task will share. Write a concise, well-structured PRD in GitHub-flavored markdown covering: Problem & Goal, Target users / ICP roles (if relevant), Scope, Functional requirements, Acceptance criteria, and Out of scope. Output ONLY the PRD markdown — no preamble and no bracketed placeholders.' },
        { role: 'user', content: `Task: ${taskRow.title}\n\n${taskRow.description ?? ''}`.trim() },
      ],
      ...(model ? { model } : {}),
      useCase: 'prd_generation',
    });
    if (gen.response.status < 400) prd = extractCompletion(await gen.response.json().catch(() => null));
  } catch { /* generation failed — return '' */ }

  prd = prd.trim();
  if (!prd) return '';

  const specId = existingId ?? crypto.randomUUID();
  try {
    const now = new Date();
    await db
      .insert(specs)
      .values({ id: specId, tenantId, projectId, goal: taskRow.title, status: 'draft', prd, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [specs.id], set: { prd, goal: taskRow.title, updatedAt: now } });
  } catch { /* persistence failed — still use the PRD as context below */ }

  // Associate the PRD with the task (PRD tab) and record it as the first
  // file change, attributed to the executing agent (durable, shows in Changes).
  await linkSpecToTask(db, taskId, specId);
  await recordTaskFileChange(env, tenantId, taskId, executionId, 'PRD.md', existingId ? 'modified' : 'created', agentLabel);

  // Best-effort live notifications (subject to cross-isolate WS delivery).
  notifyExecutionSubscribers(executionId, {
    type: 'file_change', executionId, path: 'PRD.md', change: existingId ? 'modified' : 'created', ts: new Date().toISOString(),
  });
  notifyExecutionSubscribers(executionId, {
    type: 'message', executionId, role: 'assistant',
    text: `📝 ${agentLabel} drafted the WIP **PRD** for this task and saved it — see the **PRD** tab. Proceeding with the deliverable against it.`,
    ts: new Date().toISOString(),
  });

  return prd;
}

/**
 * Run an execution server-side via the gateway when NO online agentHost took the
 * dispatch (Auto / cloud agent with no self-hosted runtime). Standard flow:
 * (1) ensure a PRD exists (generate + persist + emit as first change), then
 * (2) produce the deliverable honoring the PRD + project rules. Coding tasks that
 * need a real repo/runtime still belong on an agentHost. Never throws.
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
  payload?: string,
): Promise<void> {
  let model: string | undefined;
  try {
    const p = payload ? (JSON.parse(payload) as { model?: unknown }) : null;
    if (p && typeof p.model === 'string' && p.model.trim()) model = p.model.trim();
  } catch { /* payload not JSON — use default model */ }

  try {
    const running = await runtimeService.update(executionId, { status: ExecutionStatus.RUNNING });
    notifyExecutionSubscribers(executionId, {
      type: 'status_change',
      executionId,
      status: running.status,
      execution: running.toPlain(),
      ts: new Date().toISOString(),
    });

    // Step 1 — PRD-first. Step 2 — governance/arch context (parallel reads).
    const [prd, governance] = await Promise.all([
      ensureProjectPrd(env, db, executionId, taskRow, tenantId, projectId, taskRow.id, agentLabel, model),
      loadGovernanceContext(db, tenantId, projectId),
    ]);

    const userContent = [
      prd ? `## Product Requirements Document (PRD)\n\n${prd}` : null,
      governance || null,
      `## Your Task\n\n${taskRow.title}\n\n${taskRow.description ?? ''}`.trim(),
    ].filter(Boolean).join('\n\n---\n\n');
    const result = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: 'You are a BuilderForce agent executing a project task. Follow the PRD, architecture spec, and project rules provided below exactly. Produce the concrete, finished deliverable for the task — do NOT return a template with bracketed placeholders to be filled in later; where specifics are unknown, make explicit, reasonable assumptions and state them.' },
        { role: 'user', content: userContent },
      ],
      ...(model ? { model } : {}),
      useCase: 'task_execution',
    });
    // Debug trail for cloud runs: which model ran + the gateway trace id (so the
    // run is inspectable in the LLM-trace view even though there's no live stream).
    const debug = `[ran as ${result.resolvedModel ?? model ?? 'default'}${result.traceId ? ` · trace ${result.traceId}` : ''}]`;
    if (result.response.status >= 400) {
      const body = await result.response.text().catch(() => '');
      await runtimeService.update(executionId, {
        status: ExecutionStatus.FAILED,
        errorMessage: `Gateway ${result.response.status}: ${body.slice(0, 300)} ${debug}`.trim(),
      });
      return;
    }
    const text = extractCompletion(await result.response.json().catch(() => null));
    const output = text || `(no output produced) ${debug}`;
    notifyExecutionSubscribers(executionId, {
      type: 'message',
      executionId,
      role: 'assistant',
      text: output,
      ts: new Date().toISOString(),
    });
    await runtimeService.update(executionId, { status: ExecutionStatus.COMPLETED, result: output });
  } catch (e) {
    await runtimeService.update(executionId, {
      status: ExecutionStatus.FAILED,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Minimal structural shape of a domain Execution returned by RuntimeService. */
type SubmittedExecution = { id: number; status: string; toPlain(): unknown };

/**
 * Resolve the agent runtime engine for a run from its payload. When the run
 * targets a cloud agent (`payload.cloudAgentRef`), the engine is read from that
 * agent's `ide_agents` record (authoritative, tenant-scoped); otherwise V1.
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

async function resolveCloudAgent(
  env: Env,
  tenantId: number,
  payload: string | undefined,
): Promise<{ engine: string; label?: string; ref?: string }> {
  const ref = parseCloudAgentRef(payload);
  const DEFAULT = { engine: 'builderforce-v1' as const, ref };
  if (!ref) return DEFAULT;
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = (await sql`SELECT engine, name FROM ide_agents WHERE id = ${ref} AND tenant_id = ${tenantId} LIMIT 1`) as Array<{ engine?: string; name?: string }>;
    const engine = typeof rows[0]?.engine === 'string' && rows[0].engine ? rows[0].engine : 'builderforce-v1';
    const label = typeof rows[0]?.name === 'string' && rows[0].name ? rows[0].name : undefined;
    return { engine, label, ref };
  } catch {
    return DEFAULT;
  }
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
  const tenantId = c.get('tenantId');
  const targets = await getDispatchTargets(db, tenantId, taskRow.assignedAgentHostId);
  const dispatchType: DispatchMessage['type'] = taskRow.assignedAgentHostId != null ? 'task.assign' : 'task.broadcast';

  const [artifacts, agent, repoRef] = await Promise.all([
    resolveArtifacts(db, {
      tenantId,
      taskId: taskRow.id,
      agentHostId: taskRow.assignedAgentHostId ?? undefined,
    }),
    resolveCloudAgent(c.env as Env, tenantId, payload),
    resolveDefaultRepoForTask(db, tenantId, taskRow.id),
  ]);

  // Agents are first-class assignees: when a cloud agent runs the ticket, it
  // self-assigns as it starts the work.
  if (agent.ref) {
    await db.update(tasks).set({ assignedAgentRef: agent.ref, updatedAt: new Date() })
      .where(eq(tasks.id, taskRow.id)).catch(() => { /* best-effort */ });
  }

  const message: DispatchMessage = {
    type: dispatchType,
    executionId: execution.id,
    taskId: taskRow.id,
    payload,
    engine: agent.engine,
    agentLabel: agent.label,
    repo: repoRef ? { repoId: repoRef.repoId, defaultBranch: repoRef.defaultBranch } : undefined,
    task: { title: taskRow.title, description: taskRow.description },
    artifacts,
  };

  const delivered = (
    await Promise.all(targets.map((targetId) => dispatchToAgentHost(c.env, targetId, message).catch(() => false)))
  ).some(Boolean);

  if (!delivered) {
    // No online self-hosted agent took it → queue a background cloud run. The
    // 'done' notification is emitted by the background task when it settles.
    c.executionCtx.waitUntil((async () => {
      await runCloudExecution(c.env as Env, runtimeService, db, execution.id, taskRow, tenantId, taskRow.projectId, agent.label ?? 'BuilderForce Agent', payload);
      const updated = await runtimeService.getExecution(execution.id);
      notifyExecutionSubscribers(execution.id, {
        type: 'done',
        executionId: execution.id,
        status: updated.status,
        execution: updated.toPlain(),
        ts: new Date().toISOString(),
      });
    })());
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

    if (plain.agentHostId == null || !plain.sessionId) {
      return c.json({
        execution: plain,
        trace: {
          source: 'runtime-fallback',
          usageSnapshots: [],
          toolEvents: [],
        },
      });
    }

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
      .where(
        and(
          eq(usageSnapshots.tenantId, plain.tenantId),
          eq(usageSnapshots.agentHostId, plain.agentHostId),
          eq(usageSnapshots.sessionKey, plain.sessionId),
        ),
      )
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
      .where(
        and(
          eq(toolAuditEvents.tenantId, plain.tenantId),
          eq(toolAuditEvents.agentHostId, plain.agentHostId),
          eq(toolAuditEvents.sessionKey, plain.sessionId),
        ),
      )
      .orderBy(desc(toolAuditEvents.ts))
      .limit(500);

    return c.json({
      execution: plain,
      trace: {
        source: 'runtime-fallback',
        usageSnapshots: usage,
        toolEvents,
      },
    });
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

  // Cancel an execution
  router.post('/executions/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    const execution = await runtimeService.cancel(id, c.get('userId'));

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
  router.post('/executions/:id/messages', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
    const text = body.text?.trim();
    if (!text) return c.json({ error: 'text is required' }, 400);

    const execution = await runtimeService.getExecution(id).catch(() => null);
    if (!execution) return c.json({ error: 'Execution not found' }, 404);
    const plain = execution.toPlain() as { tenantId?: number; agentHostId?: number | null };
    if (plain.tenantId != null && plain.tenantId !== c.get('tenantId')) {
      return c.json({ error: 'Execution not found' }, 404);
    }

    if (plain.agentHostId != null) {
      const stub = c.env.AGENT_HOST_RELAY?.get(
        c.env.AGENT_HOST_RELAY.idFromName(String(plain.agentHostId)),
      );
      await stub?.fetch('https://relay.internal/execution-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: id, text }),
      }).catch(() => { /* best effort; subscribers still see the message */ });
    }

    notifyExecutionSubscribers(id, {
      type: 'message',
      executionId: id,
      role: 'user',
      text,
      ts: new Date().toISOString(),
    });

    return c.json({ ok: true });
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
