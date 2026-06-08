import { Hono } from 'hono';
import type { Context } from 'hono';
import { neon } from '@neondatabase/serverless';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { commitPrdAsPendingChange } from '../../application/repos/commitPrdToRepo';
import { resolveTicketRepoContext, commitAgentFile, type TicketRepoContext } from '../../application/repos/commitFileAsPendingChange';
import { createPullRequest } from '../../application/repos/createPullRequest';
import { mergeBranchToBase } from '../../application/repos/mergeBranchToBase';
import { readRepoFile, listRepoFiles } from '../../application/repos/readRepoContents';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { RuntimeService } from '../../application/runtime/RuntimeService';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { loadCapabilityContext } from '../../application/artifact/capabilityContext';
import { ideProxy, type ChatMessage } from '../../application/llm/LlmProxyService';
import { recordUsageRow } from '../../application/llm/usageLedger';
import { ensureTaskPrdRecord } from '../../application/prd/taskPrd';
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

  const fileChange = status === 'updated' ? 'modified' : 'created';
  await recordTaskFileChange(env, tenantId, taskId, executionId, 'PRD.md', fileChange, agentLabel);

  // Land PRD.md as a real pending change on the ticket's git branch (branch + PR).
  const committed = await commitPrdAsPendingChange(db, gitSecret(env), tenantId, taskId, taskRow.title, prd, agentLabel);
  if (committed.ok) {
    // Surface the branch + PR on the ticket (Details shows the branch as a link).
    await db.update(tasks)
      .set({ gitBranch: committed.branch, ...(committed.prUrl ? { githubPrUrl: committed.prUrl, githubPrNumber: committed.prNumber ?? undefined } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .catch(() => { /* best-effort */ });
  }

  notifyExecutionSubscribers(executionId, {
    type: 'file_change', executionId, path: 'PRD.md', change: fileChange, ts: new Date().toISOString(),
  });
  notifyExecutionSubscribers(executionId, {
    type: 'message', executionId, role: 'assistant',
    text: committed.ok
      ? `📝 ${agentLabel} drafted the PRD and committed it to branch \`${committed.branch}\`${committed.prUrl ? ` — pending change: ${committed.prUrl}` : ' (pending change)'}. See the PRD tab + Changes.`
      : `📝 ${agentLabel} drafted the PRD (saved to the PRD tab). No git branch created: ${committed.reason}.`,
    ts: new Date().toISOString(),
  });

  return prd;
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
  args: { tenantId: number; cloudAgentRef?: string; executionId: number; model: string; inputTokens: number; outputTokens: number },
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
    metadata:   { engine: 'cloud', executionId: args.executionId },
    useCase:    'task_execution',
    attribution: { cloudAgentRef: args.cloudAgentRef ?? null, executionId: args.executionId },
  });
}

/** Synthetic cloud-agent ref for runs dispatched to the gateway default (no named
 *  cloud agent) — so their telemetry is still attributable to a chip on the
 *  Observability timeline. Shared with the frontend via the cloud-agents list. */
const DEFAULT_CLOUD_REF = '__default__';

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
      name: 'finish',
      description: 'Call when the task is complete. Provide a concise summary of what was delivered.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'What was delivered.' } },
        required: ['summary'],
      },
    },
  },
] as const;

// Read→edit→write workflows need more turns than a write-only loop. Each step is
// one gateway completion (~10-25s); 10 stays well under the cloud orphan ceiling
// (RuntimeService.CLOUD_ORPHAN_MS = 8 min) so a healthy run never trips the reaper.
const MAX_CLOUD_TOOL_STEPS = 10;

/**
 * The cloud agent's tool-executing loop. Drives the gateway with the toolset
 * above, executes each requested tool, feeds results back, and repeats until the
 * model calls `finish`, stops requesting tools, or the step cap is hit. Records a
 * per-iteration `llm.complete` event, a per-call tool event, and a usage snapshot
 * — so the timeline shows real tool execution. Never throws.
 */
async function runCloudToolLoop(
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
): Promise<{ ok: boolean; output: string; cancelled: boolean }> {
  const repoResolved = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskRow.id);
  const repoCtx: TicketRepoContext | null = repoResolved.ok ? repoResolved.ctx : null;
  const repoMiss = repoResolved.ok ? '' : repoResolved.reason;
  const writtenPaths = new Set<string>();

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  let finalOutput = '';
  let finished = false;
  let cancelled = false;

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
  for (let step = 0; step < MAX_CLOUD_TOOL_STEPS && !finished; step++) {
    // Between-step guard: stop before issuing the next (paid) call if cancelled.
    if (cancelled || abortController.signal.aborted || await isCancelled()) { cancelled = true; break; }
    const tGen0 = Date.now();
    let result: Awaited<ReturnType<ReturnType<typeof ideProxy>['complete']>>;
    try {
      result = await ideProxy(env).complete(
        {
          messages: messages as unknown as ChatMessage[],
          tools: CLOUD_AGENT_TOOLS,
          tool_choice: 'auto',
          ...(model ? { model } : {}),
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
    const resolvedModel = result.resolvedModel ?? model ?? 'default';
    if (result.usage) {
      await recordCloudUsage(env, db, {
        tenantId, cloudAgentRef, executionId, model: resolvedModel,
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
      return { ok: false, output: `Gateway ${result.response.status}: ${body.slice(0, 300)}`, cancelled };
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

    if (toolCalls.length === 0) { finished = true; break; }

    // Echo the assistant turn (with its tool_calls) so tool results attach to it.
    messages.push({ role: 'assistant', content, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name ?? 'unknown';
      let parsed: Record<string, unknown> = {};
      try { parsed = tc.function?.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {}; } catch { /* leave empty */ }
      const tStart = Date.now();
      let toolResult: Record<string, unknown>;

      if (name === 'list_files') {
        if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss})` };
        } else {
          const sub = typeof parsed.path === 'string' ? parsed.path : undefined;
          const ls = await listRepoFiles({ ...repoCtx, ref: repoCtx.branch }, sub);
          toolResult = ls.ok ? { ok: true, paths: ls.paths, truncated: ls.truncated } : { ok: false, error: ls.reason };
        }
      } else if (name === 'read_file') {
        const path = typeof parsed.path === 'string' ? parsed.path : '';
        if (!path) {
          toolResult = { ok: false, error: 'path is required' };
        } else if (!repoCtx) {
          toolResult = { ok: false, error: `no repo bound to this task (${repoMiss})` };
        } else {
          // Read from the ticket branch so the agent sees its own in-progress edits;
          // a not-yet-branched file falls back to base.
          const rf = await readRepoFile({ ...repoCtx, ref: writtenPaths.size > 0 ? repoCtx.branch : repoCtx.base }, path);
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
          const isNew = !writtenPaths.has(path);
          const commit = await commitAgentFile(repoCtx, path, fileContent, `${isNew ? 'Add' : 'Update'} ${path} — task #${taskRow.id} (${agentLabel})`);
          if (commit.ok) {
            writtenPaths.add(path);
            await recordTaskFileChange(env, tenantId, taskRow.id, executionId, path, isNew ? 'created' : 'modified', agentLabel);
            notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: isNew ? 'created' : 'modified', ts: new Date().toISOString() });
            toolResult = { ok: true, branch: repoCtx.branch, commitUrl: commit.commitUrl };
          } else {
            toolResult = { ok: false, error: commit.reason };
          }
        }
      } else if (name === 'finish') {
        const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
        if (summary) finalOutput = summary;
        finished = true;
        toolResult = { ok: true };
      } else {
        toolResult = { ok: false, error: `unknown tool '${name}'` };
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

  // Land the changes: open a PR for the record, then auto-merge the ticket branch
  // into the deploy branch (pushing to base is what triggers CI/deploy). Skipped
  // on cancel so a half-done run never merges to main.
  let prOpened = false;
  let merged = false;
  let mergeNote = '';
  if (repoCtx && writtenPaths.size > 0 && !cancelled) {
    const pr = await createPullRequest({
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
      title: `Task #${taskRow.id}: ${taskRow.title}`,
      body: `Changes for task #${taskRow.id}, by ${agentLabel}. Files: ${[...writtenPaths].join(', ')}.`,
    }).catch(() => ({ ok: false as const, code: 'provider_error' as const, reason: 'pr failed' }));
    prOpened = pr.ok;
    await db.update(tasks)
      .set({ gitBranch: repoCtx.branch, ...(pr.ok ? { githubPrUrl: pr.url, githubPrNumber: pr.number } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, taskRow.id))
      .catch(() => { /* best-effort */ });

    // Auto-merge to the deploy branch (full auto-merge + deploy policy).
    const m = await mergeBranchToBase({
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, base: repoCtx.base, head: repoCtx.branch,
      message: `Task #${taskRow.id}: ${taskRow.title} (BuilderForce auto-merge by ${agentLabel})`,
    });
    merged = m.ok;
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

  const output =
    finalOutput ||
    (writtenPaths.size > 0
      ? `Committed ${writtenPaths.size} file(s) to \`${repoCtx?.branch}\`${prOpened ? ', opened a PR' : ''}${mergeNote}.`
      : cancelled ? 'Run cancelled before any output was produced.' : '(no output produced)');
  // A failed merge is a real failure of the "ship it" contract — surface it.
  return { ok: !(prOpened && !merged), output, cancelled };
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

    // Step 1 — PRD-first. Step 2 — governance/arch context. Step 3 — assigned
    // capabilities (Skills/Personas/Content). All three are parallel reads.
    const tPrep0 = Date.now();
    const [prd, governance, capabilities] = await Promise.all([
      ensureTaskPrd(env, db, executionId, taskRow, tenantId, projectId, taskRow.id, agentLabel, model),
      loadGovernanceContext(db, tenantId, projectId),
      loadCapabilityContext(env, db, artifacts),
    ]);
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'context.prepare', category: 'planning',
      detail: { steps: ['prd', 'governance'] },
      result: `${prd ? 'PRD ready' : 'no PRD'} · ${governance ? 'governance loaded' : 'no governance'}`,
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

    const userContent = [
      prd ? `## Product Requirements Document (PRD)\n\n${prd}` : null,
      governance || null,
      `## Your Task\n\n${taskRow.title}\n\n${taskRow.description ?? ''}`.trim(),
    ].filter(Boolean).join('\n\n---\n\n');

    // Run the agent's tool-executing loop (both V1 and V2 cloud runs execute
    // tools here — the Worker has no shell, so tools are provider-API-backed:
    // write files to the ticket branch, then finish). Each step + tool call is
    // recorded to the timeline.
    const systemPrompt = [
      'You are a BuilderForce agent executing a project task against a real repository. Follow the PRD, architecture spec, and project rules exactly. ' +
      'Workflow: call list_files to discover the codebase, read_file to read any file you intend to change (preserve existing code — only change what the task needs), ' +
      'then write_file with the FULL updated content (no bracketed placeholders) for each deliverable file. Call finish with a summary when done. ' +
      'When you finish, your committed changes are automatically merged to the deploy branch and deployed — so make sure the code is complete and correct before calling finish. ' +
      'If no repository is bound, return the complete deliverable in your final summary instead. Make explicit, reasonable assumptions where specifics are unknown.',
      // Assigned Skills/Personas/Content — identity + capabilities steer best from
      // the system prompt, at parity with the self-hosted gateway injection.
      capabilities.promptBlock || null,
    ].filter(Boolean).join('\n\n');
    const { ok, output, cancelled } = await runCloudToolLoop(
      env, db, executionId, tenantId, taskRow, cloudAgentRef, agentLabel, model, systemPrompt, userContent, isCancelled,
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

async function resolveCloudAgent(
  env: Env,
  tenantId: number,
  ref: string | undefined,
): Promise<{ engine: string; label?: string; ref?: string }> {
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

  // The executing cloud agent is whoever the caller pinned in the payload, else
  // the ticket's assigned agent (the swimlane's agent — `tasks.assignedAgentRef`).
  // Without this fallback an "Auto" run on a ticket assigned to a custom cloud
  // agent silently executed + was attributed as the gateway default, not the
  // assigned agent. Used for BOTH per-agent capability resolution (scope='agent')
  // and run attribution (engine/label/ref).
  const cloudAgentRef = parseCloudAgentRef(payload) ?? taskRow.assignedAgentRef ?? undefined;
  const [artifacts, agent, repoRef] = await Promise.all([
    resolveArtifacts(db, {
      tenantId,
      taskId: taskRow.id,
      agentHostId: taskRow.assignedAgentHostId ?? undefined,
      cloudAgentRef,
    }),
    resolveCloudAgent(c.env as Env, tenantId, cloudAgentRef),
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
      await runCloudExecution(c.env as Env, runtimeService, db, execution.id, taskRow, tenantId, taskRow.projectId, agent.label ?? 'BuilderForce Agent', agent.ref, payload, artifacts);
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

    return c.json({
      execution: plain,
      trace: {
        source: isCloudRun ? 'cloud-telemetry' : 'runtime-fallback',
        usageSnapshots: usage,
        toolEvents,
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

    // DEFAULT_CLOUD_REF = cloud runs with no named agent (cloud_agent_ref IS NULL);
    // scope to cloud rows (agent_host_id IS NULL) so a host run never leaks in.
    const refCond =
      ref === DEFAULT_CLOUD_REF
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
