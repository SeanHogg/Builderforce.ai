import { integrationCredentialSecret } from '../../application/integrations/integrationCredentialSecret';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { dispatchGithubActionsRun, githubActionsAvailable } from '../../application/runtime/githubActionsDispatch';
import { resolveTicketRepoContext } from '../../application/repos/commitFileAsPendingChange';
import { readRepoFile } from '../../application/repos/readRepoContents';
import { importRepoContents } from '../../application/repos/importRepoContents';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { liveExecution } from '../../application/rehearsal/executionMode';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { RuntimeService } from '../../application/runtime/RuntimeService';
import {
  resolveCloudSurface, chooseCloudExecutor, probeContainerHealth, cloudAgentTypeLabel,
  isTerminalExecutionStatus, parseCloudAgentRef, parseRepoId, buildFollowUpPayload, withDefaultModel, withExecutor,
} from '../../application/runtime/cloudDispatch';
import { verifyContainerRunToken } from '../../application/runtime/containerRunToken';
import { launchContainerRun, type ContainerRunTarget } from '../../application/runtime/containerRunLauncher';
import { resumePausedExecution } from '../../application/runtime/executionResume';
import { answerOpenExecutionQuestions, DEFAULT_RESUME_ANSWER } from '../../application/runtime/executionPause';
import { synthesizeRunFailedEvent } from '../../application/runtime/toolAuditReadRepair';
import {
  capacityMessage, handlePreviewOp, mintPreviewForExecution, mintPreviewForProject, previewEnabled,
} from '../../application/runtime/previewDevServer';
import { checkPreviewCapacity } from '../../application/runtime/previewSessions';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { enqueueExecutionMessage, listExecutionMessages, releasePendingSteers } from '../../application/runtime/executionSteering';
import { listExecutionLlmTurns } from '../../application/llm/executionTraces';
import { executionUsageCost, taskUsageCost } from '../../application/llm/usageCostSummary';
import { notifyExecutionSubscribers } from '../../application/runtime/executionEvents';
import { broadcastExecutionEvent, executionRoomName } from '../../infrastructure/relay/broadcastRoom';
import { relayToRoom } from './realtimeRelay';
import {
  markCloudExecutionRunning, recordCloudToolEvent, recordPrdDirective,
  handleContainerOp, loadContainerRunContext, resolveCloudAgent, agentAllowsHostExecution, DEFAULT_CLOUD_REF,
} from '../../application/runtime/cloudAgentEngine';
import { resolveDefaultCloudAgentRef, UNATTRIBUTED_RUN_MESSAGE } from '../../application/runtime/defaultCloudAgent';
import {
  dispatchCloudRunForTask, startDispatchedExecution, getDispatchTargets, dispatchToAgentHost,
  type DispatchMessage, type ExecutionTaskRow, type SubmittedExecution,
} from '../../application/runtime/dispatchCloudRun';
import { recordAutoRunSkip, clearAutoRunSkip } from '../../application/runtime/autoRunSkipLedger';
import { enforceCloudRunCap, type CloudRunCapResult } from '../../application/runtime/cloudRunLedger';
import { assessRerunBackoff, AUTO_RUN_REASON_TEXT, type AutoRunReason } from '../../application/swimlane/evaluateAutoRun';
import { evaluateExecutionApprovalGate } from '../../application/runtime/executionApprovalGate';
import { revertRun } from '../../application/runtime/runRollback';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { unreadCountsForUser } from '../../application/brain/chatReadState';
import { ExecutionStatus, TenantRole } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import { parseBody, z, zNonEmptyString, zPositiveInt } from './requestBody';
import { parseJsonArray } from '../../domain/shared/json';
import type { Execution } from '../../domain/execution/Execution';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/featureGate';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, projectInsightEvents, projectRepositories, projects, specs, tasks, tenants, toolAuditEvents, usageSnapshots } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { approvals, chatTicketLinks, projectManagerConfigs } from '../../infrastructure/database/schema';
import { agentPurchases, ideAgents, taskFileChanges } from '../../infrastructure/database/schema';
import { readDispatchFileChanges } from '../../application/task/taskFileChangeFeed';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { resolveProjectInferenceModel } from '../../application/llm/projectEvermind';
import { executionTokenGate } from './executionTokenGate';
import { authorizeManagedTaskExecution } from '../../application/kanban/managedExecutionGuard';
import { markLifecycleNeutral, describeAuthority, MANAGED_OVERRIDE_EVENT } from '../../application/runtime/executionAuthority';
import { getTicketCoordination } from '../../application/coordination/coordinationCapability';
import { executeGitProxy } from '../../application/repos/gitProxy';
import { authorizeExecutionPrincipal } from '../../application/agentIdentity/agentRunIdentity';
import type { ExecutionReadMemo } from '../../application/runtime/executionReadMemo';
import { limitParam } from './queryParams';

/**
 * Runtime routes – task execution lifecycle.
 *
 * POST   /api/runtime/executions             – submit a task for execution
 * GET    /api/runtime/executions             – list executions (tenant-wide or filtered by sessionId)
 * GET    /api/runtime/sessions/:sessionId/executions – full execution timeline for a session
 * GET    /api/runtime/executions/:id         – get execution state
 * POST   /api/runtime/executions/:id/cancel  – cancel an execution
 * POST   /api/runtime/executions/:id/resume  – resume a run parked on `ask_human`
 * POST   /api/runtime/executions/cancel-all  – stop every live tenant execution
 * PATCH  /api/runtime/executions/:id/state   – agent callback: update state
 * GET    /api/runtime/tasks/:taskId/executions – history for a task
 * GET    /api/runtime/agents/:ref/tool-audit  – tool-audit timeline for one cloud agent
 *
 * AUTHORIZATION. Every route below `router.use('*', authMiddleware)` is tenant-
 * authenticated. On top of that, each route carries an explicit role gate:
 *   • READS (list / detail / timeline / cost / repo browsing) are member-level —
 *     no extra gate, a VIEWER may observe the fleet.
 *   • Anything that STARTS, cancels, steers, retries or reports on a billable run
 *     is `requireRole(TenantRole.DEVELOPER)` — the platform's "build and run
 *     agents" tier (see frontend ROLE_DESCRIPTION). This is what excludes a
 *     read-only VIEWER from spending the tenant's cloud-run + token allowance.
 *     It is deliberately NOT manager-level: the manager check for a run is the
 *     separate GOVERNANCE gate (evaluateExecutionApprovalGate), which stops
 *     high/urgent tickets and routes them to /api/approvals for MANAGER sign-off.
 *     Machine tokens minted for on-prem agent hosts carry DEVELOPER (see
 *     authRoutes agent-host key exchange), so host callbacks keep working.
 * System/cron callers (autonomousExecutionSweep → maybeAutoRunOnLaneEntry, the CI
 * auto-fix loop, incident/validation dispatch) never traverse these routes — they
 * call the exported `dispatchCloudRunForTask` directly and so are unaffected by
 * the gates. `/internal/container-op` is mounted ABOVE authMiddleware on purpose
 * and authenticates with its own per-run HMAC token.
 */
type RuntimeHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    AGENT_HOST_RELAY: DurableObjectNamespace<AgentHostRelayDO>;
  };
};

// The approval-gate primitives now live in the application layer so system callers
// (autonomous lane trigger / cron sweep) can apply the SAME gate without a request
// context — see application/runtime/executionApprovalGate.ts. Re-exported here
// because existing importers reference them through this module.
export { parseApprovalReplay, evaluateExecutionApprovalGate } from '../../application/runtime/executionApprovalGate';

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

// ── Request bodies ───────────────────────────────────────────────────────────

/** The container executor's delegated op; `args` is forwarded wholesale to the op handler. */
const ContainerOpBody = z.object({
  executionId: zPositiveInt,
  token: zNonEmptyString,
  op: zNonEmptyString,
  args: z.record(z.string(), z.unknown()).optional(),
});
const SessionBody = z.object({ sessionId: z.string().optional() });
/** Shared by the legacy `/tasks/submit` path and `/executions` — the same run start. */
const SubmitRunBody = z.object({
  taskId: zPositiveInt,
  agentId: zPositiveInt.optional(),
  agentRegistrationId: z.string().optional(),
  agentHostId: zPositiveInt.nullable().optional(),
  sessionId: z.string().optional(),
  payload: z.string().optional(),
});
const ExecutionControlBody = z.object({ enabled: z.boolean() });
const ResumeBody = z.object({ answer: z.string().optional() });
const MessageBody = z.object({ text: z.string().optional() });
const ExecutionStateBody = z.object({
  status: z.enum(ExecutionStatus),
  result: z.string().optional(),
  errorMessage: z.string().optional(),
  /** `normalizeCodeChanges` accepts a numeric string from older hosts. */
  codeChanges: z.union([z.number(), z.string()]).optional(),
});
const BroadcastBody = z.object({ payload: z.string().optional() });

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

interface CancelTenantExecutionsResult {
  requested: number;
  cancelled: number;
  failed: number[];
}

/** Cancel the tenant's live set through the canonical lifecycle and notify every
 * executor. The emergency switch includes paused runs so an old approval cannot
 * resume work while execution is disabled. */
async function cancelTenantExecutions(
  c: Context<RuntimeHonoEnv>,
  db: Db,
  runtimeService: RuntimeService,
  includePaused: boolean,
): Promise<CancelTenantExecutionsResult> {
  const tenantId = c.get('tenantId');
  const statuses = includePaused
    ? ['pending', 'submitted', 'running', 'paused'] as const
    : ['pending', 'submitted', 'running'] as const;
  const rows = await db
    .select({ id: executions.id, agentHostId: executions.agentHostId })
    .from(executions)
    .where(and(
      eq(executions.tenantId, tenantId),
      inArray(executions.status, [...statuses]),
      // The workspace switch stops autonomous/platform agents. Interactive
      // editor and Brain runs deliberately remain live; explicit Cancel all
      // (includePaused=false) still means every run.
      includePaused ? eq(executions.source, 'agent') : undefined,
      liveExecution(),
    ));

  const failed: number[] = [];
  let cancelled = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      const execution = await runtimeService.cancel(row.id, c.get('userId'));
      await releasePendingSteers(db, row.id);

      if (row.agentHostId != null) {
        const stub = c.env.AGENT_HOST_RELAY?.get(
          c.env.AGENT_HOST_RELAY.idFromName(String(row.agentHostId)),
        );
        await stub?.fetch('https://relay.internal/execution-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId: row.id }),
        }).catch((error) => reportCaughtError(error, { source: 'presentation/routes/runtimeRoutes.ts', operation: 'cancelTenantExecutions', context: { logMessage: '[runtime-cancel-all] host relay cancellation failed after status transition', details: { tenantId, executionId: row.id, error } } }));
      }

      notifyExecutionSubscribers(execution.id, {
        type: 'done', executionId: execution.id, status: execution.status,
        execution: execution.toPlain(), ts: new Date().toISOString(),
      });
      cancelled += 1;
    } catch (error) {
      failed.push(row.id);
      reportCaughtError(error, { source: 'presentation/routes/runtimeRoutes.ts', operation: 'cancelTenantExecutions', context: { logMessage: '[runtime-cancel-all] execution cancellation failed', details: { tenantId, executionId: row.id, error } } });
    }
  }));

  return { requested: rows.length, cancelled, failed };
}

export function createRuntimeRoutes(runtimeService: RuntimeService, db: Db): Hono<RuntimeHonoEnv> {
  const router = new Hono<RuntimeHonoEnv>();

  // Internal container-op endpoint — called by the long-lived Container executor
  // (AgentContainerDO), NOT by a browser/tenant. Registered BEFORE authMiddleware so
  // it bypasses tenant JWT auth and instead authenticates with the per-run token
  // (HMAC of the execution id). The container delegates each LLM step / commit /
  // finalize here so metering, commit, and PR logic stay server-side (one impl).
  router.post('/internal/container-op', async (c) => {
    const body = await parseBody(c, ContainerOpBody);
    const ok = await verifyContainerRunToken(c.env.JWT_SECRET, body.executionId, body.token);
    if (!ok) return c.json({ error: 'invalid run token' }, 403);
    const ctx = await loadContainerRunContext(c.env as Env, db, body.executionId);
    if (!ctx) return c.json({ error: 'execution not found' }, 404);
    if (!(await authorizeExecutionPrincipal(db, ctx.tenantId, body.executionId))) return c.json({ error: 'run credential expired or revoked' }, 403);
    // The dev-server step reports through its own op. Handled before the shared engine
    // because the preview vertical owns its lease/budget decisions end-to-end
    // (application/runtime/previewDevServer) — the route only delegates.
    if (body.op === 'preview') {
      const preview = await handlePreviewOp(
        c.env as Env, db, { tenantId: ctx.tenantId, executionId: body.executionId }, body.args ?? {},
      );
      return c.json(preview.body as Record<string, unknown>, preview.status as 200);
    }
    const res = await handleContainerOp(c.env as Env, db, runtimeService, ctx, body.executionId, body.op, body.args ?? {});
    return c.json(res.body as Record<string, unknown>, res.status as 200);
  });

  const containerGitProxy = async (c: Context<RuntimeHonoEnv>, subPath: string, method: 'GET' | 'POST'): Promise<Response> => {
    const executionId = Number(c.req.param('executionId'));
    const auth = c.req.header('Authorization') ?? '';
    let token = '';
    if (auth.startsWith('Basic ')) {
      try { token = atob(auth.slice(6)).split(':').slice(1).join(':'); } catch { token = ''; }
    }
    if (!Number.isFinite(executionId) || !token || !(await verifyContainerRunToken(c.env.JWT_SECRET, executionId, token))) return c.json({ error: 'invalid run credential' }, 403);
    const run = await loadContainerRunContext(c.env as Env, db, executionId);
    if (!run) return c.json({ error: 'execution not found' }, 404);
    if (!(await authorizeExecutionPrincipal(db, run.tenantId, executionId))) return c.json({ error: 'run credential expired or revoked' }, 403);
    const resolved = await resolveTicketRepoContext(db, integrationCredentialSecret(c.env as Env), run.tenantId, run.taskId);
    if (!resolved.ok) return c.json({ error: resolved.reason }, 400);
    const proxied = await executeGitProxy({
      repo: resolved.ctx, token: resolved.ctx.token, subPath, method,
      query: method === 'GET' ? new URL(c.req.url).searchParams.toString() : undefined,
      contentType: c.req.header('Content-Type'), body: method === 'POST' ? await c.req.arrayBuffer() : undefined,
    });
    return proxied.ok ? proxied.response : c.json({ error: proxied.error }, 400);
  };
  router.get('/internal/container-git/:executionId.git/info/refs', (c) => containerGitProxy(c, 'info/refs', 'GET'));
  router.post('/internal/container-git/:executionId.git/git-upload-pack', (c) => containerGitProxy(c, 'git-upload-pack', 'POST'));
  router.post('/internal/container-git/:executionId.git/git-receive-pack', (c) => containerGitProxy(c, 'git-receive-pack', 'POST'));

  router.use('*', authMiddleware);

  // Legacy compatibility (BuilderForce Link) ----------------------------------------------------
  // The original AgentHostLink transport adapter used /api/runtime/sessions and
  // /api/runtime/tasks/submit. These endpoints are kept for CLI/agent compatibility.

  // Mints a session handle for a run the caller is about to submit — part of the
  // dispatch path, so it carries the same run-tier gate as the submit itself.
  router.post('/sessions', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const body = await parseBody(c, SessionBody);
    const sessionId = body.sessionId ?? crypto.randomUUID();
    return c.json({ sessionId }, 201);
  });

  // STARTS a billable run (legacy BuilderForce Link submit path).
  router.post('/tasks/submit', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const body = await parseBody(c, SubmitRunBody);

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

    const authorization = await authorizeManagedTaskExecution(db, c.get('tenantId'), body.taskId, body.payload);
    if (!authorization.allowed) return c.json({ error: authorization.reason }, 409);

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
      agentRegistrationId: body.agentRegistrationId,
      agentHostId:      agentHostIdFromHeader ?? body.agentHostId,
      tenantId:    c.get('tenantId'),
      submittedBy: c.get('userId'),
      sessionId:   body.sessionId,
      payload:     body.payload,
      source:      c.get('clientSurface') === 'vscode' ? 'vscode' : 'agent',
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

  // CANCELS a run (legacy alias of /executions/:id/cancel).
  router.post('/tasks/:id/cancel', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await loadOwnedExecution(c, runtimeService, id))) return c.json({ error: 'Execution not found' }, 404);
    const execution = await runtimeService.cancel(id, c.get('userId'));
    return c.json(execution.toPlain());
  });

  // Submit a task for execution — the primary "start a billable run" entry point.
  router.post('/executions', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const body = await parseBody(c, SubmitRunBody);
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
      agentRegistrationId: body.agentRegistrationId,
      agentHostId:      agentHostIdFromHeader ?? body.agentHostId,
      tenantId:    c.get('tenantId'),
      submittedBy: c.get('userId'),
      sessionId:   body.sessionId,
      payload:     body.payload,
      source:      c.get('clientSurface') === 'vscode' ? 'vscode' : 'agent',
    });

    const result = await dispatchAndQueue(c, runtimeService, db, execution, taskRow, body.payload);
    return c.json(result, 201);
  });

  // List executions for the caller's tenant
  router.get('/executions', async (c) => {
    const limit = limitParam(c.req.query('limit'), 50, 500);
    const sessionId = (c.req.query('sessionId') ?? '').trim();
    const executions = sessionId
      ? await runtimeService.listBySession(c.get('tenantId'), sessionId, limit)
      : await runtimeService.listByTenant(c.get('tenantId'), limit);
    return c.json(executions.map(e => e.toPlain()));
  });

  // Tenant-level runtime dashboard aggregates derived from recent execution history.
  router.get('/dashboard', async (c) => {
    const tenantId = c.get('tenantId');
    const limit = limitParam(c.req.query('limit'), 500, 2000);
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
        .where(scopedToTenant(agentHosts, tenantId, inArray(agentHosts.id, agentHostIds)));
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
    const limit = limitParam(c.req.query('limit'), 200, 500);
    // `liveExecution()` — a rehearsal (0372) drives a real execution row but is a
    // probe rather than fleet activity, so it must not appear on the active-runs board.
    const rows = await db
      .select({
        id: executions.id,
        status: executions.status,
        taskId: executions.taskId,
        taskTitle: tasks.title,
        projectId: projects.id,
        projectName: projects.name,
        agentHostId: executions.agentHostId,
        cloudAgentRef: tasks.assignedAgentRef,
        agentName: sql<string | null>`coalesce(${agentHosts.name}, ${ideAgents.name})`,
        submittedBy: executions.submittedBy,
        startedAt: executions.startedAt,
        createdAt: executions.createdAt,
      })
      .from(executions)
      .innerJoin(tasks, eq(tasks.id, executions.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(agentHosts, eq(agentHosts.id, executions.agentHostId))
      .leftJoin(ideAgents, eq(ideAgents.id, tasks.assignedAgentRef))
      .where(and(eq(executions.tenantId, tenantId), inArray(executions.status, ['pending', 'submitted', 'running']), liveExecution()))
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

  // Persisted workspace execution override. This is deliberately separate from
  // manager autonomy: disabling it blocks manual Run-now, scheduled/cron work,
  // lane chaining, integrations, and every other RuntimeService.submit caller.
  router.get('/execution-control', async (c) => {
    const tenantId = c.get('tenantId');
    const [row] = await db.select({ enabled: tenants.agentExecutionEnabled })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) return c.json({ error: 'Workspace not found' }, 404);
    return c.json({ enabled: row.enabled });
  });

  router.put('/execution-control', requireRole(TenantRole.MANAGER) as never, async (c) => {
    const body = await parseBody(c, ExecutionControlBody);

    const tenantId = c.get('tenantId');
    const [row] = await db.update(tenants)
      .set({ agentExecutionEnabled: body.enabled, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ enabled: tenants.agentExecutionEnabled });
    if (!row) return c.json({ error: 'Workspace not found' }, 404);

    // Disable first, then drain. RuntimeService.submit observes FALSE while this
    // snapshot is being cancelled, so schedulers cannot refill the fleet.
    const stopped = body.enabled
      ? { requested: 0, cancelled: 0, failed: [] as number[] }
      : await cancelTenantExecutions(c, db, runtimeService, true);
    return c.json({ enabled: row.enabled, stopped });
  });

  // Master fleet stop. Resolve the tenant-scoped live set on the server and
  // cancel every run through the same lifecycle used by an individual cancel.
  router.post('/executions/cancel-all', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    return c.json(await cancelTenantExecutions(c, db, runtimeService, false));
  });

  // GET /api/runtime/attention  — the ONE cross-surface "what's live / what needs me"
  // aggregator. Every surface (web Brain chat list + FloatingBrain badge, the board,
  // the VS Code sessions/tasks trees, any modality) reads this SAME signal so a
  // session's status follows it everywhere the user multitasks — switching chats on
  // the web never changes whether the agent keeps executing in the background.
  //
  // Two derived states per work item, most-severe wins:
  //   'awaiting_input' — an execution is PAUSED on ask_human (a pending question/feedback
  //                      approval): a person must answer before it resumes.  [amber flag]
  //   'running'        — an execution is pending/submitted/running: actively executing. [blue/pulse]
  // (idle items are omitted entirely to keep the payload bounded.)
  //
  // Attribution: directly to the task via executions.task_id, and to a Brain chat via
  // chat_ticket_links (chat → task/epic/gap). Intentionally uncached — a live operational
  // surface that must reflect state this instant, same rationale as /active; it is three
  // indexed, bounded queries with no N+1, and every consumer polls it adaptively.
  router.get('/attention', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectIdRaw = c.req.query('projectId');
    const projectId = projectIdRaw ? Number(projectIdRaw) : undefined;
    const LIMIT = 500;

    // 1) Every non-terminal execution for the tenant (optionally one project), with its task.
    const execWhere = [eq(executions.tenantId, tenantId), inArray(executions.status, ['pending', 'submitted', 'running', 'paused']), liveExecution()];
    if (projectId != null && Number.isFinite(projectId)) execWhere.push(eq(tasks.projectId, projectId));
    const execRows = await db
      .select({ id: executions.id, taskId: executions.taskId, status: executions.status })
      .from(executions)
      .innerJoin(tasks, eq(tasks.id, executions.taskId))
      .where(and(...execWhere))
      .orderBy(desc(executions.createdAt))
      .limit(LIMIT);

    // 2) Pending human questions (ask_human) — the authoritative "needs an answer" rows.
    const approvalRows = await db
      .select({ id: approvals.id, executionId: approvals.executionId })
      .from(approvals)
      .where(and(
        eq(approvals.tenantId, tenantId),
        eq(approvals.status, 'pending'),
        inArray(approvals.kind, ['question', 'feedback']),
      ))
      .limit(LIMIT);

    // execId → taskId (only executions we actually surfaced above, so already project-scoped).
    const execTask = new Map<number, number>();
    for (const e of execRows) if (e.taskId != null) execTask.set(e.id, e.taskId);
    const approvalByExec = new Map<number, string>();
    for (const a of approvalRows) if (a.executionId != null) approvalByExec.set(a.executionId, a.id);

    // 3) Fold into per-task state (awaiting_input wins over running).
    type Item = { state: 'running' | 'awaiting_input'; executionId?: number; approvalId?: string };
    const taskState = new Map<number, Item>();
    const setState = (taskId: number, next: Item) => {
      const cur = taskState.get(taskId);
      if (!cur || (next.state === 'awaiting_input' && cur.state !== 'awaiting_input')) taskState.set(taskId, next);
      else if (cur.state === next.state && !cur.approvalId && next.approvalId) taskState.set(taskId, next);
    };
    for (const e of execRows) {
      if (e.taskId == null) continue;
      const approvalId = approvalByExec.get(e.id);
      // A paused run, or any run carrying a pending question, is awaiting a person.
      if (e.status === 'paused' || approvalId) setState(e.taskId, { state: 'awaiting_input', executionId: e.id, approvalId });
      else setState(e.taskId, { state: 'running', executionId: e.id });
    }

    // 4) Propagate task state onto the Brain chats linked to those tasks (chat_ticket_links).
    const taskIds = [...taskState.keys()];
    const chatState: Record<number, Item & { taskId: number }> = {};
    if (taskIds.length > 0) {
      const linkRows = await db
        .select({ chatId: chatTicketLinks.chatId, ticketRef: chatTicketLinks.ticketRef })
        .from(chatTicketLinks)
        .where(and(
          eq(chatTicketLinks.tenantId, tenantId),
          inArray(chatTicketLinks.ticketKind, ['task', 'epic', 'gap']),
          inArray(chatTicketLinks.ticketRef, taskIds.map(String)),
        ))
        .limit(LIMIT);
      for (const l of linkRows) {
        const taskId = Number(l.ticketRef);
        const item = taskState.get(taskId);
        if (!item) continue;
        const cur = chatState[l.chatId];
        if (!cur || (item.state === 'awaiting_input' && cur.state !== 'awaiting_input')) {
          chatState[l.chatId] = { ...item, taskId };
        }
      }
    }

    const tasksOut: Record<number, Item> = {};
    for (const [taskId, item] of taskState) tasksOut[taskId] = item;

    // 4b) Unread Brain chats for the caller — new messages (execution milestones,
    // a teammate/agent turn) in a chat the user has read before but isn't viewing.
    // Bounded, indexed grouped read via the shared read-state rule; global (not
    // project-scoped) because unread is inherently cross-project. Only for a real
    // user JWT (an agentHost runtime token has no userId, so it just sees {}).
    const userId = c.get('userId') as string | undefined;
    const chatUnread = userId
      ? await unreadCountsForUser(db, tenantId, userId).catch(() => ({} as Record<number, number>))
      : {};
    const unreadTotal = Object.values(chatUnread).reduce((a, b) => a + b, 0);

    // 5) AI Manager cadence — the freshest `last managed` stamp across the manager's
    // scope, so a human on ANY screen sees an ambient "Manager active" pulse when a
    // pass just ran (cron or manual). A manager can be scoped to one project OR the
    // whole tenant, so: project-scoped attention reads that project's stamp; the
    // tenant-wide view reads MAX(last_run_at) across all the tenant's managed
    // projects. One bounded aggregate — consistent with this endpoint's other reads.
    const mgrWhere = projectId != null && Number.isFinite(projectId)
      ? and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId))
      : eq(projectManagerConfigs.tenantId, tenantId);
    const [mgrRow] = await db
      .select({ lastRunAt: sql<Date | null>`max(${projectManagerConfigs.lastRunAt})` })
      .from(projectManagerConfigs)
      .where(mgrWhere);
    const lastRunAt = mgrRow?.lastRunAt ? new Date(mgrRow.lastRunAt) : null;
    // "Active" = a pass landed within the last 3 min (the cron cadence is 5 min, a
    // pass is seconds long, so this reads as "the manager is working on schedule").
    const recentlyActive = lastRunAt != null && Date.now() - lastRunAt.getTime() < 3 * 60_000;

    return c.json({
      tasks: tasksOut,
      chats: chatState,
      chatUnread,
      counts: {
        running: [...taskState.values()].filter((i) => i.state === 'running').length,
        awaiting: [...taskState.values()].filter((i) => i.state === 'awaiting_input').length,
        unread: unreadTotal,
      },
      manager: { lastRunAt: lastRunAt ? lastRunAt.toISOString() : null, recentlyActive },
    });
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
      // Projected with the ORIGINAL snake_case `base_model` key: the contract above
      // (and the KV-cached payload) is read by projectHiredAgent, so the shape must
      // not drift to Drizzle's camelCase.
      // `unhired_at` (migration 0101, the soft-delete marker) is not declared on the
      // Drizzle `agentPurchases` table, so the predicate stays a raw fragment.
      async () => db
        .select({
          id: ideAgents.id,
          name: ideAgents.name,
          bio: ideAgents.bio,
          skills: ideAgents.skills,
          base_model: ideAgents.baseModel,
        })
        .from(ideAgents)
        .innerJoin(agentPurchases, eq(agentPurchases.agentId, ideAgents.id))
        .where(and(
          eq(agentPurchases.tenantId, tenantId),
          sql`${agentPurchases}.unhired_at is null`,
          eq(ideAgents.status, 'active'),
        ))
        .orderBy(desc(agentPurchases.createdAt))
        .limit(200),
    );

    const agents = rows.map((r) => projectHiredAgent(r));
    return c.json({ agents });
  });

  // Full execution timeline for one session (newest first)
  router.get('/sessions/:sessionId/executions', async (c) => {
    const sessionId = c.req.param('sessionId').trim();
    const limit = limitParam(c.req.query('limit'), 200, 500);
    if (!sessionId) {
      return c.json({ error: 'sessionId is required' }, 400);
    }
    const executions = await runtimeService.listBySession(c.get('tenantId'), sessionId, limit);
    return c.json({ sessionId, executions: executions.map((e) => e.toPlain()) });
  });

  // Get a single execution by ID
  router.get('/executions/:id/coordination', async (c) => {
    const executionId = Number(c.req.param('id'));
    if (!Number.isFinite(executionId)) return c.json({ error: 'invalid execution id' }, 400);
    const tenantId = c.get('tenantId');
    const [run] = await db.select({ taskId: executions.taskId }).from(executions).where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId))).limit(1);
    if (!run) return c.json({ error: 'execution not found' }, 404);
    const coordination = await getTicketCoordination(c.env, db, tenantId, run.taskId);
    return coordination ? c.json(coordination) : c.json({ error: 'ticket not found' }, 404);
  });

  router.get('/executions/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);
    return c.json(owned.toPlain());
  });

  // Legacy telemetry / trace endpoints (used by some older integrations)
  // WRITES metered usage rows for a run (agent-host callback; host machine tokens
  // carry DEVELOPER). Not a read — a viewer must not be able to forge usage.
  router.post('/executions/:id/telemetry', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
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

    // The run's LLM turns as STRUCTURED rows (0949): resolved model, vendor, token
    // counts, duration, and the trace id each turn can be looked up by. Previously
    // the only per-turn model evidence was a JSON `args` blob on the tool-audit
    // event, and the trace id it carried resolved to nothing.
    const llmTurns = await listExecutionLlmTurns(c.env as Env, plain.tenantId, id);
    // The run's OWN spend (every usage row stamped with this execution_id) — the
    // per-run figure beside the per-ticket and per-turn ones the drawer already shows.
    const cost = await executionUsageCost(c.env as Env, db, plain.tenantId, id);

    return c.json({
      execution: plain,
      trace: {
        source: isCloudRun ? 'cloud-telemetry' : 'runtime-fallback',
        usageSnapshots: usage,
        toolEvents,
        messages,
        llmTurns,
        cost,
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

    // Resolve display names from the ide_agents table (best-effort).
    const nameByRef = new Map<string, string>();
    if (namedRefs.length > 0) {
      try {
        const named = await db
          .select({ id: ideAgents.id, name: ideAgents.name })
          .from(ideAgents)
          .where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, namedRefs)));
        for (const n of named) nameByRef.set(String(n.id), n.name);
      } catch (error) {
        reportCaughtError(error, { source: "presentation/routes/runtimeRoutes.ts", operation: "createRuntimeRoutes", level: 'warning', context: { logMessage: '[runtime-tool-audit] agent display-name resolution failed; using refs', details: { tenantId, agentRefs: namedRefs, error } } });
      }
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
    const limit = limitParam(c.req.query('limit'), 200, 500);
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

    // Read-path repair (shared with the host tool-audit read): when scoped to one
    // execution, surface a terminal `run.failed` synthesized from the execution row
    // for a run that failed without emitting the telemetry event. Events are newest-
    // first here, so the failure prepends.
    if (executionId != null) {
      const synthetic = await synthesizeRunFailedEvent(db, tenantId, executionId, events);
      if (synthetic) events.unshift(synthetic);
    }

    return c.json({ events });
  });

  // Live container-preview URL for a run (Replit-parity phase 2, flag-gated). Mints a
  // signed, time-limited URL that proxies to the dev server the run started inside its
  // container (see application/runtime/previewDevServer). 404 unless
  // PREVIEW_INGRESS_ENABLED is set, so the endpoint is inert until an operator turns the
  // feature on. Tenant-scoped via loadOwnedExecution so a guessed id can't mint another
  // tenant's preview, and PAID-PLAN gated through the one shared evaluator (402 on a
  // miss) because a preview pins a container instance open for as long as it is watched.
  router.get('/executions/:id/preview-url', async (c) => {
    if (!previewEnabled(c.env)) return c.json({ error: 'Live preview is not enabled.' }, 404);
    // The runtime router widens Bindings with AGENT_HOST_RELAY; the shared gate is typed
    // against the base HonoEnv, so the context is narrowed at the call (same shape, one
    // extra binding the gate never reads).
    const gate = await requireFeature(c as unknown as Context<HonoEnv>, 'livePreview');
    if (gate) return gate;
    const id = Number(c.req.param('id'));
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);

    const tenantId = c.get('tenantId') as number;
    const capacity = await checkPreviewCapacity(db, tenantId, id);
    if (!capacity.ok) return c.json({ error: capacityMessage(capacity), reason: capacity.reason }, 429);

    const mint = await mintPreviewForExecution(c.env as Env, db, tenantId, id);
    if (!mint.available) {
      return c.json({ available: false, ...(mint.detail ? { detail: mint.detail } : {}) });
    }
    return c.json({
      available: true, url: mint.url, expiresInSeconds: mint.expiresInSeconds, status: mint.status,
    });
  });

  // The SAME mint, addressed by project — what "Preview on your phone" has to work with
  // (the panel knows the project it is editing, never an execution id). Resolves the
  // project's live preview lease and delegates to the identical minting path, so the two
  // entry points can never hand out differently-scoped URLs.
  router.get('/projects/:projectId/preview-url', async (c) => {
    if (!previewEnabled(c.env)) return c.json({ error: 'Live preview is not enabled.' }, 404);
    // The runtime router widens Bindings with AGENT_HOST_RELAY; the shared gate is typed
    // against the base HonoEnv, so the context is narrowed at the call (same shape, one
    // extra binding the gate never reads).
    const gate = await requireFeature(c as unknown as Context<HonoEnv>, 'livePreview');
    if (gate) return gate;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);
    const mint = await mintPreviewForProject(c.env as Env, db, c.get('tenantId') as number, projectId);
    if (!mint.available) {
      return c.json({ available: false, ...(mint.detail ? { detail: mint.detail } : {}) });
    }
    return c.json({
      available: true, url: mint.url, expiresInSeconds: mint.expiresInSeconds, status: mint.status,
    });
  });

  /**
   * Live stream for ONE execution — status_change / done / message / file_change /
   * tool_event frames, as they happen.
   *
   * TRANSPORT: WebSocket, not SSE. Not a preference — the client already speaks this
   * protocol (`useExecutionStream`), the steering/relay surfaces around it are WS, and
   * a Worker cannot hold an SSE response open across isolates without exactly the
   * Durable Object this route now uses. Given the DO is required either way, WS reuses
   * the room primitive (`SessionRoomDO`) that already fans frames out to poker, retro,
   * brain-chat, canvas and project-board sockets, instead of adding a second, weaker
   * one-way transport.
   *
   * The socket is held by the run's DO room, NOT by this isolate. That is the whole
   * fix: the subscriber registry used to be a per-isolate `Map`, so a cloud run
   * emitting from another isolate (a tool loop, the durable runner's alarm, the crash
   * reaper) reached nobody and the UI had to poll tool-audit behind a Refresh button.
   * Any isolate can publish into the room; any isolate can attach a socket to it.
   *
   * AUTHORISATION IS HERE, and it is why the room id needs no tenant prefix: the
   * upgrade is relayed ONLY after `loadOwnedExecution` proves this tenant owns the
   * run, so a guessed execution id cannot reach another tenant's stream.
   */
  router.get('/executions/:id/stream', async (c) => {
    if (c.req.header('Upgrade') !== 'websocket') {
      return c.text('This endpoint requires a WebSocket upgrade.', 426);
    }

    const id = Number(c.req.param('id'));
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);

    // The runtime router widens Bindings with AGENT_HOST_RELAY; the shared relay is
    // typed against the base HonoEnv, so the context is narrowed at the call (same
    // shape, one extra binding the relay never reads) — as `requireFeature` does above.
    const response = await relayToRoom(c as unknown as Context<HonoEnv>, c.env?.SESSION_ROOM, executionRoomName(id));

    // Hand the newly attached client the run's CURRENT state, so a socket opened
    // mid-run doesn't sit blank until the next transition. It goes through the room
    // (this isolate no longer holds the socket); other watchers get a redundant but
    // idempotent snapshot of the row they are already showing.
    if (response.status === 101) {
      c.executionCtx.waitUntil(broadcastExecutionEvent(c.env?.SESSION_ROOM, id, JSON.stringify({
        type: 'status_change',
        executionId: id,
        status: owned.toPlain().status,
        execution: owned.toPlain(),
        ts: new Date().toISOString(),
      })));
    }
    return response;
  });

  // Cancel an execution. Beyond flipping the DB row to CANCELLED, this actually
  // STOPS the work: self-hosted runs get an `execution.cancel` frame relayed to
  // the host (which aborts the live session); cloud runs are halted by the
  // background loop's per-step cancel poll (see runCloudToolLoop). Without this,
  // cancel was cosmetic and the agent kept burning tokens to completion.
  router.post('/executions/:id/cancel', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
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
      }).catch((error) => reportCaughtError(error, { source: "presentation/routes/runtimeRoutes.ts", operation: "createRuntimeRoutes", context: { logMessage: '[runtime-cancel] host relay cancellation failed after status transition', details: { tenantId: c.get('tenantId'), executionId: id, error } } }));
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

  /**
   * RESUME a run parked on `ask_human` — directly, without answering the approval.
   *
   * The approvals queue is the primary door (a human answers the question and the
   * answer resumes the run). This is the second one, and it exists because the
   * execution chip has always RENDERED a resume glyph for a paused run while the
   * only action wired behind it was `submitExecution` — i.e. a brand-new billable
   * run that threw away the paused conversation, the ticket branch context and the
   * open question. The affordance said resume and did retry.
   *
   * `answer` is optional: with one, this is exactly the approvals path (the answer
   * is delivered as a pending user turn and any outstanding question is closed);
   * without one, it is "carry on, you have what you need", which is a legitimate
   * response to an agent that asked something the user considers already settled.
   *
   * Refuses anything that is not paused — a live run does not need resuming and a
   * terminal one cannot be, and silently re-running either is the bug this fixes.
   */
  router.post('/executions/:id/resume', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const id = Number(c.req.param('id'));
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);
    if (owned.status !== ExecutionStatus.PAUSED) {
      return c.json({
        error: isTerminalExecutionStatus(owned.status)
          ? 'This run has already finished — start a new run instead of resuming it.'
          : 'This run is still working; there is nothing to resume.',
        refusal: 'run_not_paused',
      }, 409);
    }
    const body = await parseBody(c, ResumeBody);
    const answer = body.answer?.trim() || DEFAULT_RESUME_ANSWER;
    const tenantId = c.get('tenantId');

    // Close the outstanding question the same way answering it would, so the
    // human-requests queue does not keep asking for something already handled.
    await answerOpenExecutionQuestions(db, { tenantId, executionId: id, answer, userId: c.get('userId') });

    await resumePausedExecution(c.env as Env, db, { executionId: id, tenantId, answer, runtimeService });
    const updated = await runtimeService.getExecution(id).catch(() => null);
    return c.json({ ok: true, resumed: true, execution: updated?.toPlain() ?? null });
  });

  // Revert a completed run: close the pull request it opened and delete the ticket
  // branch it wrote, once the shared teardown decision can PROVE nothing else
  // touched them. If the run's PR already MERGED there is nothing on a branch left
  // to undo, so the revert escalates to opening a revert pull request against the
  // base (`mode: 'revert_pr'` — a proposal, applied only when a human merges it).
  // Refusals (advanced branch, foreign commits/paths, unreadable evidence, a
  // conflict with newer work, a provider that cannot revert) come back as a 409
  // carrying the reason verbatim so the UI can explain exactly what blocked it.
  //
  // MANAGER — not the DEVELOPER tier the rest of this file's dispatch routes use.
  // Starting a run is a developer's job; DESTROYING the output of one, including
  // commits a human may have reviewed, is a governance action.
  router.post('/executions/:id/revert', requireRole(TenantRole.MANAGER) as never, async (c) => {
    const id = Number(c.req.param('id'));
    const owned = await loadOwnedExecution(c, runtimeService, id);
    if (!owned) return c.json({ error: 'Execution not found' }, 404);

    // Only a settled run can be reverted — a live one is still writing, so cancel
    // it first (which routes into the automatic teardown sweep instead).
    if (!isTerminalExecutionStatus(owned.status)) {
      return c.json({ error: 'Only a finished run can be reverted — cancel it first.', refusal: 'run_not_terminal' }, 409);
    }

    const outcome = await revertRun(c.env, db, {
      tenantId: c.get('tenantId'),
      executionId: id,
      actor: await resolveActorFromContext(c.env, db, c as unknown as Context<HonoEnv>),
      secret: integrationCredentialSecret(c.env),
    });
    if (!outcome.reverted) {
      return c.json({ error: outcome.reason, refusal: outcome.refusal }, 409);
    }
    return c.json(outcome);
  });

  // Send a follow-up direction to a running/queued execution so the user can
  // steer it mid-run. The message is broadcast to the execution's stream
  // subscribers immediately. For self-hosted runs it is also relayed to the
  // assigned agentHost (which feeds it into the live agent session as the next
  // turn). Cloud completions are one-shot today — see gap register for resume.
  // "Send" on an execution's Output tab. Three behaviours, one per run state:
  //   • RUNNING / queued → STEER it: persist the directive as a pending user turn
  //     (the cloud agent loop — durable / container / Actions — drains it on its
  //     next step; a self-hosted host also gets it relayed) and record it as a PRD
  //     revision so the spec evolves with the run.
  //   • PAUSED (waiting on a human) → the message IS the answer: close the open
  //     question and RESUME the parked run. Queuing alone was a silent dead end —
  //     nothing was running to drain the steer.
  //   • TERMINAL (completed/failed/cancelled) → there is no live session to steer,
  //     so START A NEW run seeded with the directive as the headline instruction
  //     (built on the prior run's committed work + the evolved PRD), and return the
  //     new execution id so the UI can follow it. This replaces the old silent
  //     no-op, which only ever forwarded to a live host and dropped everything else.
  // STEERS a live run, RESUMES a paused one, and on a terminal run STARTS a
  // brand-new billable one.
  router.post('/executions/:id/messages', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const id = Number(c.req.param('id'));
    const body = await parseBody(c, MessageBody);
    const text = body.text?.trim();
    if (!text) return c.json({ error: 'text is required' }, 400);

    const execution = await runtimeService.getExecution(id).catch(() => null);
    if (!execution) return c.json({ error: 'Execution not found' }, 404);
    const plain = execution.toPlain() as { tenantId?: number; agentHostId?: number | null; status?: string; taskId?: number; payload?: string | null; cloudAgentRef?: string | null; source?: 'agent' | 'vscode' | 'brain' };
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

    if (plain.status === ExecutionStatus.PAUSED) {
      // ── Answer the question AND wake the run ────────────────────────────────
      // A paused run is not terminal, so this used to take the steer branch below:
      // the directive was queued and then nothing ever ran to drain it. Waiting on a
      // human is precisely the state where "Send" must do more than enqueue — the
      // message IS the answer, so it closes the open question and resumes the run on
      // whichever surface parked it. `resumePausedExecution` owns the enqueue, the
      // stream echo, the lane restore and the wake, so nothing here duplicates it.
      await answerOpenExecutionQuestions(db, { tenantId, executionId: id, answer: text, userId: c.get('userId') });
      await resumePausedExecution(c.env as Env, db, { executionId: id, tenantId, answer: text, runtimeService });

      if (taskRow) {
        c.executionCtx.waitUntil(recordPrdDirective(c.env as Env, db, {
          executionId: id, tenantId, projectId: taskRow.projectId, taskId: taskRow.id, taskTitle: taskRow.title, agentLabel, directive: text,
        }));
      }
      return c.json({ ok: true, steered: true, resumed: true });
    }

    if (!isTerminalExecutionStatus(plain.status)) {
      // ── Steer the live run ──────────────────────────────────────────────────
      await enqueueExecutionMessage(db, { executionId: id, tenantId, role: 'user', text });

      if (plain.agentHostId != null) {
        const stub = c.env.AGENT_HOST_RELAY?.get(c.env.AGENT_HOST_RELAY.idFromName(String(plain.agentHostId)));
        await stub?.fetch('https://relay.internal/execution-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId: id, text }),
        }).catch((error) => reportCaughtError(error, { source: "presentation/routes/runtimeRoutes.ts", operation: "createRuntimeRoutes", context: { logMessage: '[runtime-steer] durable runner wake-up failed; persisted steer remains queued', details: { tenantId, executionId: id, error } } }));
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
      source: plain.source === 'vscode' || plain.source === 'brain' ? plain.source : 'agent',
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
  router.patch('/executions/:id/state', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await loadOwnedExecution(c, runtimeService, id))) return c.json({ error: 'Execution not found' }, 404);
    const body = await parseBody(c, ExecutionStateBody);
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
    return c.json(await taskUsageCost(c.env as Env, db, tenantId, taskId));
  });

  // Per-agent file-change traceability for a task's shared ticket workspace.
  // A live tail (changes as agents run), so it is not cached; the Changes tab
  // polls it only while a run is in-flight. Tenant-scoped.
  router.get('/tasks/:taskId/file-changes', async (c) => {
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ changes: [] });
    // Typed timestamps serialize to the API-wide ISO-8601 UTC wire format.
    const rows = await db
      .select({
        path: taskFileChanges.path,
        change: taskFileChanges.change,
        agent: taskFileChanges.agent,
        executionId: taskFileChanges.executionId,
        createdAt: taskFileChanges.createdAt,
        // NOTE: the outer-row references below interpolate the TABLE (`${taskFileChanges}`),
        // not its columns. In a single-table select Drizzle renders an interpolated
        // Column WITHOUT its table qualifier, so `${taskFileChanges.executionId}` would
        // emit a bare `"execution_id"` that the correlated subquery resolves against its
        // OWN table — silently turning the filter into a tautology.
        models: sql<string[]>`ARRAY(
          SELECT DISTINCT substring(a.args from '"model"\\s*:\\s*"([^"]+)"')
          FROM tool_audit_events a
          WHERE a.execution_id = ${taskFileChanges}.execution_id AND a.tenant_id = ${taskFileChanges}.tenant_id
            AND a.tool_name = 'llm.complete'
            AND substring(a.args from '"model"\\s*:\\s*"([^"]+)"') IS NOT NULL
        )`,
        modelUsage: sql<Array<{ model: string; byo: boolean; provider: string | null }>>`COALESCE((
          SELECT jsonb_agg(DISTINCT jsonb_build_object(
            'model', u.model,
            'byo', u.byo,
            'provider', u.byo_provider
          ))
          FROM llm_usage_log u
          WHERE u.execution_id = ${taskFileChanges}.execution_id AND u.tenant_id = ${taskFileChanges}.tenant_id
        ), '[]'::jsonb)`,
      })
      .from(taskFileChanges)
      .where(and(eq(taskFileChanges.taskId, taskId), eq(taskFileChanges.tenantId, c.get('tenantId'))))
      .orderBy(desc(taskFileChanges.createdAt))
      .limit(500);

    // A browser/cloud dispatch has no `executions` row, so its edits ride its
    // dispatch result rather than this table. Compose both halves here so the
    // Changes tab (and its diff viewer) is executor-agnostic — see
    // application/task/taskFileChangeFeed.
    const fromDispatches = await readDispatchFileChanges(db, c.get('tenantId'), taskId);
    const seen = new Set(rows.map((r) => r.path));
    const changes = [...rows, ...fromDispatches.filter((d) => !seen.has(d.path))]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ changes });
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

    const repo = await resolveTicketRepoContext(db, integrationCredentialSecret(env), tenantId, taskId);
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
    const [ver] = await db
      .select({ ts: taskFileChanges.createdAt })
      .from(taskFileChanges)
      .where(and(
        eq(taskFileChanges.taskId, taskId),
        eq(taskFileChanges.tenantId, tenantId),
        eq(taskFileChanges.path, path),
      ))
      .orderBy(desc(taskFileChanges.createdAt))
      .limit(1);

    if (!ver?.ts) return c.json(await load());
    const body = await getOrSetCached(
      env,
      `task-file-content:${tenantId}:${taskId}:${path}:${ver.ts.toISOString()}`,
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
    const r = await resolveTicketRepoContext(db, integrationCredentialSecret(c.env as Env), c.get('tenantId'), taskId);
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

    const repo = await resolveTicketRepoContext(db, integrationCredentialSecret(env), tenantId, taskId);
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
    const [ver] = await db
      .select({ ts: taskFileChanges.createdAt })
      .from(taskFileChanges)
      .where(and(eq(taskFileChanges.taskId, taskId), eq(taskFileChanges.tenantId, tenantId)))
      .orderBy(desc(taskFileChanges.createdAt))
      .limit(1);

    const body = await getOrSetCached(
      env,
      `task-repo-files:${tenantId}:${taskId}:${ctx.branch}:${ver?.ts.toISOString() ?? 'base'}`,
      load,
      { kvTtlSeconds: 300, l1TtlMs: 30_000 },
    );
    return c.json(body);
  });

  // Broadcast an existing task to all currently connected agentHosts in the tenant.
  // STARTS a run and fans it out to every connected host — the widest-blast-radius
  // dispatch in the file.
  router.post('/tasks/:taskId/broadcast', requireRole(TenantRole.DEVELOPER) as never, async (c) => {
    const taskId = Number(c.req.param('taskId'));
    const body = await parseBody(c, BroadcastBody);

    const [taskRow] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        projectId: tasks.projectId,
        assignedAgentHostId: tasks.assignedAgentHostId,
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

    // Broadcast starts a real run on every connected host, so it must clear the
    // SAME governance gate as a targeted submit — otherwise it was a way to run a
    // high/urgent ticket without the manager approval those tickets require.
    const gate = await evaluateExecutionApprovalGate(
      db, c.get('tenantId'), c.get('userId'), taskRow, null, { payload: body.payload },
    );
    if (!gate.allowed) {
      return c.json({ status: 'awaiting_approval', approvalId: gate.approvalId, taskId: taskRow.id, reason: gate.reason }, 202);
    }

    const execution = await runtimeService.submit({
      taskId,
      tenantId: c.get('tenantId'),
      submittedBy: c.get('userId'),
      payload: body.payload,
      source: c.get('clientSurface') === 'vscode' ? 'vscode' : 'agent',
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
