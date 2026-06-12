/**
 * Cloud agent EXECUTION ENGINE — "run a cloud agent against a ticket", extracted
 * from the runtime HTTP routes so the route file is thin wiring and this owns ONE
 * responsibility: the agent tool loop, the PR finalize, prompt preparation, the
 * container-op handler, per-run telemetry/usage, and the PRD write-backs.
 *
 * Used by the runtime routes (dispatch + container-op endpoint), the durable
 * surface (CloudRunnerDO), and the worker-fallback path. Framework-free (no Hono)
 * so it is unit-testable against a mocked gateway/DB without standing up the Worker.
 */
import { neon } from '@neondatabase/serverless';
import { and, desc, eq } from 'drizzle-orm';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { resolveTicketRepoContext, commitAgentFile, deleteAgentFile, type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { commitPrdAsPendingChange } from '../repos/commitPrdToRepo';
import { createPullRequest } from '../repos/createPullRequest';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from '../repos/mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from '../repos/recordPullRequestRow';
import { readRepoFile, listRepoFiles, searchRepoCode, listBranchDiff } from '../repos/readRepoContents';
import { verifyWrittenFiles } from '../repos/verifyWrittenFiles';
import { scanWrittenForPlaceholders } from '../repos/scanForPlaceholders';
import { CODING_BACKSTOP_MODELS, CODING_MODEL_POOL, llmProxyForPlan, pickCloudModel, type ChatMessage, type EffectivePlan } from '../llm/LlmProxyService';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';
import { recordUsageRow } from '../llm/usageLedger';
import { ensureTaskPrdRecord, appendTaskPrdRevision } from '../prd/taskPrd';
import { loadCapabilityContext } from '../artifact/capabilityContext';
import { pullPendingSteering, releasePendingSteers } from './executionSteering';
import { notifyExecutionSubscribers } from './executionEvents';
import {
  CLOUD_AGENT_TOOLS, CONTAINER_AGENT_TOOLS, MAX_CLOUD_TOOL_STEPS, MAX_PLACEHOLDER_FINISH_BLOCKS,
  CONTAINER_MAX_STEPS, assertsUnrunVerification, type RawToolCall,
} from './cloudAgentTools';
import { parseRemediation, parseFollowUp, parseCloudAgentRef } from './cloudDispatch';
import { RuntimeService } from './RuntimeService';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { executions, tasks, specs, toolAuditEvents, usageSnapshots, projects } from '../../infrastructure/database/schema';

/** Resolved cloud-agent identity for a run — engine, display label, surface, model. */
export interface ResolvedCloudAgent {
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

/**
 * Resolve the runtime engine + display label for a cloud-agent run from its
 * `ide_agents.id`. When a ref resolves, the engine/name/surface/model are read from
 * that agent's record (authoritative, tenant-scoped); otherwise V1 with no label
 * (gateway-default bucket). One indexed lookup per submit (not a hot path).
 */
export async function resolveCloudAgent(
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
export function gitSecret(env: Env): string {
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
export async function recordPrdDirective(
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
export async function recordCloudToolEvent(
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

/** Set form of CODING_MODEL_POOL for O(1) membership on the hot per-turn path. */
const CODING_MODEL_POOL_SET: ReadonlySet<string> = new Set(CODING_MODEL_POOL);

/**
 * True when a CLOUD CODING turn was served by a model that is NOT a curated coding
 * model (i.e. it fell through the CODING_MODEL_POOL → CODING_BACKSTOP_MODELS tail,
 * landing on a generalist like the gemini guaranteed backstop). That degradation
 * is invisible in usage rows, so it's the signal a coding run silently ran on a
 * non-coder. `default` / empty means the gateway never reported a resolved model —
 * not a known degradation, so it is not flagged. Pure — unit-testable in isolation.
 */
export function isCodingModelDegraded(resolvedModel: string | undefined): boolean {
  if (!resolvedModel || resolvedModel === 'default') return false;
  return !CODING_MODEL_POOL_SET.has(resolvedModel);
}

/**
 * Emit a structured `coding_model_degraded` telemetry event when a cloud coding
 * turn was served by a non-coder model (see {@link isCodingModelDegraded}). Rides
 * the SAME timeline channel as the run's llm.complete events ({@link recordCloudToolEvent})
 * so it surfaces on the Observability timeline — no separate channel. No-op when the
 * model is a curated coder. Best-effort — never breaks the run.
 */
async function emitCodingModelDegraded(
  db: Db,
  args: { tenantId: number; cloudAgentRef?: string; executionId: number; resolvedModel: string | undefined; requestedModel: string | undefined },
): Promise<void> {
  if (!isCodingModelDegraded(args.resolvedModel)) return;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: 'coding_model_degraded',
    category: 'llm',
    detail: { resolvedModel: args.resolvedModel, requestedModel: args.requestedModel ?? null, executionId: args.executionId },
    result: `coding run served by non-coder model '${args.resolvedModel}'${args.requestedModel ? ` (requested '${args.requestedModel}')` : ''}`,
  });
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
export const DEFAULT_CLOUD_REF = '__default__';

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
export async function loadContainerRunContext(env: Env, db: Db, executionId: number): Promise<ContainerRunContext | null> {
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
export async function handleContainerOp(
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
    const result = await llmProxyForPlan(env, ctx.effectivePlan, ctx.premiumOverride, { backstopModels: CODING_BACKSTOP_MODELS }).complete({
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
    await emitCodingModelDegraded(db, { tenantId, cloudAgentRef, executionId, resolvedModel, requestedModel: pick.model ?? model });
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
    const repoMiss = repo.ok ? '' : repo.reason;
    const fin = await finalizeCloudRun(env, db, { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, finalOutput, cancelled });
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
  /** The ticket's repo context, resolved on the first tick. Persisted so every DO
   *  tick — including the finalize tick — uses the SAME repo/branch/credential. A
   *  later tick re-resolving could transiently miss (DB blip / a credential edited
   *  mid-run) and finalize would then skip the PR even though earlier ticks already
   *  committed files. Reusing the first resolution removes that window and avoids
   *  re-decrypting the git credential on every alarm tick. `null` = no repo bound. */
  repoCtx?: TicketRepoContext | null;
  /** Why repo resolution missed on the first tick (empty when it resolved). Persisted
   *  alongside `repoCtx` so the finalize tick can report the same reason. */
  repoMiss?: string;
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
  // Resolve the ticket repo ONCE per run. On the durable (DO) surface, the first
  // tick resolves it and every later tick reuses the persisted context — so the
  // finalize tick can always open the PR for files earlier ticks committed (a
  // re-resolution there could transiently miss and silently drop the PR), and we
  // don't re-decrypt the git credential on every alarm tick. `resume` without a
  // `repoCtx` key means the field predates this state (older in-flight run) — fall
  // back to resolving. The Worker surface never resumes, so it always resolves.
  let repoCtx: TicketRepoContext | null;
  let repoMiss: string;
  if (opts?.resume && 'repoCtx' in opts.resume) {
    repoCtx = opts.resume.repoCtx ?? null;
    repoMiss = opts.resume.repoMiss ?? '';
  } else {
    const repoResolved = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskRow.id);
    repoCtx = repoResolved.ok ? repoResolved.ctx : null;
    repoMiss = repoResolved.ok ? '' : repoResolved.reason;
  }
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
  const proxy = llmProxyForPlan(env, routing.effectivePlan, routing.premiumOverride, { backstopModels: CODING_BACKSTOP_MODELS });

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

    // Degradation signal: a coding run served by a non-coder model (the coding
    // cascade fell through CODING_MODEL_POOL onto a CODING_BACKSTOP_MODELS generalist).
    // Invisible in usage rows, so emit it as its own timeline event. The requested
    // model is the run's seed/pin (`pick.model`), not `activeModel` (which may have
    // just locked onto the gateway-resolved id above).
    await emitCodingModelDegraded(db, { tenantId, cloudAgentRef, executionId, resolvedModel, requestedModel: pick.model });

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
      state: { messages, writtenPaths: [...writtenPaths], step, pinnedModel: activeModel, routing, repoCtx, repoMiss },
    };
  }

  const fin = await finalizeCloudRun(env, db, {
    tenantId, cloudAgentRef, executionId, taskRow, agentLabel,
    repoCtx, repoMiss, writtenPaths, finalOutput, cancelled,
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
    /** Why repo resolution failed (empty when it succeeded) — surfaced when no PR opens. */
    repoMiss?: string;
    writtenPaths: Set<string>;
    finalOutput: string;
    cancelled: boolean;
  },
): Promise<{ ok: boolean; output: string }> {
  const { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, finalOutput, cancelled } = args;
  // The run is settling — release any steer that arrived after the loop's last step
  // so it can't dangle unconsumed (the stopped loop will never read it). The single
  // terminal chokepoint for every cloud surface (Worker loop, DO-finished tick, and
  // the container's finalize op all route through here).
  await releasePendingSteers(db, executionId);
  let prOpened = false;
  let merged = false;
  let mergeNote = '';
  // When files were produced but no PR ends up open, capture WHY so the run's
  // summary / timeline explains it instead of silently showing no Pull Request tab.
  let noPrReason = '';
  if (repoCtx && writtenPaths.size > 0 && !cancelled) {
    const pr = await createPullRequest({
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
      title: `Task #${taskRow.id}: ${taskRow.title}`,
      body: `Changes for task #${taskRow.id}, by ${agentLabel}. Files: ${[...writtenPaths].join(', ')}.\n\n> ⚠ **Not verified in-agent.** This serverless executor has no shell and ran no build, type-check, lint, or tests. CI on this PR is the source of truth — do not merge on the agent's summary alone.`,
    }).catch(() => ({ ok: false as const, code: 'provider_error' as const, reason: 'pr failed' }));
    prOpened = pr.ok;
    if (!pr.ok) noPrReason = pr.reason;

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
  } else if (!repoCtx && writtenPaths.size > 0 && !cancelled) {
    // The agent produced changes but there is no repo to open a PR against —
    // record why (no linked repo / unusable credential) so it's visible in the
    // Tools timeline + summary, not swallowed into an empty Pull Request tab.
    noPrReason = repoMiss || 'no repository linked to this project';
  }

  // No PR opened despite changes — make the reason explicit in the timeline so a
  // human knows what to fix (link a repo / fix the credential / inspect the error).
  const noPrNote = noPrReason && !cancelled ? ` — no PR opened: ${noPrReason}` : '';
  if (noPrNote) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'pr_skipped', category: 'tool',
      detail: { writtenFiles: writtenPaths.size, reason: noPrReason },
      result: `No PR opened: ${noPrReason}`.slice(0, 300),
    });
  }

  const output =
    finalOutput ||
    (writtenPaths.size > 0
      ? `Committed ${writtenPaths.size} file(s)${repoCtx?.branch ? ` to \`${repoCtx.branch}\`` : ''}${prOpened ? ', opened a PR' : ''}${mergeNote}${noPrNote}.`
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
export async function runCloudExecution(
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
