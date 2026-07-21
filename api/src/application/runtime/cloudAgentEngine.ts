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
import { and, desc, eq, or, isNull } from 'drizzle-orm';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { buildCloudMemoryCapability } from './cloudMemory';
import { buildCloudWebCapability } from './cloudWeb';
import { isValidatorReviewPayload } from '../validation/validatorReviewMarker';
import { recordActivity, SYSTEM_ACTOR } from '../activity/activityLog';
import { isIncidentTriagePayload, incidentIdFromPayload } from '../incident/incidentTriageMarker';
import { resolveTicketRepoContext, commitAgentFile, deleteAgentFile, type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { commitPrdAsPendingChange } from '../repos/commitPrdToRepo';
import { createPullRequest } from '../repos/createPullRequest';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from '../repos/mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from '../repos/recordPullRequestRow';
import { publishAgentRunVerdict } from '../checks/publishTaskVerdict';
import { postRepoPrComment } from '../repos/postPrComment';
import { claimTaskPrOpen, releaseTaskPrClaim } from '../repos/openTaskPullRequest';
import { readRepoFile, listRepoFiles, searchRepoCode, listBranchDiff } from '../repos/readRepoContents';
import { verifyWrittenFiles } from '../repos/verifyWrittenFiles';
import { scanWrittenForPlaceholders } from '../repos/scanForPlaceholders';
import { CODING_BACKSTOP_MODELS, RECOGNIZED_CODER_MODELS, codingModelsForPlan, estimateRequestTokens, isPremiumModelSelection, llmProxyForPlan, pickCloudModel, type ChatMessage, type EffectivePlan } from '../llm/LlmProxyService';
import { evaluatePremiumModelAccess } from '../../domain/tenant/planFeatures';
import { TenantPlan } from '../../domain/shared/types';
import { compactMessages, buildGatewaySummarizer, CLOUD_COMPACT_DEFAULTS } from '../llm/compactMessages';
import { resolveTenantLlmCredentials, byoVendorIdSet, providersFromCredentials, type TenantVendorKeys } from '../llm/tenantProviderKeyService';
import { cloudAgentPlatformToolSchemas, resolveCloudAgentPlatformTool, callBuiltinTool } from '../llm/builtinMcpService';
import { TenantRole } from '../../domain/shared/types';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';
import { recordUsageRow, clampTokenCount, normalizeByoProvider } from '../llm/usageLedger';
import { ensureTaskPrdRecord, appendTaskPrdRevision } from '../prd/taskPrd';
import { loadCapabilityContext, loadPersonaSetpoints } from '../artifact/capabilityContext';
import { recordPersonalityEvent, compilePersonalityApplication } from '../persona/recordPersonalityEvent';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { pullPendingSteering, releasePendingSteers } from './executionSteering';
import { notifyExecutionSubscribers } from './executionEvents';
import { notifyApprovalRequested } from '../approval/approvalNotifier';
import {
  CONTAINER_AGENT_TOOLS, cloudSurfaceCaps, cloudAgentToolsFor, cloudToolRegistry,
  MAX_CLOUD_TOOL_STEPS, MAX_PLACEHOLDER_FINISH_BLOCKS,
  CONTAINER_MAX_STEPS, assertsUnrunVerification, hasNoCodeDeliverable, policyGateCallKey, type RawToolCall,
} from './cloudAgentTools';
import {
  CURRENT_ENGINE_ID, evaluatePolicyGate, filterByGlob, applyStringEdit,
  appraiseTask, buildLimbicBlock, compileLimbicState, neutralState,
  applyDelta, appraiseAmygdala, homeostasis,
  type AgentEngine, type AgentRunInput, type AgentRunResult, type CapabilityProvider, type ToolContext, type ToolControl, type LimbicState, type LimbicEvent, type PolicyGate, type AgentExecParams, type Capability,
} from '@builderforce/agent-tools';
import { resolveWebSearchCredential, type ResolvedWebSearchCredential } from './webSearchCredential';
import { parseRemediation, parseFollowUp, parseCloudAgentRef, parseModel } from './cloudDispatch';
import { classifyTaskAction } from '../llm/classifyTask';
import { deriveAllocationCategory } from '../llm/allocationCategories';
import { normalizeActionType, learnedRoutingEnabled, type ActionType } from '../llm/actionTypes';
import { getRoutingTable, MIN_SAMPLES, type RoutingScope } from '../llm/routingTable';
import type { ActionModelRankStat } from '../llm/LlmProxyService';
import { resolveTenantModel } from '../llm/tenantModelService';
import { reasoningParamsForModel } from '../llm/reasoningCapability';
import { contributeTextToProjectEverminds, buildEvermindLessonsBlock } from '../llm/projectEvermind';
import { buildProjectFactsBlock } from '../llm/projectFacts';
import { scoreRunOutcome, finalizeLearnWeight } from './scoreRunOutcome';
import { recordCloudToolEvent } from './cloudToolEvents';
import { recordRunRollbackSnapshot, teardownRunBranch, teardownCrashedRunArtifacts } from './runRollback';
import { handleCloudRunCrash } from './cloudSelfHeal';
import { cloudCrashReason } from './orphanReasons';
import { RuntimeService } from './RuntimeService';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import { resolveAppBaseUrl } from '../../env';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { boards, executions, tasks, specs, toolAuditEvents, usageSnapshots, projects, approvals, projectAgents } from '../../infrastructure/database/schema';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';

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
  /** Declared execution support: 'cloud' | 'host' | 'both' (undefined = the
   *  gateway-default bucket, treated as permissive). Enforced at dispatch so a
   *  cloud-only agent is never delivered to a pinned On-Prem host. */
  runtimeSupport?: string;
  /** When runtimeSupport==='both', the runtime to prefer ('cloud' | 'host'). The
   *  swimlane coordinator resolves this to an assignment runtime; the direct
   *  dispatch path uses it only to break a tie when a host is available. */
  preferredRuntime?: string | null;
}

/** Does an agent's declared runtime_support permit running on an On-Prem host?
 *  Undefined (gateway default / legacy) is permissive so existing host runs keep
 *  working; only an explicit 'cloud' marks the agent cloud-only. */
export function agentAllowsHostExecution(runtimeSupport: string | undefined): boolean {
  return runtimeSupport !== 'cloud';
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
  // The engine is ALWAYS the current version (a code constant) — never read from the
  // DB. A run is the current engine regardless of any legacy `engine` value on the row.
  const DEFAULT: ResolvedCloudAgent = { engine: CURRENT_ENGINE_ID, ref, runtimeSurface: 'durable' };
  if (!ref) return DEFAULT;
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = (await sql`SELECT name, runtime_surface, base_model, runtime_support, preferred_runtime FROM ide_agents WHERE id = ${ref} AND tenant_id = ${tenantId} LIMIT 1`) as Array<{ name?: string; runtime_surface?: string; base_model?: string; runtime_support?: string; preferred_runtime?: string | null }>;
    const engine = CURRENT_ENGINE_ID;
    const label = typeof rows[0]?.name === 'string' && rows[0].name ? rows[0].name : undefined;
    const runtimeSurface = rows[0]?.runtime_surface === 'container' ? 'container' : 'durable';
    const rawModel = typeof rows[0]?.base_model === 'string' ? rows[0].base_model.trim() : '';
    const baseModel = rawModel && rawModel !== AGENT_DEFAULT_MODEL_SENTINEL ? rawModel : undefined;
    const runtimeSupport = typeof rows[0]?.runtime_support === 'string' ? rows[0].runtime_support : undefined;
    const preferredRuntime = rows[0]?.preferred_runtime ?? null;
    return { engine, label, ref, runtimeSurface, baseModel, runtimeSupport, preferredRuntime };
  } catch {
    return DEFAULT;
  }
}
/**
 * Load a cloud agent's OWN psychometric profile (ide_agents.psychometric) — the
 * per-agent personality set from the Workforce editor, independent of any assigned
 * persona. Returns the raw JSON string (or null). Tenant-scoped, one indexed lookup;
 * consumed by prepareCloudRun to compile prompt directives + exec params + setpoints.
 */
export async function loadAgentPsychometric(
  env: Env,
  tenantId: number,
  ref: string | undefined,
): Promise<string | null> {
  if (!ref) return null;
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = (await sql`SELECT psychometric FROM ide_agents WHERE id = ${ref} AND tenant_id = ${tenantId} LIMIT 1`) as Array<{ psychometric?: string | null }>;
    return typeof rows[0]?.psychometric === 'string' ? rows[0].psychometric : null;
  } catch {
    return null;
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
async function loadGovernanceContext(db: Db, tenantId: number, projectId: number, cloudAgentRef?: string): Promise<string> {
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
  // Per-agent governance (project_agents.governance) — the rules configured for THIS
  // agent specifically. Previously written via PUT /project-agents/:id/governance but
  // never consumed at execution; now folded in so a per-agent policy actually binds the
  // run. Prefer the project-specific attachment, else the canonical project-less row.
  if (cloudAgentRef) {
    try {
      const rows = await db
        .select({ governance: projectAgents.governance, projectId: projectAgents.projectId })
        .from(projectAgents)
        .where(and(
          eq(projectAgents.tenantId, tenantId),
          eq(projectAgents.agentRef, cloudAgentRef),
          or(isNull(projectAgents.projectId), eq(projectAgents.projectId, projectId)),
        ));
      // Project-specific row wins over the project-less identity row.
      const chosen = rows.find((r) => r.projectId === projectId) ?? rows.find((r) => r.projectId == null);
      if (chosen?.governance?.trim()) {
        parts.push(`## Agent Rules / Governance (specific to you — must be followed)\n\n${chosen.governance.trim()}`);
      }
    } catch { /* skip */ }
  }
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
  } else {
    // The DB PRD copy (specs.prd) stands but the repo PRD.md commit failed — the 3 copies
    // have DIVERGED. Surface it on the audit trail (a reconcile signal) instead of silently
    // dropping it (PRD §5.7), so an operator/agent can re-land the repo copy.
    await recordActivity(env, db, {
      tenantId: args.tenantId, projectId: null, actor: SYSTEM_ACTOR,
      verb: 'ticket.prd.reconcile_needed',
      targetType: 'task', targetId: String(args.taskId), targetLabel: `#${args.taskId}`,
      summary: `PRD repo commit failed (${committed.reason ?? 'unknown'}) — the DB PRD and repo PRD.md have diverged; re-land needed`.slice(0, 300),
      metadata: { reason: committed.reason ?? null, executionId: args.executionId },
    }).catch(() => { /* best-effort — telemetry must not block the run */ });
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
 * The cloud tool-audit emitter now lives in `./cloudToolEvents` (so modules this
 * engine depends on can emit without an import cycle). Re-exported here because
 * this module has always been its public door — every existing importer, in this
 * file and across the routes, keeps working unchanged.
 */
export { recordCloudToolEvent };

/** Real-coder recognition set (auto-route pool + BYO frontier flagships) for O(1)
 *  membership on the hot per-turn path — so a connected-account coder (e.g. Meta MUSE
 *  `direct/meta/muse-spark-1.1`) is recognised as a coder, not flagged as degraded. */
const CODING_MODEL_POOL_SET: ReadonlySet<string> = RECOGNIZED_CODER_MODELS;

/** The ONE agent commit-message convention (`<Verb> <path> — task #<id> (<agent>)`),
 *  so every write/edit/delete commit reads identically instead of re-inlining the
 *  template at each call site. `suffix` appends an optional reason (e.g. a delete note). */
function agentCommitMessage(verb: string, path: string, taskId: number, agentLabel: string, suffix = ''): string {
  return `${verb} ${path} — task #${taskId} (${agentLabel})${suffix}`;
}

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
export async function emitCodingModelDegraded(
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
    // Spell out the cause AND the consequence: the curated coders this run seeded
    // with were all unreachable (vendor key unbound / cooled down / outage), so the
    // cascade floored onto a generalist backstop. That is the usual root cause of a
    // run that loops on search and finishes with no edits — say so here so triage
    // does not have to infer it.
    result: `Coding turn fell through to non-coder backstop '${args.resolvedModel}'${args.requestedModel ? ` (intended coder: '${args.requestedModel}')` : ''} — the plan's curated coders were unreachable (vendor key unbound / cooled down / outage). Expect weak agentic results: a backstop generalist often loops on search and finishes without producing edits.`,
  });
}

/**
 * Run-start model-selection trace. Records WHY this run is on the model it is —
 * the single most common triage question for a cloud run that produced no output
 * (see execution #59: dispatched `gateway-default`, silently floored onto the
 * gemini backstop, spun 7 steps, shipped nothing). The dispatch event only logs
 * the raw `gateway-default` label; this event makes the resolution legible:
 *   • what was requested (agent base_model / user pick, or nothing),
 *   • whether it's a hard strict pin or a soft plan-default seed,
 *   • the seed model + whether it is a curated coder at all,
 *   • the coders THIS plan could actually reach (best-first).
 * Pairs with {@link emitCodingModelDegraded}, which reports the OUTCOME once the
 * gateway resolves. First tick only — best-effort, never breaks the run.
 */
export async function emitModelSelection(
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number;
    requested: string | undefined;
    pick: { model: string; strict: boolean; ranked?: string[]; seedSamples?: number; biasApplied?: boolean };
    plan: EffectivePlan; premium: boolean;
    /** Learned Model Routing: the action type the run was classified as (PRD 13). */
    actionType?: ActionType;
  },
): Promise<void> {
  const seedIsCoder = CODING_MODEL_POOL_SET.has(args.pick.model);
  const planCoders = codingModelsForPlan(args.plan, args.premium);
  // Did the learned reorder actually move the seed off the curated default?
  const curatedDefault = planCoders[0];
  const learnedSeed = !args.pick.strict && (args.pick.seedSamples ?? 0) >= MIN_SAMPLES && args.pick.model !== curatedDefault;
  const learnedNote = args.actionType
    ? ` Action=${args.actionType}; ${
        learnedSeed
          ? `learned routing ranked '${args.pick.model}' #1 from ${args.pick.seedSamples} prior ${args.actionType} run(s)${args.pick.biasApplied ? ', client SSM bias applied' : ''}.`
          : `learned routing had too few samples (cold-start) — kept the curated default.`
      }`
    : '';
  const reason = (args.pick.strict
    ? `Pinned to '${args.pick.model}' (strict — the gateway dispatches only this model, no silent swap).`
    : `No usable model on this agent${args.requested ? ` ('${args.requested}' is not a known catalog id)` : ' (dispatched as gateway-default)'} → seeding the ${args.plan} plan's best coding model '${args.pick.model}'${seedIsCoder ? '' : ' (NOT a curated coder)'}. Soft seed: the run locks onto whatever the gateway resolves on turn 1, so a cold/keyless seed can fail over once — possibly onto a non-coder backstop (watch for coding_model_degraded).`) + learnedNote;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: 'model.select',
    category: 'planning',
    detail: {
      requested: args.requested ?? null,
      pin: args.pick.strict ? 'strict' : 'soft',
      seed: args.pick.model,
      seedIsCoder,
      plan: args.plan,
      premium: args.premium,
      planCoders,
      actionType: args.actionType ?? null,
      rankedFrom: args.pick.ranked ?? null,
      seedSamples: args.pick.seedSamples ?? 0,
      learnedSeed,
      biasApplied: args.pick.biasApplied ?? false,
    },
    result: reason,
  });
}

/** What the learned router needs at run start: the task's action-type label and the
 *  ranked per-model stats for the finest scope that has enough samples. */
export interface LearnedRoutingInputs {
  actionType: ActionType;
  /** byAction[actionType] of the finest scope with a model clearing MIN_SAMPLES, or
   *  undefined when every scope is cold (→ router keeps the curated static order). */
  actionStats?: ReadonlyArray<ActionModelRankStat>;
}

/** True when a scope's per-action stat list has at least one model at/above the
 *  sample floor — i.e. it can actually change the seed. */
function scopeHasSignal(stats: ReadonlyArray<ActionModelRankStat> | undefined): boolean {
  return !!stats && stats.some((s) => s.n >= MIN_SAMPLES);
}

/**
 * Resolve the learned-routing inputs for a run (PRD 13 §6.2/§6.3), best-effort:
 *   1. Ensure `tasks.action_type` — classify ONCE (free pool) and cache on the task
 *      if null; every re-run reuses the column. Falls back to 'other' on any error.
 *   2. Read the finest-scope routing blob (project → tenant → global) and return the
 *      first that has real signal (a model with `n >= MIN_SAMPLES`) for this action.
 * Returns `{ actionType: 'other' }` (no stats) when the kill switch is off or anything
 * throws — so the router simply keeps today's static order. Never blocks a run.
 */
export async function resolveLearnedRoutingInputs(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; taskRow: { id: number; title: string; description: string | null } },
): Promise<LearnedRoutingInputs> {
  if (!learnedRoutingEnabled(env)) return { actionType: 'other' };
  try {
    // 1. Classify-once + cache on the task column.
    let actionType: ActionType = 'other';
    const [row] = await db
      .select({ actionType: tasks.actionType })
      .from(tasks).where(eq(tasks.id, args.taskRow.id)).limit(1);
    if (row?.actionType) {
      actionType = normalizeActionType(row.actionType);
    } else {
      const verdict = await classifyTaskAction(env, { title: args.taskRow.title, description: args.taskRow.description });
      actionType = verdict.actionType;
      // Co-derive the investment-allocation category for free off the same signals
      // (no extra LLM call) — the column is the cache/override (EMP-1).
      const allocationCategory = deriveAllocationCategory({
        actionType: verdict.actionType,
        title: args.taskRow.title,
        description: args.taskRow.description,
      });
      await db.update(tasks)
        .set({ actionType: verdict.actionType, actionTypeConfidence: verdict.confidence, allocationCategory, allocationCategorySource: 'derived' })
        .where(eq(tasks.id, args.taskRow.id))
        .catch(() => { /* best-effort: classification is a cache, not a gate */ });
    }

    // 2. Finest scope with signal → its ranked stats for this action.
    const scopes: RoutingScope[] = [
      { kind: 'project', id: args.projectId },
      { kind: 'tenant', id: args.tenantId },
      { kind: 'global' },
    ];
    for (const scope of scopes) {
      const table = await getRoutingTable(env, db, scope);
      const stats = table.byAction[actionType];
      if (scopeHasSignal(stats)) return { actionType, actionStats: stats };
    }
    return { actionType };
  } catch {
    return { actionType: 'other' };
  }
}

/**
 * A blocked cloud agent's `ask_human` call: record a `question` approval scoped to
 * this execution (so the answer routes back to this exact run) into the SAME
 * approvals queue self-hosted agents use, fan out the team notification (Slack +
 * email), and surface the question on the live execution stream. Returns the new
 * approval id so the loop can carry it in the pause result. The run is parked in
 * `paused` by the caller. Best-effort on notify; the row insert is the durable part.
 */
/**
 * How long an unanswered agent question waits before the /escalate sweep expires it
 * and alerts. Shorter than the 72h paused-run reap deadline on purpose: escalation
 * should get a human's attention well BEFORE the backstop kills the run.
 */
export const CLOUD_QUESTION_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;

async function createCloudQuestion(
  env: Env,
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number;
    agentLabel: string; question: string; context?: string;
  },
): Promise<string> {
  const approvalId = crypto.randomUUID();
  const now = new Date();
  // An agent's question MUST carry an expiry. `expiresAt` is caller-supplied and has
  // no default, and this path used to set none — so the /escalate sweep (which only
  // sees `expiresAt < now`) could never escalate an unanswered agent question. It sat
  // pending forever, and because `paused` counts as a LIVE run in evaluateTaskAutoRun
  // + laneRequirementGate, one ignored question silently froze all future autonomy on
  // that ticket. Escalation is the FIRST line here (it pings the manager); the 72h
  // paused-run reaper in staleExecutionReaper is the backstop that eventually frees
  // the ticket if nobody ever answers. Deliberately generous: a question asked on a
  // Friday afternoon must still be answerable on Monday morning.
  const expiresAt = new Date(now.getTime() + CLOUD_QUESTION_ESCALATE_AFTER_MS);
  const description = args.context?.trim()
    ? `${args.question.trim()}\n\nContext: ${args.context.trim()}`
    : args.question.trim();
  await db.insert(approvals).values({
    id:           approvalId,
    tenantId:     args.tenantId,
    // segment_id is set by the DB trigger (0056); omitted like the on-prem POST path.
    executionId:  args.executionId,
    cloudAgentRef: args.cloudAgentRef ?? null,
    requestedBy:  args.agentLabel,
    kind:         'question',
    actionType:   'clarify.blocked',
    description,
    status:       'pending',
    expiresAt,
    createdAt:    now,
    updatedAt:    now,
  });

  await notifyApprovalRequested(env, db, {
    tenantId: args.tenantId, approvalId, kind: 'question',
    actionType: 'clarify.blocked', description,
  });

  // Mirror onto the live execution stream so an open panel shows the ask immediately.
  notifyExecutionSubscribers(args.executionId, {
    type: 'message', executionId: args.executionId, role: 'assistant',
    text: `⏸ Paused — waiting on a human answer:\n${args.question.trim()}`,
    ts: now.toISOString(),
  });

  return approvalId;
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
export async function recordCloudUsage(
  env: Env,
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number; taskId: number;
    projectId?: number | null; model: string; inputTokens: number; outputTokens: number;
    byo?: boolean; byoProvider?: string | null;
    /** The run's effective plan + premium override — used ONLY to price a PREMIUM
     *  (any-paid-OpenRouter) turn, which adds the flat per-request surcharge on top of
     *  the metered token cost. Omit and a premium cloud turn would be billed at plain
     *  OpenRouter cost, i.e. the surcharge silently lost on this surface. */
    effectivePlan?: 'free' | 'pro' | 'teams';
    premiumOverride?: boolean;
  },
): Promise<void> {
  // Clamp at the boundary so a bad-usage turn (NaN/negative tokens) can't poison the
  // snapshot's context math or the billing ledger — same shared clamp recordUsageRow uses.
  const inputTokens = clampTokenCount(args.inputTokens);
  const outputTokens = clampTokenCount(args.outputTokens);
  try {
    await db.insert(usageSnapshots).values({
      tenantId:      args.tenantId,
      agentHostId:   null,
      cloudAgentRef: args.cloudAgentRef ?? null,
      executionId:   args.executionId,
      sessionKey:    `exec:${args.executionId}`,
      inputTokens,
      outputTokens,
      contextTokens: inputTokens + outputTokens,
    });
  } catch { /* best-effort */ }
  await recordUsageRow(db, env, {
    tenantId:   args.tenantId,
    userId:     null,
    llmProduct: 'builderforceLLM',
    model:      args.model,
    usage:      { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens },
    metadata:   { engine: 'cloud', executionId: args.executionId, taskId: args.taskId, projectId: args.projectId ?? null },
    useCase:    'task_execution',
    // Attribute the spend to the run's cloud agent + ticket + project so cost
    // rolls up ticket → project → account (0104 / 0103).
    attribution: { cloudAgentRef: args.cloudAgentRef ?? null, executionId: args.executionId, taskId: args.taskId, projectId: args.projectId ?? null },
    // Cloud runs always execute on our infra: a BYO row here is $0 to us but STILL
    // counts against the tenant's token allowance (free tenants are charged for
    // cloud-agent usage), so surface is 'cloud' — never exempt. See tokenUsage.ts.
    byo: args.byo ?? false, byoProvider: args.byoProvider ?? null, surface: 'cloud',
    // Premium (any-paid-OpenRouter) turns carry the flat per-request surcharge on the
    // cloud surface too — the same rule the gateway route applies, so a premium model
    // costs the same whether a chat or an autonomous run drove it. BYO rows are $0 to
    // us, so recordUsageRow skips the surcharge for them.
    premiumSurcharge: args.effectivePlan
      ? isPremiumModelSelection(args.model, args.effectivePlan, args.premiumOverride ?? false)
      : false,
  });
}

/** Synthetic cloud-agent ref for runs dispatched to the gateway default (no named
 *  cloud agent) — so their telemetry is still attributable to a chip on the
 *  Observability timeline. Shared with the frontend via the cloud-agents list. */
export const DEFAULT_CLOUD_REF = '__default__';

/** True when a tenant brought at least one BYO api-key — so we only thread the
 *  overlay (and mark vendors tenant-funded) when there's actually a key. */
function hasVendorKeys(keys: TenantVendorKeys): boolean {
  return Object.values(keys).some((v) => !!v);
}

/** Map the gateway's string effectivePlan onto the plan enum the pure entitlement
 *  evaluators take. */
function toTenantPlanEnum(ep: EffectivePlan): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

/** A cloud run's LLM routing — which model pool / vendor key its tenant's plan
 *  unlocks. Resolved once per run and reused, never recomputed per turn. */
export type CloudRouting = {
  effectivePlan: EffectivePlan;
  premiumOverride: boolean;
  /** May this run honour a PREMIUM (any-paid-OpenRouter) pin — a paid plan WITH a
   *  validated card? A cloud run never passes the gateway route's premium gate, so
   *  `pickCloudModel` enforces it from this. */
  premiumEntitled: boolean;
};

/** Resolve a tenant's cloud LLM routing, degrading to the free plan if the plan
 *  lookup throws — a background cloud run must never hard-fail on plan I/O. */
async function resolveCloudRouting(env: Env, tenantId: number): Promise<CloudRouting> {
  try {
    const r = await resolveTenantPlan(env, tenantId);
    // Superadmin is deliberately NOT consulted: a cloud run has no acting user, and
    // premium is a tenant-funding question. A comped tenant still gets it via the
    // premium override, which the evaluator honours.
    const premium = evaluatePremiumModelAccess({
      effectivePlan: toTenantPlanEnum(r.effectivePlan),
      premiumOverride: r.premiumOverride,
      isSuperadmin: false,
      cardValidated: r.cardValidated,
    });
    return { effectivePlan: r.effectivePlan, premiumOverride: r.premiumOverride, premiumEntitled: premium.entitled };
  } catch {
    return { effectivePlan: 'free', premiumOverride: false, premiumEntitled: false };
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
  /** Whether a PREMIUM (any-paid-OpenRouter) pin may be honoured — paid plan + a
   *  validated card. Resolved with the routing above so the container op enforces the
   *  same rule as the durable loop. */
  premiumEntitled: boolean;
  /** Execution levers compiled from the assigned personas + the agent's own
   *  personality, resolved once at context build (cached) so the container's per-step
   *  `llm` op applies the trait-derived temperature — parity with the Worker/DO loop. */
  execParams: AgentExecParams;
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
    const explicitRef = parseCloudAgentRef(exec.payload ?? undefined);
    const board = await findCanonicalBoard(db, task.projectId, exec.tenantId);
    // Managed-ticket assignees coordinate; role dispatches must name their executor.
    if (board?.lifecycleManaged && !explicitRef) return null;
    const ref = explicitRef ?? task.assignedAgentRef ?? undefined;
    const agent = await resolveCloudAgent(env, exec.tenantId, ref);
    const payloadModel = parseModel(exec.payload ?? undefined);
    const routing = await resolveCloudRouting(env, exec.tenantId);
    // Compile the persona/agent personality exec levers ONCE per run (cache-backed
    // persona bodies), so the container's per-step `llm` op applies the same
    // trait-derived temperature the Worker/DO loops do. Best-effort: a resolution
    // failure must NOT break the container run — degrade to no exec overrides.
    let execParams: AgentExecParams = {};
    try {
      const [artifacts, agentPsychometric] = await Promise.all([
        resolveArtifacts(db, { tenantId: exec.tenantId, taskId: exec.taskId, projectId: task.projectId, cloudAgentRef: agent.ref }),
        loadAgentPsychometric(env, exec.tenantId, agent.ref),
      ]);
      execParams = (await loadCapabilityContext(env, db, artifacts, agentPsychometric)).execParams;
    } catch {
      /* best-effort — personality temperature is an enhancement, not run-critical */
    }
    return {
      tenantId: exec.tenantId, taskId: exec.taskId, projectId: task.projectId,
      taskTitle: task.title, taskDescription: task.description,
      cloudAgentRef: agent.ref, agentLabel: agent.label ?? 'BuilderForce Agent',
      model: payloadModel ?? agent.baseModel,
      effectivePlan: routing.effectivePlan, premiumOverride: routing.premiumOverride,
      premiumEntitled: routing.premiumEntitled,
      execParams,
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

/** Parse the assistant turn (content + tool calls) off a gateway chat-completion
 *  response body. One reader for both the in-Worker loop and the container `llm` op. */
function parseLlmChoice(json: unknown): { content: string; toolCalls: RawToolCall[] } {
  const j = json as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> } | null;
  const choice = j?.choices?.[0]?.message;
  const content = typeof choice?.content === 'string' ? choice.content : '';
  const toolCalls = Array.isArray(choice?.tool_calls) ? (choice!.tool_calls as RawToolCall[]) : [];
  return { content, toolCalls };
}

type CloudLlmTurn =
  | { ok: true; content: string; toolCalls: RawToolCall[]; resolvedModel: string }
  | { ok: false; error: string; resolvedModel: string };

interface CloudLlmTurnCtx {
  env: Env; db: Db;
  tenantId: number; cloudAgentRef?: string; executionId: number;
  taskId: number; projectId?: number | null;
  /** The run's seed/pin, for the coding-degraded comparison (NOT the resolved model). */
  requestedModel?: string;
  /** Model id to attribute when the gateway doesn't echo a resolved one. */
  fallbackModel?: string;
  /** The run's effective plan + premium override — needed to price a PREMIUM
   *  (any-paid-OpenRouter) turn's flat per-request surcharge. */
  effectivePlan?: 'free' | 'pro' | 'teams';
  premiumOverride?: boolean;
}

/**
 * The post-`complete` half of one cloud LLM turn, shared by {@link runCloudToolLoop}
 * (in-Worker) and the container `llm` op so metering + the `llm.complete` /
 * coding-degraded / `agent.message` telemetry have ONE implementation (the
 * proxy.complete call + the loop-only 429 cascade stay at the call site). Records
 * usage, shapes a gateway error, parses the choice, and emits the timeline events;
 * `notify` surfaces the assistant message to live subscribers (the loop streams its
 * final turn separately, so it passes false).
 */
async function recordCloudLlmTurn(
  result: Awaited<ReturnType<ReturnType<typeof llmProxyForPlan>['complete']>>,
  rc: CloudLlmTurnCtx,
  opts: { tGen0: number; step?: number; notify: boolean },
): Promise<CloudLlmTurn> {
  const evtBase = { tenantId: rc.tenantId, cloudAgentRef: rc.cloudAgentRef, executionId: rc.executionId };
  const resolvedModel = result.resolvedModel ?? rc.fallbackModel ?? 'default';
  if (result.usage) {
    await recordCloudUsage(rc.env, rc.db, {
      ...evtBase, taskId: rc.taskId, projectId: rc.projectId, model: resolvedModel,
      ...(rc.effectivePlan ? { effectivePlan: rc.effectivePlan, premiumOverride: rc.premiumOverride ?? false } : {}),
      inputTokens: result.usage.promptTokens ?? 0, outputTokens: result.usage.completionTokens ?? 0,
      byo: result.byoFunded ?? false,
      byoProvider: result.byoFunded ? normalizeByoProvider(result.resolvedVendor) : null,
    });
  }
  const durationMs = Date.now() - opts.tGen0;
  if (result.response.status >= 400) {
    const text = await result.response.text().catch(() => '');
    // Name the model + the chain that was walked — "which model failed" is the first
    // triage question (the raw upstream text alone, e.g. "[cloudflare] 413: …context
    // window limit", doesn't say WHICH gateway model resolved to it).
    const chain = result.candidateChain?.length ? ` · chain: ${result.candidateChain.join(' → ')}` : '';
    await recordCloudToolEvent(rc.db, {
      ...evtBase, toolName: 'llm.complete', category: 'llm',
      detail: { model: resolvedModel, provider: result.resolvedVendor, byo: result.byoFunded ?? false, keySource: result.byoFunded ? 'byo' : 'builderforce-managed', traceId: result.traceId ?? null, status: result.response.status, step: opts.step, outcome: result.outcome ?? null, candidateChain: result.candidateChain ?? null },
      result: `gateway ${result.response.status} on '${resolvedModel}' (${result.outcome ?? 'error'})`, durationMs,
    });
    return { ok: false, error: `Gateway ${result.response.status} on model '${resolvedModel}'${chain}: ${text.slice(0, 300)}`, resolvedModel };
  }
  const { content, toolCalls } = parseLlmChoice(await result.response.json().catch(() => null));
  await recordCloudToolEvent(rc.db, {
    ...evtBase, toolName: 'llm.complete', category: 'llm',
    detail: { model: resolvedModel, provider: result.resolvedVendor, byo: result.byoFunded ?? false, keySource: result.byoFunded ? 'byo' : 'builderforce-managed', traceId: result.traceId ?? null, step: opts.step, toolCalls: toolCalls.length },
    result: `${toolCalls.length} tool call(s)${content ? ` · ${content.length} chars` : ''}`, durationMs,
  });
  await emitCodingModelDegraded(rc.db, { ...evtBase, resolvedModel, requestedModel: rc.requestedModel ?? '' });
  if (content) {
    await recordCloudToolEvent(rc.db, {
      ...evtBase, toolName: 'agent.message', category: 'message',
      detail: { step: opts.step, content }, result: content.slice(0, 280),
    });
    if (opts.notify) notifyExecutionSubscribers(rc.executionId, { type: 'message', executionId: rc.executionId, role: 'assistant', text: content, ts: new Date().toISOString() });
  }
  return { ok: true, content, toolCalls, resolvedModel };
}

/**
 * Bump `executions.updated_at` — the cloud-run liveness heartbeat the orphan reaper
 * (the per-surface {@link cloudSilenceCeilingMs}) measures "last activity" from. The
 * container can spend minutes inside a
 * single `run_command` (a build/test step) with no LLM round-trip, so it pings this
 * on a timer independent of LLM steps; without that the reaper would kill a healthy,
 * busy container mid-build. ONE writer so the `llm` op and the dedicated `heartbeat`
 * op agree. Best-effort — a missed beat is covered by the next one. */
async function heartbeatExecution(db: Db, executionId: number): Promise<void> {
  await db.update(executions).set({ updatedAt: new Date() }).where(eq(executions.id, executionId)).catch(() => { /* best-effort */ });
}

/**
 * Handle one container-op call from the long-lived Container executor. The container
 * runs the agent loop in its own process and delegates to the Worker for everything
 * that must stay server-side: the gateway LLM step (`llm`), per-file commit to the
 * ticket branch (`write`), arbitrary telemetry (`event`), the curated platform tools
 * (`platform_tool`), durable cross-run memory (`memory`), the PR finalize
 * (`finalize`), a cheap cancel poll (`status`), and a liveness `heartbeat`. Reuses the
 * exact same helpers as the in-Worker loop, so there is ONE implementation of
 * metering, commit, and finalize. Authenticated by the per-run token (already verified
 * by the caller).
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

  // Liveness heartbeat from the long-lived container, fired on a timer independent of
  // LLM steps so a multi-minute `run_command` (build/test) keeps the run out of the
  // orphan reaper. Returns `cancelled` so the container can abort an in-flight command
  // when the run was cancelled mid-build instead of waiting out the command timeout.
  if (op === 'heartbeat') {
    await heartbeatExecution(db, executionId);
    return { status: 200, body: { ok: true, cancelled: await isExecutionCancelled(db, executionId) } };
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

  // Curated platform tool relayed from the container (it holds no DB creds). Same
  // dispatch as the durable loop: subset-only resolver refuses off-list names, run
  // in-process tenant-scoped, project defaulted to THIS run's. Records a tool event
  // so container platform actions show on the timeline like the Worker loop's.
  if (op === 'platform_tool') {
    const name = typeof args.name === 'string' ? args.name : '';
    const toolArgs = args.arguments && typeof args.arguments === 'object' ? (args.arguments as Record<string, unknown>) : {};
    const platformTool = resolveCloudAgentPlatformTool(name);
    if (!platformTool) return { status: 200, body: { ok: false, error: `unknown or disallowed platform tool '${name}'` } };
    const tStart = Date.now();
    let result: Record<string, unknown>;
    try {
      const data = await callBuiltinTool(db, {
        tenantId, tool: platformTool,
        arguments: { projectId, ...toolArgs },
        env, userId: cloudAgentRef ?? null, role: TenantRole.MANAGER,
      });
      result = data && typeof data === 'object' ? (data as Record<string, unknown>) : { ok: true, result: data };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: name, category: 'tool', detail: toolArgs,
      result: JSON.stringify(result).slice(0, 300), durationMs: Date.now() - tStart,
    });
    return { status: 200, body: result };
  }

  // Durable cross-run memory relayed from the container (it holds no DB creds, the
  // same reason `platform_tool` exists). Backed by the IDENTICAL capability the
  // durable loop uses — `project_facts` for a project-scoped run, the tenant-wide
  // `agent_memory` twin otherwise — so a fact remembered on one cloud surface is
  // recalled on the other. `action` is 'recall' | 'remember'. Records a tool event so
  // container memory calls appear on the timeline like the Worker loop's.
  if (op === 'memory') {
    const action = typeof args.action === 'string' ? args.action : '';
    const memory = buildCloudMemoryCapability({ db, env, tenantId, projectId });
    const tStart = Date.now();
    let result: Record<string, unknown>;
    let toolName = 'memory';
    try {
      if (action === 'recall') {
        toolName = 'memory_recall';
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query.trim()) return { status: 200, body: { ok: false, error: 'query is required' } };
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined;
        result = (await memory.recall(query, limit)) as unknown as Record<string, unknown>;
      } else if (action === 'remember') {
        toolName = 'memory_remember';
        const key = typeof args.key === 'string' ? args.key : '';
        const content = typeof args.content === 'string' ? args.content : '';
        if (!key.trim() || !content.trim()) return { status: 200, body: { ok: false, error: 'key and content are required' } };
        const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined;
        const importance = typeof args.importance === 'number' && Number.isFinite(args.importance) ? args.importance : undefined;
        result = (await memory.remember(key, content, { tags, importance })) as unknown as Record<string, unknown>;
      } else {
        return { status: 200, body: { ok: false, error: `unknown memory action '${action}' (expected 'recall' or 'remember')` } };
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName, category: 'tool', detail: args,
      result: JSON.stringify(result).slice(0, 300), durationMs: Date.now() - tStart,
    });
    return { status: 200, body: result };
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
    // Compress the conversation BEFORE the paid call so a long container run never
    // re-sends a ballooning history. The container owns its loop state, so the
    // compacted messages are RETURNED below for it to adopt — otherwise it would
    // re-send (and re-summarize) the full history every turn.
    const compaction = await compactMessages(messages, CLOUD_COMPACT_DEFAULTS, buildGatewaySummarizer(env));
    const sendMessages = compaction.compacted ? compaction.messages : messages;
    if (compaction.compacted) {
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'context.compacted', category: 'llm',
        detail: { beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens, summarized: compaction.summarized, droppedMessages: compaction.droppedMessages },
        result: `compressed ~${compaction.beforeTokens} → ~${compaction.afterTokens} tokens (${compaction.summarized ? 'builder-memory summary' : 'elided'})`,
      });
    }
    const tGen0 = Date.now();
    // Route through the tenant's plan pool/key (not the fixed free pool) and apply
    // the shared cloud model rule: explicit pick = hard pin, else the plan's best
    // coding model. The container holds its own loop state, so per-op pinning is
    // the caller's explicit `model`; the default lands on a strong coding model.
    // Repo/shell tools + the curated platform subset (create tasks / update OKRs /
    // read remaining) — parity with the durable loop. The container relays each
    // `builtin_*` call back via the `platform_tool` op below (it has no DB).
    const containerTools = [...CONTAINER_AGENT_TOOLS, ...cloudAgentPlatformToolSchemas()];
    // A connected Claude subscription powers a direct-Claude container turn; BYO
    // OpenAI/Google/Anthropic api-keys override the operator keys for their vendors
    // (tenant-funded → byo). One round-trip (parallel reads); empty (operator-key
    // floor) when the tenant has connected nothing. Resolved BEFORE model pick so a
    // free tenant may pin a BYO model (byoVendors lifts the free-plan choice gate).
    const containerCreds = await resolveTenantLlmCredentials(env, tenantId);
    const { anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, vendorKeys: tenantVendorKeys } = containerCreds;
    const pick = pickCloudModel(model, ctx.effectivePlan, ctx.premiumOverride, {
      // Context-aware seed: a small-window model isn't picked for a big container turn.
      estimatedTokens: estimateRequestTokens(sendMessages, containerTools),
      byoVendors: byoVendorIdSet(providersFromCredentials(containerCreds)),
      // Tenant BYO precedence — lead with the owner's chosen account (e.g. Meta first).
      byoVendorPriority: containerCreds.vendorPriority,
      // Parity with the durable loop: a PREMIUM pin needs a paid plan + validated card.
      premiumEntitled: ctx.premiumEntitled,
    });
    const result = await llmProxyForPlan(env, ctx.effectivePlan, ctx.premiumOverride, { backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true, ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}), ...(openaiCodexAuth ? { openaiCodexAuth } : {}), ...(xaiOAuthToken ? { xaiOAuthToken } : {}), ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}), ...(containerCreds.vendorPriority.length ? { byoVendorPriority: containerCreds.vendorPriority } : {}), ...(containerCreds.configuredProviders.length ? { byoRequired: true } : {}) }).complete({
      messages: sendMessages as unknown as ChatMessage[], tools: containerTools, tool_choice: 'auto',
      ...(pick.model ? { model: pick.model, ...(pick.strict ? { modelStrict: true } : {}) } : {}),
      // Personality temperature — parity with the Worker/DO loop.
      ...(ctx.execParams.temperature != null ? { temperature: ctx.execParams.temperature } : {}),
      // Personality reasoning levers (thinkLevel/reasoningLevel) → the CORRECT vendor
      // param for THIS model family (Anthropic `thinking` / OpenAI `reasoning_effort`),
      // or nothing for a model that doesn't support one (reasoningCapability drops it).
      // Only on a STRICT pin: an unpinned model may cascade to a different vendor that
      // would reject the param, so we attach it solely when the resolved model is fixed.
      // First-turn detection: the container op has no assistant turn yet in its slice.
      ...(pick.strict
        ? reasoningParamsForModel(pick.model, ctx.execParams, {
            isFirstTurn: !sendMessages.some((m) => (m as { role?: string }).role === 'assistant'),
          }) ?? {}
        : {}),
      useCase: 'task_execution',
    });
    // Shared post-`complete` processing (metering + telemetry) — identical to the
    // in-Worker loop. `notify: true` surfaces the assistant message to subscribers
    // (the container has no separate output stream).
    const turn = await recordCloudLlmTurn(result, {
      env, db, tenantId, cloudAgentRef, executionId, taskId, projectId,
      requestedModel: pick.model ?? model, fallbackModel: pick.model,
      effectivePlan: ctx.effectivePlan, premiumOverride: ctx.premiumOverride,
    }, { tGen0, notify: true });
    // Heartbeat: a live container keeps the run out of the orphan reaper.
    await heartbeatExecution(db, executionId);
    if (!turn.ok) return { status: 200, body: { error: turn.error } };
    return { status: 200, body: {
      content: turn.content, toolCalls: turn.toolCalls, steering,
      // When the history was compacted, hand the container the compacted form so it
      // adopts it as its new loop state (and doesn't re-send the full history next turn).
      ...(compaction.compacted ? { compactedMessages: compaction.messages } : {}),
      cancelled: await isExecutionCancelled(db, executionId),
    } };
  }

  if (op === 'write') {
    const path = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const isNew = args.isNew !== false;
    if (!path || !content) return { status: 200, body: { ok: false, error: 'path and content are both required' } };
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    if (!repo.ok) return { status: 200, body: { ok: false, error: `no repo bound to this task (${repo.reason}); include the file contents in your final summary instead` } };
    const commit = await commitAgentFile(repo.ctx, path, content, agentCommitMessage(isNew ? 'Add' : 'Update', path, taskId, agentLabel));
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
    // Learned Model Routing: container-surface terminal chokepoint (covers the
    // cancelled finalize too — the row is already CANCELLED). Idempotent/best-effort.
    await scoreRunOutcome(env, db, { executionId }).catch(() => { /* best-effort */ });
    return { status: 200, body: { ok: fin.ok, output: fin.output } };
  }

  if (op === 'fail') {
    // The container caught its own crash mid-loop and is reporting the REAL reason
    // (vs. finalize, which implies an orderly finish). Recover it like any other
    // backplane crash: self-heal once on the durable executor, else fail carrying
    // this reason so the timeline says exactly what broke.
    const detail = typeof args.error === 'string' && args.error.trim() ? args.error.trim() : 'container run error';
    const outcome = await handleCloudRunCrash(env, db, executionId, cloudCrashReason(detail));
    if (outcome === 'ineligible') {
      const updated = await runtimeService.getExecution(executionId).catch(() => null);
      if (updated) notifyExecutionSubscribers(executionId, { type: 'done', executionId, status: updated.status, execution: updated.toPlain(), ts: new Date().toISOString() });
      // Terminal FAILURE with no PR to protect — sweep the ticket branch this run
      // half-wrote, subject to the same shared safety decision the cancel path
      // uses (never the default branch, never under an open PR, never a branch
      // carrying commits this run did not author). Best-effort.
      await teardownCrashedRunArtifacts(env, db, { executionId, secret: gitSecret(env) })
        .catch(() => { /* a sweep must never mask the real crash */ });
      // Terminal (no self-heal requeue) — score the failed run. A requeue defers
      // scoring to the durable surface's terminal chokepoint instead.
      await scoreRunOutcome(env, db, { executionId }).catch(() => { /* best-effort */ });
    }
    return { status: 200, body: { ok: true, recovered: outcome === 'requeued' } };
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
  /** ROADMAP #38: set once the empty-deliverable finish gate has fired, so the
   *  durable surface doesn't re-arm (and re-block) the same self-review every tick. */
  noDeliverableBlocked?: boolean;
  /** How many finish attempts the anti-stub gate has already blocked this RUN. MUST be
   *  persisted: the durable surface runs ONE step per alarm tick, so a loop-local
   *  counter resets to 0 every tick and MAX_PLACEHOLDER_FINISH_BLOCKS could never be
   *  reached — the gate would block a stub-shipping finish forever instead of relenting
   *  after N attempts and opening the PR annotated-unverified. */
  placeholderBlocks?: number;
  /** Compiled governance gates for this run (compile-primitive policy modality).
   *  Persisted on the first tick so every durable tick enforces the SAME gates
   *  without re-reading the payload (which a later tick may not carry). */
  policyGates?: PolicyGate[];
  /** Approved `require-approval` CALLS — one {@link policyGateCallKey} (gate id + tool
   *  name + argument hash) per call the human already answered. Persisted so a retried
   *  identical call proceeds instead of re-parking forever. Keyed per-call, NOT per
   *  gate: a gate keyed by id alone stopped gating after its first approval, silently
   *  pre-approving every later call it covered for the rest of the run. */
  policyAskedGates?: string[];
}
export interface CloudLoopOpts {
  /** Resume from this persisted state instead of starting fresh. */
  resume?: CloudLoopState;
  /** Max iterations to run THIS call (the DO passes 1 — one LLM step per tick). */
  maxSteps?: number;
  /** Skip the PR/merge finalize unless the run is actually finished — so the DO
   *  doesn't ship a half-done run between ticks. */
  deferFinalize?: boolean;
  /** Learned Model Routing (PRD 13 §6.6): a client-computed SSM recall nudge
   *  (model → weight) from an INTERACTIVE launch. Absent on headless/autonomous
   *  runs (board lane auto-run, scheduled, CI-fix). Merged as a nudge over the KV
   *  routing table on the first tick. */
  routingBias?: Record<string, number>;
  /**
   * Per-step dynamic system directive injected into THIS turn's LLM request only
   * — never persisted into the conversation state the loop owns. The decoupling
   * seam (Open/Closed + Dependency-Inversion) that lets any engine version layer
   * behaviour on the V2 loop without the loop knowing about it: the V3 limbic
   * engine recomputes its affective block from evolving state each tick and
   * passes it here, so affect can change across DO ticks even though the loop
   * resumes from saved messages. V2 passes nothing → request === saved messages
   * (byte-identical behaviour). Recomputed by the caller each tick, so it is
   * serialization-safe (a string, not a closure, survives DO cursor persistence).
   */
  dynamicSystem?: string;
  /** Compiled governance gates to enforce at the tool seam (compile-primitive policy
   *  modality). The first tick seeds {@link CloudLoopState.policyGates} from this;
   *  later ticks resume from state. */
  policyGates?: PolicyGate[];
  /** Execution levers compiled from the agent's/personas' psychometric personality
   *  (from {@link prepareCloudRun}). `temperature` applies on every turn; the reasoning
   *  levers (thinkLevel/reasoningLevel) are mapped to the correct vendor param for the
   *  pinned model by {@link reasoningParamsForModel} (Anthropic `thinking` / OpenAI
   *  `reasoning_effort`) and attached on a strict pin. Applied to every LLM turn so
   *  personality changes how the agent reasons and samples, not just its prompt. */
  execParams?: AgentExecParams;
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
  /** Set when the agent called `ask_human`: the run is PAUSED on a human question
   *  (NOT finished — no PR, not terminal). `state` carries the resume point so the
   *  surface persists it and wakes the loop once the question is answered. */
  awaitingInput?: { approvalId: string; question: string };
}

/**
 * The durable/Worker surface's {@link CapabilityProvider}: the concrete backing for
 * the capability-gated tool registry on Cloudflare. It exposes the repo over the git
 * API (no disk), a shell-free static validator, human-in-the-loop via the approvals
 * queue, durable cross-run memory, and bounded public-web reads — and OWNS the side
 * effects of a write/delete (tracking the run's
 * written paths, recording a `task_file_changes` row, notifying subscribers) so each
 * tool stays a thin schema + result shaper. `repoCtx` and `writtenPaths` are the live
 * run state, so `readRef` (base before the first write, the ticket branch after) is
 * computed per call. The SAME tool definitions run on-prem against a disk/shell
 * provider — only this backing changes per surface (Dependency Inversion).
 */
function buildCloudProvider(args: {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  executionId: number;
  taskRow: { id: number; title: string };
  agentLabel: string;
  cloudAgentRef: string | undefined;
  repoCtx: TicketRepoContext | null;
  repoMiss: string;
  /** Live set of paths written this run (mutated by write/delete). */
  writtenPaths: Set<string>;
  /** The run's capability set — {@link CLOUD_SURFACE_CAPS} plus whatever the TENANT
   *  unlocked (today: `web.search`). Must be the same set the advertised tool schemas
   *  were derived from. */
  capabilities: ReadonlySet<Capability>;
  /** Resolved BYO web-search backing, or null when this tenant has no key. Null must
   *  coincide with `capabilities` lacking `web.search`. */
  webSearch: ResolvedWebSearchCredential | null;
}): CapabilityProvider {
  const { env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths } = args;
  // Read/list against the ticket branch only once it exists (created on the first
  // commit). Before any write, the branch ref 404s — read from `base` instead, so
  // the agent sees the real codebase rather than mistaking the missing branch for
  // "no repo access".
  const readRef = (): string => (repoCtx ? (writtenPaths.size > 0 ? repoCtx.branch : repoCtx.base) : '');
  const noRepo = (suffix = ''): string => `no repo bound to this task (${repoMiss})${suffix}`;

  return {
    capabilities: args.capabilities,
    repoRead: {
      async listFiles(sub, glob) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        const ref = readRef();
        const ls = await listRepoFiles({ ...repoCtx, ref }, sub);
        if (!ls.ok) return { ok: false, error: ls.reason };
        // A glob is an explicit "find these files" — filter to matches (case-insensitive,
        // bare name matches basename at any depth) so a named file is always surfaced.
        const paths = glob ? filterByGlob(ls.paths, glob) : ls.paths;
        return { ok: true, ref, paths, truncated: ls.truncated };
      },
      async readFile(path) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        const rf = await readRepoFile({ ...repoCtx, ref: readRef() }, path);
        return rf.ok ? { ok: true, path: rf.path, content: rf.content, truncated: rf.truncated } : { ok: false, error: rf.reason };
      },
      async searchCode(query, scope) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        // The `path` scope is applied INSIDE searchRepoCode (server-side via GitHub's
        // `path:` qualifier), not post-filtered here — a post-filter over the capped
        // top-N global hits dropped a subdir's real matches and carried a stale
        // `truncated` flag, yielding `total:0, truncated:true` that looped the agent.
        const sr = await searchRepoCode({ ...repoCtx, ref: readRef() }, query, { maxResults: 30, path: scope });
        if (!sr.ok) return { ok: false, error: sr.reason };
        return { ok: true, query, total: sr.total, truncated: sr.truncated, matches: sr.matches };
      },
    },
    repoWrite: {
      async writeFile(path, content, _summary) {
        if (!repoCtx) return { ok: false, error: noRepo('; include the file contents in your final summary instead') };
        const firstWriteThisRun = !writtenPaths.has(path);
        const commit = await commitAgentFile(repoCtx, path, content, agentCommitMessage(firstWriteThisRun ? 'Add' : 'Update', path, taskRow.id, agentLabel));
        if (!commit.ok) return { ok: false, error: commit.reason };
        writtenPaths.add(path);
        // created vs modified comes from whether the path pre-existed in the repo
        // (commit.existed), not first-write-this-run.
        const change = commit.existed ? 'modified' : 'created';
        await recordTaskFileChange(env, tenantId, taskRow.id, executionId, path, change, agentLabel);
        notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change, ts: new Date().toISOString() });
        return { ok: true, branch: repoCtx.branch, commitUrl: commit.commitUrl, change };
      },
      async editFile(path, oldString, newString, replaceAll) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        const rf = await readRepoFile({ ...repoCtx, ref: readRef() }, path);
        if (!rf.ok) return { ok: false, error: `cannot edit '${path}': ${rf.reason}` };
        if (rf.truncated) return { ok: false, error: `'${path}' is too large to edit safely here — rewrite it with write_file instead` };
        // EOL-tolerant, EOL-preserving match (shared with the VS Code provider) so an
        // agent that emits LF against a CRLF-committed file still edits it instead of
        // failing with "old_string not found" and giving up.
        const edit = applyStringEdit(rf.content, oldString, newString, replaceAll);
        if (!edit.ok || edit.content == null) return { ok: false, error: `cannot edit '${path}': ${edit.error ?? 'old_string not found'}` };
        const updated = edit.content;
        const firstWriteThisRun = !writtenPaths.has(path);
        const commit = await commitAgentFile(repoCtx, path, updated, agentCommitMessage(firstWriteThisRun ? 'Edit' : 'Update', path, taskRow.id, agentLabel));
        if (!commit.ok) return { ok: false, error: commit.reason };
        writtenPaths.add(path);
        await recordTaskFileChange(env, tenantId, taskRow.id, executionId, path, 'modified', agentLabel);
        notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: 'modified', ts: new Date().toISOString() });
        return { ok: true, branch: repoCtx.branch, commitUrl: commit.commitUrl, change: 'modified', replaced: edit.replaced };
      },
      async deleteFile(path, reason) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        const suffix = reason && reason.trim() ? ` — ${reason.trim()}` : '';
        const del = await deleteAgentFile(repoCtx, path, agentCommitMessage('Remove', path, taskRow.id, agentLabel, suffix));
        if (del.ok) {
          writtenPaths.delete(path);
          await recordTaskFileChange(env, tenantId, taskRow.id, executionId, path, 'deleted', agentLabel);
          notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: 'deleted', ts: new Date().toISOString() });
          return { ok: true, branch: repoCtx.branch, commitUrl: del.commitUrl };
        }
        if (del.code === 'not_found') {
          // Not on the branch — benign no-op so the model doesn't treat it as a failure.
          return { ok: true, deleted: false, note: `'${path}' is not on the branch, so there is nothing to delete.` };
        }
        return { ok: false, error: del.reason };
      },
    },
    staticCheck: {
      async verify() {
        if (!repoCtx) return { ok: true, ran: false, note: `No repository is bound (${repoMiss}) — nothing to validate here; return the deliverable in your finish summary.` };
        if (writtenPaths.size === 0) return { ok: true, ran: false, note: 'No files written yet — write your changes first, then call run_checks to statically validate config files.' };
        const v = await verifyWrittenFiles({ ...repoCtx, ref: readRef() }, writtenPaths);
        return v.ok
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
      },
    },
    human: {
      async ask(question, context) {
        const approvalId = await createCloudQuestion(env, db, {
          tenantId, cloudAgentRef, executionId, agentLabel, question, context,
        });
        return { paused: true, approvalId, note: 'Question sent to a human. The run is paused until it is answered; you will resume with the answer.' };
      },
    },
    // Durable cross-run memory. Project-scoped runs use the SHARED `project_facts`
    // store (recalled by every surface); else the tenant-wide `agent_memory` twin.
    memory: buildCloudMemoryCapability({ db, env, tenantId, projectId }),
    // Read a public URL (docs / an API spec / a linked issue) so the agent isn't
    // limited to what the repo already contains — and, when the TENANT has a BYO
    // search key, discover that URL in the first place. Search is metered per query,
    // so its backing (and therefore `web.search`, and therefore the `web_search`
    // schema) is present only when a usable key resolved; otherwise this is
    // fetch-only exactly as before. SSRF egress policy + byte cap + timeout + the
    // read-through cache all live in cloudWeb.
    web: buildCloudWebCapability({
      env,
      search: args.webSearch ? { vendor: args.webSearch.vendor, apiKey: args.webSearch.apiKey, meter: { db, tenantId } } : null,
    }),
  };
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

  // Tenant "LLM" (migration 0211): if `model` is a `tenant_model:<slug>` ref, expand
  // it to its configured base model + system directives so THIS run honours the
  // tenant's model config on every surface (Worker/DO/Container all funnel here).
  // `baseModel: null` means "run on the plan default" → effectiveModel = undefined.
  // Unknown/non-tenant refs resolve to null and pass through unchanged.
  const tenantModel = await resolveTenantModel(env, db, tenantId, model);
  const effectiveModel = tenantModel ? (tenantModel.baseModel ?? undefined) : model;
  // Curated platform tools give this run the SAME work-management reach the Brain
  // has (create follow-up tasks, update OKRs, read what's remaining) — advertised
  // alongside the repo/file tools and dispatched in-process below. The prompt
  // guidance that makes the agent USE them lives in prepareCloudRun so every
  // surface (Worker/DO durable + the container) gets it once (DRY).
  // Self-gating web search. Resolved ONCE per run (not per step): `web.search` is a
  // TENANT capability, not a surface one — it needs a BYO search-vendor key, because
  // search bills per query and the platform funds none. A resolved key adds
  // `web.search` to BOTH the capability set the provider reports and the schemas sent
  // to the model, from the same value, so the two can never drift. No key → the base
  // set, and the run is byte-identical to fetch-only behaviour.
  const webSearchCred = await resolveWebSearchCredential(env, db, tenantId);
  const surfaceCaps = cloudSurfaceCaps({ webSearch: webSearchCred !== null });
  const cloudTools = [...cloudAgentToolsFor(surfaceCaps), ...cloudAgentPlatformToolSchemas()];
  const effectiveSystemPrompt = tenantModel?.directives
    ? `${tenantModel.directives}\n\n${systemPrompt}`
    : systemPrompt;

  // Project Evermind consumer. The dispatcher (runtimeRoutes `withDefaultModel`)
  // emits a concrete `evermind/<ref>` as the run's model when the project is
  // configured to run its agents on its own self-learning model (resolved ONCE at the
  // run boundary — pull-on-boundary). That ref is a direct vendor route, NOT a catalog
  // id, so it must bypass the coding-pool `pickCloudModel` selection and hard-pin: the
  // in-process evermind vendor (uploads-threaded) serves it, and a toy-model failure
  // cascades to the coding backstop (graceful). [[evermind-learning-architecture]]
  const projectInferenceModel = typeof effectiveModel === 'string' && effectiveModel.startsWith('evermind/')
    ? effectiveModel
    : undefined;

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
    { role: 'system', content: effectiveSystemPrompt },
    { role: 'user', content: userContent },
  ];
  const startStep = opts?.resume?.step ?? 0;
  const maxThisCall = opts?.maxSteps ?? MAX_CLOUD_TOOL_STEPS;

  // Resolve the tenant's plan routing once (which model pool / vendor key), then
  // dispatch through THAT plan proxy — so a Pro cloud agent reaches premium coding
  // models instead of the fixed free pool. Reused across every turn (and persisted
  // so DO ticks don't re-query the plan).
  const routing = opts?.resume?.routing ?? await resolveCloudRouting(env, tenantId);
  // A connected Claude subscription powers any direct-Claude turn in the cascade
  // (Bearer + oauth, free to us); BYO OpenAI/Google/Anthropic api-keys override the
  // operator keys for their vendors (tenant-funded → byo). Resolved once per
  // loop/tick (NOT per turn) and re-resolved fresh each DO tick so a rotated token
  // stays valid. Empty when the tenant connected nothing — operator-key floor.
  const loopCreds = await resolveTenantLlmCredentials(env, tenantId);
  const { anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, vendorKeys: tenantVendorKeys } = loopCreds;
  // `codingOnly` keeps the failover cascade inside the curated coding pool, so an
  // exhausted free run escalates to the paid coding backstop instead of degrading
  // onto a non-coder (gemini-flash-lite) or a tool-unreliable vendor (Ollama).
  const proxy = llmProxyForPlan(env, routing.effectivePlan, routing.premiumOverride, { backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true, ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}), ...(openaiCodexAuth ? { openaiCodexAuth } : {}), ...(xaiOAuthToken ? { xaiOAuthToken } : {}), ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}), ...(loopCreds.vendorPriority.length ? { byoVendorPriority: loopCreds.vendorPriority } : {}), ...(loopCreds.configuredProviders.length ? { byoRequired: true } : {}) });

  // Per-run model pin. A coding agent must drive the WHOLE task on one model, not
  // hop between pool models per turn (the gateway's round-robin cursor would
  // otherwise pick a different model each step → inconsistent behaviour).
  //   • Explicit selection (user pick / agent base_model, when it's a real catalog
  //     id) → hard pin via `modelStrict`: the gateway dispatches ONLY that model,
  //     no silent swap.
  //   • No (or typo'd) selection → the plan's best coding model as a soft seed,
  //     then lock onto whatever the gateway resolved on the first turn (so a cold
  //     model can fail over once — but only once, at the start).
  // Learned Model Routing (PRD 13): on the FIRST tick, resolve the task's action
  // type + the empirically-best models for it (finest scope with signal), so the
  // soft seed prefers what has historically worked for this kind of task. Resume
  // ticks skip this — they already locked their pin. Best-effort: the helper returns
  // no stats under the kill switch / cold-start / any error, so the seed degrades to
  // the curated default (today's behaviour). The interactive SSM bias (if any) nudges
  // the order on top of the shared table.
  const learned = opts?.resume ? { actionType: 'other' as ActionType, actionStats: undefined } : await resolveLearnedRoutingInputs(env, db, { tenantId, projectId, taskRow });
  // The resolved pin rides CloudLoopState so the DO surface keeps every tick on it.
  // A live project-Evermind pin hard-pins the project model (strict) and skips the
  // coding-pool selection entirely; otherwise the normal learned-routing seed runs.
  const pick = projectInferenceModel
    ? { model: projectInferenceModel, strict: true as const }
    : pickCloudModel(effectiveModel, routing.effectivePlan, routing.premiumOverride, {
        actionType: learned.actionType,
        actionStats: learned.actionStats,
        bias: opts?.routingBias,
        // Context-aware seed: don't pick a small-window model for a big first turn.
        estimatedTokens: estimateRequestTokens(messages, cloudTools),
        // A free tenant may pin a model their connected provider (BYO) serves.
        byoVendors: byoVendorIdSet(providersFromCredentials(loopCreds)),
        // Tenant BYO precedence — lead with the owner's chosen account (e.g. Meta first).
        byoVendorPriority: loopCreds.vendorPriority,
        // A PREMIUM pin is honoured only with a paid plan + a validated card; otherwise
        // it's ignored and the run uses the plan's coding default.
        premiumEntitled: routing.premiumEntitled,
      });
  // Mutable: a 429 on the pinned model drops the strict pin so the proxy cascades
  // (see the per-turn cascade below); the run then stays unpinned for later turns.
  let strictPin = pick.strict;
  let activeModel: string = opts?.resume?.pinnedModel ?? pick.model;

  // Make the model choice legible on the timeline — once, at run start (resume ticks
  // already locked their pin). The companion to llm.complete + coding_model_degraded:
  // those report what RAN; this reports why it was chosen. Best-effort.
  if (!opts?.resume) {
    await emitModelSelection(db, {
      tenantId, cloudAgentRef, executionId,
      requested: model, pick, plan: routing.effectivePlan, premium: routing.premiumOverride,
      actionType: learned.actionType,
    });
  }

  let finalOutput = '';
  let finished = false;
  let cancelled = false;
  // Set when the agent calls ask_human: the run pauses on a human question (not a
  // finish — no PR, not terminal). Carries the approval id so the caller can park
  // the run in `paused` and resume it when the question is answered.
  let awaitingInput: { approvalId: string; question: string } | null = null;
  let step = startStep;
  // Honesty gate: this executor has no shell, so it can never actually run a
  // build/type-check/test. Reject a finish that claims one passed — once — to force
  // an honest summary; the opened PR is annotated unverified regardless.
  let finishBlockedOnce = false;
  // Anti-stub gate: count finish attempts blocked because committed files still
  // contain placeholder/stub code, so the agent is forced to ship a real
  // implementation (or delete the dead file) — see MAX_PLACEHOLDER_FINISH_BLOCKS.
  // Carried across DO ticks via resume state (the durable surface runs one step per
  // tick, so a per-call counter would reset before the cap was ever reached).
  let placeholderBlocks = opts?.resume?.placeholderBlocks ?? 0;
  // Pre-finish completeness self-review (ROADMAP #38): block a finish that produced
  // NO code deliverable exactly ONCE, re-prompting the agent to verify it met the
  // PRD requirements. A genuine "nothing to change" run finishes on the retry; a
  // premature one ("wrote a plan, shipped nothing") is forced to reconsider. Carried
  // across DO ticks via resume state so the block isn't re-armed every tick.
  let noDeliverableBlocked = opts?.resume?.noDeliverableBlocked ?? false;

  // Governance gates (compile-primitive policy modality). Resolved ONCE: a resumed
  // run reuses the gates persisted on its first tick (the payload may not survive
  // to later ticks); a fresh run seeds them from the dispatch payload.
  // `policyAskedGates` holds one entry per already-approved CALL — keyed by
  // {@link policyGateCallKey} (gate + tool + argument hash), NOT by gate id — so an
  // approval covers exactly the call a human saw. A retried identical call proceeds;
  // a different call through the same gate is asked again.
  const policyGates: PolicyGate[] = opts?.resume?.policyGates ?? opts?.policyGates ?? [];
  const policyAskedGates = new Set<string>(opts?.resume?.policyAskedGates ?? []);

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

  // The surface's capability backing + the tool context handed to every dispatch.
  // The provider closes over the LIVE `writtenPaths` set + `repoCtx`, so write/delete
  // bookkeeping and the base→branch read switch stay correct as the run progresses.
  const provider = buildCloudProvider({
    env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths,
    capabilities: surfaceCaps, webSearch: webSearchCred,
  });
  const toolCtx: ToolContext = { caps: provider, signal: abortController.signal };

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

    // Compress the conversation BEFORE the paid call so a long run never re-sends a
    // ballooning history (the 97K-token turn that 413'd). Compacts only when over
    // budget; summarizes the bulky middle into a builder-memory note (free pool),
    // falling back to elision. Mutated IN PLACE so the compacted form persists into
    // CloudLoopState — the DO surface won't re-summarize the same prefix next tick.
    const compaction = await compactMessages(messages, CLOUD_COMPACT_DEFAULTS, buildGatewaySummarizer(env));
    if (compaction.compacted) {
      messages.length = 0;
      messages.push(...compaction.messages);
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'context.compacted', category: 'llm',
        detail: { step, beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens, summarized: compaction.summarized, droppedMessages: compaction.droppedMessages },
        result: `compressed ~${compaction.beforeTokens} → ~${compaction.afterTokens} tokens (${compaction.summarized ? 'builder-memory summary' : 'elided'})`,
      });
    }

    // Per-step dynamic directive seam: prepend an ephemeral system directive
    // (e.g. the V3 limbic affect block) to THIS request only — `messages` (the
    // persisted conversation the loop owns) is left untouched, so the directive
    // can change every tick without mutating saved state. None → unchanged.
    const requestMessages = opts?.dynamicSystem
      ? [{ role: 'system', content: opts.dynamicSystem }, ...messages]
      : messages;

    const tGen0 = Date.now();
    let result!: Awaited<ReturnType<typeof proxy.complete>>;
    // Per-turn model cascade: a strict pin (or locked model) that the gateway
    // rate-limits (429) would otherwise terminate the whole run. Instead, drop the
    // strict pin ONCE and let the proxy walk its full chain (LlmProxyService already
    // cascades); then lock onto whatever it resolves so later turns / DO ticks stay
    // there. Benefits every surface (durable / Worker / container).
    for (let attempt = 0; ; attempt++) {
      try {
        result = await proxy.complete(
          {
            messages: requestMessages as unknown as ChatMessage[],
            tools: cloudTools,
            tool_choice: 'auto',
            ...(activeModel ? { model: activeModel, ...(strictPin ? { modelStrict: true } : {}) } : {}),
            // Personality temperature (compiled from the agent's/personas' traits).
            ...(opts?.execParams?.temperature != null ? { temperature: opts.execParams.temperature } : {}),
            // Personality reasoning levers (thinkLevel/reasoningLevel) → the correct
            // vendor param via reasoningCapability (Anthropic `thinking` / OpenAI
            // `reasoning_effort`), surviving to the vendor as extraBody. Attached ONLY
            // on a strict pin so it never rides a cascade onto a vendor that would 400
            // on an unknown key; unsupported models return nothing (no change). Note the
            // direct-Anthropic vendor enables `thinking` alongside tools on the FIRST
            // (planning) turn — detected here as "no assistant turn yet in the persisted
            // conversation" and threaded as the `isFirstTurn` hint — and keeps it off on
            // continuation turns (whose thinking block was lost in the OpenAI round-trip);
            // for a pinned OpenAI o-series/gpt-5 coder it lands `reasoning_effort`.
            ...(strictPin
              ? reasoningParamsForModel(activeModel, opts?.execParams, {
                  isFirstTurn: !messages.some((m) => (m as { role?: string }).role === 'assistant'),
                }) ?? {}
              : {}),
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
      // Retry a pinned/locked model that the gateway rate-limited (429) OR that the
      // request overflowed (413 — context window too small), and only once. 413 needs
      // this because a strict pin gets NO in-proxy cascade: dropping the pin lets the
      // proxy walk to a bigger-window model instead of hard-failing the run.
      const retryable = result!.response.status === 429 || result!.response.status === 413;
      if (!retryable || attempt >= 1 || (!strictPin && !activeModel)) break;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'model.cascade', category: 'llm',
        detail: { step, from: activeModel || null, reason: String(result!.response.status) },
        result: result!.response.status === 413
          ? 'pinned model context window too small — dropping pin, walking the cascade to a bigger-window model'
          : 'pinned model rate-limited — dropping pin, walking the cascade',
      });
      // Unlock for this turn AND the rest of the run: don't re-pin after a cascade.
      strictPin = false;
      activeModel = '';
    }
    if (cancelled) break;
    // Lock the non-strict run onto the model the gateway actually used on the
    // first turn, so every later turn (and DO tick) stays on it. Strict pins
    // already resolve to `activeModel`, so this is a no-op for them.
    if (!strictPin && result.resolvedModel) activeModel = result.resolvedModel;
    // Shared post-`complete` processing (metering + `llm.complete`/degraded/agent.message
    // telemetry) — identical to the container `llm` op. `notify: false`: the loop streams
    // its own final turn. The degraded comparison is the seed/pin (`pick.model`), not the
    // just-locked `activeModel`.
    const turn = await recordCloudLlmTurn(result, {
      env, db, tenantId, cloudAgentRef, executionId, taskId: taskRow.id, projectId,
      requestedModel: pick.model, fallbackModel: activeModel,
      effectivePlan: routing.effectivePlan, premiumOverride: routing.premiumOverride,
    }, { tGen0, step, notify: false });
    if (!turn.ok) return { ok: false, output: turn.error, cancelled, finished: true };
    const { content, toolCalls } = turn;
    if (content) finalOutput = content;

    if (toolCalls.length === 0) { finished = true; break; }

    // Echo the assistant turn (with its tool_calls) so tool results attach to it.
    messages.push({ role: 'assistant', content, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name ?? 'unknown';
      let parsed: Record<string, unknown> = {};
      try { parsed = tc.function?.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {}; } catch { /* leave empty */ }
      const tStart = Date.now();

      // Governance gate (compile-primitive policy modality): enforce BEFORE dispatch,
      // so a gate authored on the spec applies identically on every surface (this loop
      // runs on both the durable + Worker cloud surfaces). `block` refuses the tool —
      // the agent sees the refusal and must take another path; `require-approval` parks
      // the run on a human question (reusing the ask_human pause/resume path) the FIRST
      // time it is reached, then proceeds once the human has answered (the run resumes).
      const gate = evaluatePolicyGate(policyGates, name);
      let toolResult: Record<string, unknown>;
      let control: ToolControl | undefined;
      if (gate.action === 'block') {
        toolResult = { ok: false, error: `Blocked by governance policy: ${gate.reason}. Do not retry this tool — accomplish the task another way, or finish and explain why it cannot proceed.` };
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef, executionId,
          toolName: 'policy.blocked', category: 'tool', toolCallId: tc.id,
          detail: { tool: name, gateId: gate.gateId, reason: gate.reason },
          result: `Blocked ${name}: ${gate.reason}`,
        });
      } else if (gate.action === 'require-approval' && !policyAskedGates.has(policyGateCallKey(gate.gateId, name, parsed))) {
        // First encounter OF THIS CALL — ask a human and park. The answer resumes the
        // run; the call key is recorded (in resume state) so the re-reached identical
        // call proceeds (below), while a DIFFERENT call through the same gate is asked
        // on its own merits rather than riding the earlier approval.
        const question = `Approve the agent's use of "${name}"? ${gate.reason}`;
        const approvalId = await createCloudQuestion(env, db, {
          tenantId, cloudAgentRef, executionId, agentLabel,
          question,
          context: `Governance gate "${gate.gateId}" requires human approval before this tool may run with these arguments: ${JSON.stringify(parsed).slice(0, 500)}`,
        });
        policyAskedGates.add(policyGateCallKey(gate.gateId, name, parsed));
        awaitingInput = { approvalId, question };
        toolResult = { ok: false, error: `Paused for human approval of "${name}" (governance gate ${gate.gateId}).` };
      } else {
        // allow — or a require-approval gate already asked + answered.
        const platformTool = resolveCloudAgentPlatformTool(name);
        if (platformTool) {
          // Curated platform tool (create task / update OKR / read remaining work) —
          // run in-process, tenant-scoped, defaulting the project to THIS run's so a
          // follow-up task lands on the right project unless the model names another.
          // MANAGER role so the OKR/task writes the user asked for are permitted; the
          // subset is admin/destructive-free so this can't reach keys/security/etc.
          try {
            const data = await callBuiltinTool(db, {
              tenantId, tool: platformTool,
              arguments: { projectId, ...parsed },
              env, userId: cloudAgentRef ?? null, role: TenantRole.MANAGER,
            });
            toolResult = data && typeof data === 'object' ? (data as Record<string, unknown>) : { ok: true, result: data };
          } catch (e) {
            toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        } else {
          // Repo/file/static-check/human tools. Dispatch through the ONE capability-gated
          // registry — each reaches the repo / static-check / human ONLY via the injected
          // provider (so the same definition runs on-prem against a disk/shell provider).
          // `finish` and `ask_human` come back as CONTROL signals the loop interprets below.
          const dispatched = await cloudToolRegistry.dispatch(name, parsed, toolCtx);
          toolResult = dispatched.data;
          control = dispatched.control;
        }
      }

      if (control?.kind === 'finish') {
        const summary = control.summary;
        // Three finish gates, in order. Either yields a block message that forces the
        // agent to call finish again once it has corrected the run; null = ship.
        let finishBlock: string | null = null;
        if (repoCtx && !noDeliverableBlocked && hasNoCodeDeliverable(writtenPaths)) {
          // (0) Completeness self-review (ROADMAP #38): a code-bound run is finishing
          // with NO code deliverable (only the seeded PRD, or nothing). Block ONCE and
          // make the agent self-review the requirements — implement what's missing, or
          // explicitly confirm no code change was required — before an empty finish is
          // honored. A legitimate no-op run finishes on the retry.
          noDeliverableBlocked = true;
          finishBlock =
            'Before finishing: you have not committed any code changes for this task — only the PRD (or nothing) is on the branch. Re-read the task requirements and verify EACH is actually implemented. If work remains, use search_code/read_file to find the right place and write_file to implement it, then finish. If — and only if — this task genuinely requires no code change, call finish again and state explicitly why no change was needed.';
          await recordCloudToolEvent(db, {
            tenantId, cloudAgentRef, executionId,
            toolName: 'finish.blocked', category: 'tool',
            detail: { reason: 'no_deliverable' },
            result: 'Blocked finish: no code deliverable — self-review required',
          });
        } else if (summary && !finishBlockedOnce && assertsUnrunVerification(summary)) {
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
      } else if (control?.kind === 'ask_human') {
        // The tool already created the human question via the provider; park the run.
        // Echo the question turn so the answer (delivered as a user steer on resume)
        // attaches to a complete conversation, then close out this turn's tool call.
        awaitingInput = { approvalId: control.approvalId ?? '', question: control.question };
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

    // ask_human was called this turn — stop the loop and let the caller park the
    // run in `paused`. The conversation (incl. the tool result above) is captured
    // in `state` so the resume tick continues right where it left off.
    if (awaitingInput) break;
  }
  } finally {
    // Stop the cancel watcher (and let it settle) so its timer can't outlive the run.
    watcherDone = true;
    abortController.abort();
    await cancelWatcher.catch(() => { /* ignore */ });
  }

  // The ONE snapshot of everything the next durable tick must resume from. Both
  // non-terminal exits (paused-on-a-question, per-tick budget spent) hand back the
  // SAME shape — built here so a newly-persisted field can never be added to one exit
  // and forgotten at the other (exactly how `placeholderBlocks` came to reset every
  // tick, making its cap unreachable). Every counter/flag the loop carries ACROSS
  // ticks belongs in here.
  const resumeState = (): CloudLoopState => ({
    messages,
    writtenPaths: [...writtenPaths],
    step,
    pinnedModel: activeModel,
    routing,
    repoCtx,
    repoMiss,
    noDeliverableBlocked,
    placeholderBlocks,
    policyGates,
    policyAskedGates: [...policyAskedGates],
  });

  // Paused on a human question — do NOT finalize (no PR, not terminal). Hand back
  // the resume state + the awaiting marker so the surface parks the run in `paused`
  // and wakes the loop when the question is answered (the answer arrives as a steer).
  // Applies on BOTH surfaces (the Worker path inspects awaitingInput too).
  if (awaitingInput && !cancelled) {
    return {
      ok: true,
      output: finalOutput,
      cancelled: false,
      finished: false,
      awaitingInput,
      state: resumeState(),
    };
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
      state: resumeState(),
    };
  }

  const fin = await finalizeCloudRun(env, db, {
    tenantId, cloudAgentRef, executionId, taskRow, agentLabel,
    repoCtx, repoMiss, writtenPaths, finalOutput, cancelled,
  });
  return { ok: fin.ok, output: fin.output, cancelled, finished: true };
}

/** The runtime context an engine is constructed with (the surface-specific wiring
 *  that {@link AgentRunInput} deliberately omits). */
export interface CloudEngineContext {
  env: Env;
  db: Db;
  executionId: number;
  taskRow: { id: number; title: string; description: string | null };
  tenantId: number;
  projectId: number;
  agentLabel: string;
  cloudAgentRef?: string;
  isCancelled: () => Promise<boolean>;
  /** Learned Model Routing (PRD 13 §6.6): the interactive-launch SSM recall nudge
   *  parsed off the run payload. Absent on headless runs. Threaded to the loop's
   *  first-tick model seed. */
  routingBias?: Record<string, number>;
  /** Resolved assigned artifacts (skills/personas/content). Used by V3 to derive
   *  limbic setpoints from the assigned personas' psychometric profiles. */
  artifacts?: ResolvedArtifacts;
  /** Execution levers compiled from the personas + the agent's own personality
   *  (from {@link prepareCloudRun}). Passed through to the loop's per-turn LLM call. */
  execParams?: AgentExecParams;
  /** The agent's OWN psychometric JSON (ide_agents.psychometric). Folded into the
   *  limbic setpoints alongside the assigned personas. */
  agentPsychometric?: string | null;
}

/**
 * The cloud agent engine behind the shared {@link AgentEngine} seam — THE current
 * engine (V3). It drives {@link runCloudToolLoop} (the Claude-Agent-SDK tool loop)
 * with the limbic affective layer ALWAYS composed on top: it derives a task-appropriate
 * affective state via the shared, Worker-safe limbic compiler (`@builderforce/agent-tools`)
 * and injects the affect block through the loop's per-step {@link CloudLoopOpts.dynamicSystem}
 * seam — NOT by mutating the persisted prompt/conversation. That decoupling lets affect
 * evolve across DO ticks (see {@link CloudRunnerDO}). Cloudflare Workers can't run
 * `@webgpu/node`, so the cloud limbic is the deterministic heuristic regions only — GPU
 * *training* stays on-prem. Dispatch sites depend on the INTERFACE via
 * {@link resolveAgentEngine}, so the NEXT engine (a future V4) is a one-line wiring change.
 */
export class CloudLimbicEngine implements AgentEngine {
  readonly id = CURRENT_ENGINE_ID;
  constructor(private readonly rc: CloudEngineContext) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // Personality = setpoints (from the assigned personas' psychometric profiles);
    // dynamics = the task-appraised affect around those setpoints.
    const setpoints = await loadPersonaSetpoints(this.rc.env, this.rc.db, this.rc.artifacts?.personas ?? [], this.rc.agentPsychometric);
    const state = initialCloudLimbicState(this.rc.taskRow, setpoints);
    await recordLimbicState(this.rc.db, { tenantId: this.rc.tenantId, cloudAgentRef: this.rc.cloudAgentRef, executionId: this.rc.executionId }, state);
    const directive = buildLimbicBlock(state);
    // Drive the SAME unmodified V2 loop, injecting affect via the per-step seam.
    const r = await runCloudToolLoop(
      this.rc.env, this.rc.db, this.rc.executionId, this.rc.tenantId, this.rc.taskRow,
      this.rc.cloudAgentRef, this.rc.agentLabel, input.model, input.systemPrompt, input.userContent,
      this.rc.isCancelled, this.rc.projectId,
      { routingBias: this.rc.routingBias, ...(directive ? { dynamicSystem: directive } : {}), ...(input.policy?.gates ? { policyGates: [...input.policy.gates] } : {}), ...(this.rc.execParams ? { execParams: this.rc.execParams } : {}) },
    );
    return { ok: r.ok, output: r.output, cancelled: r.cancelled, finished: r.finished, awaitingInput: r.awaitingInput, state: r.state };
  }
}

/** The affective state a cloud run starts in: the assigned personas' resting
 *  setpoints, appraised against the task text. Pure + Worker-safe. */
export function initialCloudLimbicState(
  taskRow: { title: string; description: string | null },
  setpoints?: LimbicState,
): LimbicState {
  return appraiseTask(`${taskRow.title}\n${taskRow.description ?? ''}`, setpoints ?? neutralState());
}

/** Map a finished tick's coarse outcome to an amygdala event. */
function cloudTickEvent(result: { ok: boolean; finished: boolean; cancelled: boolean }): LimbicEvent | null {
  if (result.cancelled) return { kind: 'idle', intensity: 0.4 };
  if (!result.ok) return { kind: 'error', intensity: 0.7 };
  if (result.finished) return { kind: 'success', intensity: 0.6 };
  return { kind: 'progress', intensity: 0.3 };
}

/**
 * Advance the cloud affect one DO tick: appraise the tick's outcome (amygdala),
 * then relax toward the personality setpoints (hypothalamus). Pure — the DO
 * persists the returned state in its cursor and feeds it back as the next tick's
 * `dynamicSystem` directive. This is the cross-tick evolution the seam enables.
 */
export function evolveCloudLimbicState(
  prev: LimbicState,
  setpoints: LimbicState | undefined,
  result: { ok: boolean; finished: boolean; cancelled: boolean },
): LimbicState {
  const ev = cloudTickEvent(result);
  const after = ev ? applyDelta(prev, appraiseAmygdala(ev)) : prev;
  return homeostasis(after, setpoints ?? neutralState(), { rate: 0.1 });
}

/** Record the affective state on the Observability timeline (best-effort). No-op
 *  when the state is at rest (no directives). */
export async function recordLimbicState(
  db: Db,
  args: { tenantId: number; cloudAgentRef?: string; executionId: number },
  state: LimbicState,
): Promise<void> {
  const { directives, params } = compileLimbicState(state);
  if (directives.length === 0) return;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: 'limbic.appraise',
    category: 'context',
    detail: { state, params },
    result: `affective state: ${directives.length} directive(s)`,
  }).catch(() => { /* never block the run on telemetry */ });
}

/**
 * The single composition root for the cloud engine. There is ONE engine (the current
 * V3 = tool loop + limbic); every run resolves to it regardless of any legacy engine
 * value. The seam stays a function so the NEXT engine (a future V4) is a one-line swap
 * here, never a branch at the call sites. (Surface routing — durable DO / container /
 * worker — is a separate decision in `runtimeRoutes.ts`.)
 */
export function resolveAgentEngine(rc: CloudEngineContext): AgentEngine {
  return new CloudLimbicEngine(rc);
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
  // The PR this finalize opened, hoisted so the rollback snapshot below can record
  // exactly what a later revert would have to close.
  let openedPrNumber: number | null = null;
  let openedPrUrl: string | null = null;
  let openedPrRowId: string | null = null;
  // Atomic single-PR claim (0140): take it BEFORE the external create so this inline
  // run-end finalize can't open a duplicate PR alongside a concurrent human Done-drag
  // (which finalizes via openTaskPullRequest, taking the same claim). Lost claim =>
  // another path is opening the PR; skip the create here and treat it as "PR exists".
  const claimedInlinePr = repoCtx && writtenPaths.size > 0 && !cancelled
    ? await claimTaskPrOpen(db, taskRow.id).catch(() => false)
    : false;
  if (repoCtx && writtenPaths.size > 0 && !cancelled && claimedInlinePr) {
    const pr = await createPullRequest({
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
      title: `Task #${taskRow.id}: ${taskRow.title}`,
      body: `Changes for task #${taskRow.id}, by ${agentLabel}. Files: ${[...writtenPaths].join(', ')}.\n\n> ⚠ **Not verified in-agent.** This serverless executor has no shell and ran no build, type-check, lint, or tests. CI on this PR is the source of truth — do not merge on the agent's summary alone.`,
    }).catch(() => ({ ok: false as const, code: 'provider_error' as const, reason: 'pr failed' }));
    prOpened = pr.ok;
    // Release the claim on a failed create so a later finalize can re-attempt.
    if (!pr.ok) { noPrReason = pr.reason; await releaseTaskPrClaim(db, taskRow.id).catch(() => {}); }

    const autoMerge = cloudAutoMergeEnabled(env);

    // Record the PR row so the in-product Pull Request tab / approval flow can act
    // on it. Status reflects the policy: 'open' when awaiting human approval; when
    // auto-merge is enabled, it lands as 'merged' (or stays 'open' pending green CI).
    // Keep the row id so the immediate-merge branch can stamp its merge SHA (which
    // correlates the post-merge build back to this task).
    let prRowId: string | null = null;
    if (pr.ok) {
      openedPrNumber = pr.number;
      openedPrUrl = pr.url;
      const recordedStatus = autoMerge && !cloudAutoMergeRequiresGreen(env) ? 'merged' : 'open';
      const prRow = await recordPullRequestRow(db, {
        tenantId, segmentId: repoCtx.segmentId, projectId: repoCtx.projectId, repoId: repoCtx.repoId,
        taskId: taskRow.id, provider: repoCtx.provider, number: pr.number, url: pr.url,
        branchName: repoCtx.branch, baseBranch: repoCtx.base, status: recordedStatus,
      }).catch(() => null);
      prRowId = prRow?.id ?? null;
      openedPrRowId = prRowId;
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

  // ── rollback bookkeeping ────────────────────────────────────────────────────
  // Two mutually exclusive outcomes for the run's repository artifacts:
  //
  //  (a) The run finished and left work behind → SNAPSHOT it, so a human can
  //      revert this run later. This includes a run that produced files but whose
  //      PR create FAILED: the commits are still real work on a real branch, and
  //      the honest response is to make them revertable, NOT to delete them.
  //  (b) The run was CANCELLED → its half-written branch is residue → hand it to
  //      the shared teardown decision, which deletes it ONLY if it can prove the
  //      branch is nothing but this run's abandoned work.
  //
  // Failures do not reach here (the crash path finalizes via handleCloudRunCrash),
  // which calls the same teardown at ITS terminal branch. Both are best-effort and
  // must never change the run's own outcome.
  if (repoCtx && writtenPaths.size > 0) {
    if (cancelled) {
      await teardownRunBranch(env, db, {
        tenantId, executionId, taskId: taskRow.id, repoCtx,
        writtenPaths: [...writtenPaths], cloudAgentRef, agentLabel,
      }).catch(() => { /* teardown is a sweep — never fail a run over it */ });
    } else {
      await recordRunRollbackSnapshot(db, {
        tenantId, executionId, taskId: taskRow.id, repoCtx,
        writtenPaths: [...writtenPaths],
        prNumber: openedPrNumber, prUrl: openedPrUrl, prRowId: openedPrRowId,
        agentLabel,
      }).catch(() => null);
    }
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

  // Unified learning: contribute this run's output to the project's Evermind. The
  // coordinator adapts+diffs+merges IN ITS ALARM, so this finalize (a CF Worker/DO
  // with a tight CPU budget) pays NO training cost — it just enqueues the text. The
  // same door IDE + on-prem post to; the coordinator gates seeded/frozen itself.
  // Best-effort, never affects the run outcome. [[evermind-learning-architecture]]
  if (repoCtx?.projectId && !cancelled && output.trim().length >= 20) {
    // Thread the task title as the teacher prompt so a pinned frontier teacher learns
    // (task → ideal answer), not just a refinement of this run's output. Weight the
    // contribution by run QUALITY (merged > opened > wrote-files > no-op) instead of
    // the old text-length proxy, so a merged run teaches harder than a failed one.
    const learnWeight = finalizeLearnWeight({
      merged, prOpened, autoMergeFailed, producedChanges: writtenPaths.size > 0,
    });
    // Fan out to EVERY live Evermind this project targets (its own head + the IDE builds
    // grouped under it), not just the one projectId — the same resolver the chat learn
    // gate uses, so a cloud run contributes to all the project's Everminds. Best-effort.
    await contributeTextToProjectEverminds(env, db, tenantId, repoCtx.projectId, output, learnWeight, taskRow.title).catch(() => { /* best-effort */ });
  }

  // Publish this run's outcome onto the PR itself so a reviewer on github.com
  // sees the verdict where the merge decision is actually made — previously the
  // agent's result existed only in the Builderforce UI. Rides the same terminal
  // chokepoint as everything else here, so BOTH cloud surfaces (durable DO and
  // container) get it from this one call site.
  //
  // Publishes a Check Run when the tenant has the GitHub App installed, and
  // degrades to a commit status on a user token (the Checks API is App-only).
  // Strictly best-effort: annotating a PR must never change the run's outcome.
  if (writtenPaths.size > 0 || prOpened) {
    await publishAgentRunVerdict(env, db, tenantId, taskRow.id, {
      executionId,
      outcome: cancelled ? 'cancelled' : autoMergeFailed ? 'failed' : 'completed',
      // Reuse the run summary verbatim, including the unverified caveat — the
      // whole point of the check is that a reviewer sees what the agent claims
      // AND that it was not verified in-agent.
      summary: output + unverifiedNote,
      filesChanged: [...writtenPaths],
      appBaseUrl: resolveAppBaseUrl(env),
    }).catch(() => { /* best-effort */ });
  }

  // The check run above answers "green or red" in the merge box; it cannot carry
  // the narrative. Post the run summary onto the PR CONVERSATION too, so a
  // reviewer on github.com reads what the agent did — and the "not verified
  // in-agent" caveat — without leaving the review they're already in.
  //
  // Scoped to this executionId so a second agent pass on the same PR adds a
  // second summary, while a webhook redelivery or a retried finalize of THIS run
  // is deduped by the hidden marker. Strictly best-effort.
  if (prOpened && openedPrNumber != null && repoCtx?.repoId) {
    const files = [...writtenPaths];
    const fileBlock = files.length
      ? `\n\n**Files changed (${files.length})**\n${files.slice(0, 50).map((f) => `- \`${f}\``).join('\n')}${
          files.length > 50 ? `\n- …and ${files.length - 50} more` : ''
        }`
      : '';
    const runUrl = resolveAppBaseUrl(env) ? `\n\n[View the full run](${resolveAppBaseUrl(env)}/executions/${executionId})` : '';
    await postRepoPrComment(
      env, db, tenantId, repoCtx.repoId, openedPrNumber,
      `### 🤖 ${agentLabel} — task #${taskRow.id}\n\n${output}${fileBlock}${unverifiedNote}${runUrl}`,
      { kind: 'agent-run', scope: executionId },
    ).catch(() => { /* best-effort */ });
  }

  return { ok: !autoMergeFailed, output: output + unverifiedNote };
}

/**
 * Prep shared by both cloud surfaces (the durable `CloudRunnerDO` and the Cloudflare
 * Container): ensure a task PRD, load governance + assigned capabilities (all
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
): Promise<{ systemPrompt: string; userContent: string; execParams: AgentExecParams; agentPsychometric: string | null }> {
  const tPrep0 = Date.now();
  // The agent's OWN personality (independent of assigned personas) — folded into the
  // capability prompt block, the exec params, and (by the caller) the limbic setpoints.
  const agentPsychometric = await loadAgentPsychometric(env, tenantId, cloudAgentRef);
  const [prd, governance, capabilities, workspace, factsBlock, lessonsBlock] = await Promise.all([
    ensureTaskPrd(env, db, executionId, taskRow, tenantId, projectId, taskRow.id, agentLabel, model),
    loadGovernanceContext(db, tenantId, projectId, cloudAgentRef),
    loadCapabilityContext(env, db, artifacts, agentPsychometric),
    // The repo the agent runs against — its identity + top-level shape (so a wrong/
    // empty binding is visible before any LLM spend) AND what a prior pass already
    // committed to this branch (so a re-run reconciles instead of blindly appending).
    // Best-effort: a clean first run / no repo yields an empty workspace.
    loadWorkspaceContext(env, db, gitSecret(env), tenantId, taskRow.id),
    // Shared project memory — durable facts any surface (VS Code / on-prem / prior
    // cloud run) wrote for this project, recalled by the task text. Best-effort '' .
    buildProjectFactsBlock(env, db, tenantId, projectId, `${taskRow.title} ${taskRow.description ?? ''}`.trim()),
    // Evermind lessons — prior run outcomes AND incident post-mortem causes recalled by
    // the task text, so the agent doesn't repeat mistakes that caused incidents.
    buildEvermindLessonsBlock(env, db, tenantId, projectId, `${taskRow.title} ${taskRow.description ?? ''}`.trim()),
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

  // Record a FIRST-CLASS personality-application event (Residual 1) the moment this run
  // actually applies a personality — an in-process db write, NOT an HTTP self-call. Runs
  // exactly ONCE per run (prepareCloudRun is the single prep site every cloud surface —
  // Worker / durable DO / container — funnels through). Reuses the profile + merged exec
  // levers already resolved above (one compile, no per-turn N+1). `compilePersonalityApplication`
  // returns null when the agent's own psychometric yields no directives, so a V2 /
  // neutral-profile run records nothing and stays byte-identical. The GET now derives
  // only to backfill gaps. Best-effort — telemetry must never block a run.
  if (cloudAgentRef) {
    const application = compilePersonalityApplication({
      agentPsychometric,
      execParams: capabilities.execParams,
      personaIds: capabilities.summary.personas,
    });
    if (application) {
      await recordPersonalityEvent(env, db, tenantId, { agentRef: cloudAgentRef, executionId, ...application })
        .catch(() => { /* telemetry only — never block the run */ });
    }
  }

  // Auto-fix runs carry a remediation block (the post-merge build failure) in the
  // payload — surface it prominently so the agent fixes the REAL failing build.
  const remediation = parseRemediation(payload);

  // A "Send" on a TERMINAL run starts a NEW run carrying the user's message as a
  // follow-up directive. Surface it as the HEADLINE instruction so the run treats
  // the message as the goal — building on the prior run's committed work and the
  // (now PRD-recorded) directive, not redoing the task from scratch.
  const followUp = parseFollowUp(payload);

  // Validator acceptance-review run: the payload marks this run as a REVIEW, not
  // implementation work. Steer it explicitly (independent of the agent's persona) so
  // ANY agent dispatched with the review flag performs an acceptance review and reports
  // via reviews.record, rather than editing code.
  const isReviewRun = isValidatorReviewPayload(payload);

  // Incident-triage run: the payload marks this as the Incident Manager working an
  // open incident, NOT shipping code. Steer it (independent of persona) to analyse the
  // ticket, classify the affected system, page/escalate on-call, and post war-room
  // updates via the incidents.*/oncall.* tools.
  const isIncidentRun = isIncidentTriagePayload(payload);
  const incidentRunId = incidentIdFromPayload(payload);

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
    isReviewRun
      ? `## Acceptance review (do NOT edit code)\n\nThis is a VALIDATOR REVIEW of already-Done work — verify the ticket was genuinely completed against its PRD/requirements and the repository. Read the branch/PR and the relevant code with search_code / read_file, judge whether the deliverable is complete and correct, then call the \`builtin_reviews_record\` tool with your verdict ('complete' or 'gaps'), a short assessment, and any concrete gaps (each becomes a GAP ticket).\n\n**Anchor every gap you can to the code.** When a gap is about a specific line you read, pass \`path\` (repo-relative, exactly as it appears in the change) and \`line\` on that gap — it is then posted as an inline comment on the pull request, on that line, where a human reviewer will actually see it. Only anchor to files this change actually touched. Leave \`path\`/\`line\` unset for gaps about work that is MISSING (no tests, an unimplemented requirement) — those have nowhere to point and go in the review summary, which is equally visible. Do NOT invent a location to satisfy the field.\n\nDo NOT write_file / delete_file or change the ticket's status — you are reviewing, not implementing.`
      : null,
    isIncidentRun
      ? `## Incident triage (do NOT edit code)\n\nYou are the INCIDENT MANAGER working an OPEN incident${incidentRunId ? ` (incident \`${incidentRunId}\`)` : ''} — help-desk triage and response, NOT a code change. Steps:\n1. Read the incident with \`builtin_incidents_get\`; read the source ticket in the task description.\n2. **Search the knowledge base FIRST** with \`builtin_knowledge_search\` for prior similar incidents, RCAs, or known-errors — if this has happened before, reuse the documented workaround/resolution instead of starting from scratch.\n3. Work out WHICH SYSTEM the issue pertains to and record it with \`builtin_incidents_classify\`.\n4. Set an accurate severity with \`builtin_incidents_update\` (sev1 = full outage / broad impact … sev4 = minor).\n5. Page whoever is on call with \`builtin_oncall_page\` (check \`builtin_oncall_list\` first). Escalation to later tiers happens automatically on a timer until someone acknowledges.\n6. Post what you find and do to the war-room feed with \`builtin_incidents_add_note\`.\n7. When the incident is resolved, set its status to resolved with \`builtin_incidents_update\`, then **publish a post-mortem** with \`builtin_incidents_postmortem\` (root cause, contributing factors, resolution, what went well/wrong, and concrete action items) — it becomes a searchable Knowledge RCA, files the action items as remediation tasks, and teaches the workforce not to repeat the cause.\nDo NOT write_file / delete_file — you are triaging, not implementing.`
      : null,
    remediation
      ? `## Build failure to fix (attempt ${remediation.attempt}/${remediation.maxAttempts})\n\n${
          remediation.phase === 'pre_merge'
            ? 'The CI build on this task’s pull-request branch FAILED — it must be green before the PR can merge. Fix the cause below — do not re-do unrelated work.'
            : 'A previous change for this task was merged but the build then FAILED. Fix the cause below — do not re-do unrelated work.'
        }\n\n${remediation.buildError}${remediation.runUrl ? `\n\nCI run: ${remediation.runUrl}` : ''}`
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
    ? 'Call git_sync_latest FIRST, before editing: your branch may have been created earlier and fallen behind the base branch, so working without syncing builds on stale code and your PR could revert newer work. ' +
      'You also have git_status / git_diff / git_history to inspect the repo, and git_undo / git_redo to back out or reapply a commit. ' +
      'You HAVE a real shell: use run_command to install dependencies and run the project build, type-check, lint, and tests in the checked-out repo BEFORE you finish. Fix anything that fails. Only claim a check passed if you actually ran it and saw it pass; CI on the PR re-verifies.'
    : 'You CANNOT run builds, type-checks, lint, or tests here — this executor has no shell. Those run in CI on the pull request your changes open, and that CI is the source of truth. There is NO run_code/run_command tool; if you want to acknowledge verification, call run_checks. NEVER state that a check passed, succeeded, is clean, or is resolved — you cannot run one. Write correct, complete code and finish with an honest summary.';
  const systemPrompt = [
    'You are a BuilderForce agent executing a project task against a real repository. Follow the PRD, architecture spec, and project rules exactly. ' +
    'Workflow: use search_code FIRST to locate where a symbol/string/feature lives across the whole repo (one call) — do NOT read files one by one to find references; ' +
    'use list_files to understand structure, read_file to read any file you intend to change (preserve existing code — only change what the task needs), ' +
    'then write_file with the FULL updated content (no bracketed placeholders) for each deliverable file. ' +
    'If search_code returns 0 matches for the thing a task says to change/remove, that means it is not in the codebase — say so in your summary instead of inventing an unrelated edit. ' +
    'If the bound repository (see "Repository / workspace") has no files related to the task, report that the wrong repo appears bound and name it — do NOT produce a conceptual stand-in against unrelated code. ' +
    'Do not narrate your plan, repeat findings, or emit progress summaries between tool calls — act through the tools and reserve assistant text for information the user actually needs. ' +
    'Do NOT call finish while any deliverable file is still a stub/placeholder or any requirement in the task/PRD is unimplemented — keep listing, reading and writing files until the task is genuinely complete. ' +
    'Do not claim the task is completed merely because you investigated it or described a fix; completion requires the requested repository changes to be written and reconciled. ' +
    'Reconcile the branch against the task, do not just append: if a file already on this branch (see "Files already on this branch") is dead code — a stub, an unreferenced file, or something that should not ship in this PR — remove it with delete_file (confirm it is unused via search_code first). The PR should contain only the files the task genuinely needs. ' +
    'When you finish, your committed changes are opened as a PULL REQUEST for human review (a person approves the merge in-product); they are NOT auto-deployed — so the PR must contain the COMPLETE, working change, not a partial scaffold. Call finish with a summary only once everything the task requires has been written. ' +
    shellLine + ' ' +
    'If no repository is bound, return the complete deliverable in your final summary instead. Make explicit, reasonable assumptions where specifics are unknown.',
    // Platform (project-management) tools — advertised alongside the repo tools on
    // every cloud surface (durable + container). This is what lets a run manage the
    // project as it works instead of silently dropping out-of-scope findings.
    'You ALSO have PLATFORM tools (prefixed `builtin_`) to manage the project as you work — they act on the SAME project boards the humans use, not the repo. '
    + 'Use `builtin_tasks_list` / `builtin_tasks_get` to see what is already tracked; '
    + '`builtin_tasks_create` to file a NEW task for any gap, bug, or follow-up work you find that is OUT OF SCOPE for THIS task — do NOT silently drop it, capture it as a task so it is not lost; '
    + '`builtin_tasks_update` to reflect progress; and `builtin_objectives_update` / `builtin_key_results_update` to update the OKR/objective progress your work advances. '
    + "They default to THIS run's project; pass an explicit projectId only to target another. "
    + 'When you finish, base any "what remains" statement on real state — the tasks you actually created plus `builtin_tasks_list` — never a guess.',
    capabilities.promptBlock || null,
    factsBlock || null,
    lessonsBlock || null,
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userContent, execParams: capabilities.execParams, agentPsychometric };
}

/**
 * The single PENDING/SUBMITTED → RUNNING transition for BOTH cloud surfaces (the
 * durable `CloudRunnerDO` and the Cloudflare Container kickoff). Routes through
 * {@link RuntimeService.update} — the one routine that also moves the ticket to In
 * Progress, records metrics, and writes the audit event — then announces the new
 * status to live subscribers. Best-effort: a row that already raced to a
 * terminal/cancelled state makes `markRunning` throw, which we swallow rather than
 * clobber. Funnelling both executors through here is what stops them drifting (the
 * container surface used to skip RUNNING entirely, so its card sat on "pending" for
 * the whole live run).
 */
export async function markCloudExecutionRunning(runtimeService: RuntimeService, executionId: number): Promise<void> {
  let running: Awaited<ReturnType<RuntimeService['update']>>;
  try {
    running = await runtimeService.update(executionId, { status: ExecutionStatus.RUNNING });
  } catch {
    return; // already non-pending (cancelled/terminal) — leave it
  }
  notifyExecutionSubscribers(executionId, {
    type: 'status_change',
    executionId,
    status: running.status,
    execution: running.toPlain(),
    ts: new Date().toISOString(),
  });
}

