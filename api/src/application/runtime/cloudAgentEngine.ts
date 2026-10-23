import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getLatestBlueprint } from '../blueprint/blueprintDetection';
// The engine's identity and model-routing slices now live in their own modules —
// see cloudAgent/agent.ts for why the original 4,117-line file was broken up.
// Re-exported below because existing importers reference them through this module.
import {
  AGENT_DEFAULT_MODEL_SENTINEL, DEFAULT_CLOUD_REF, agentAllowsHostExecution,
  loadAgentPsychometric, resolveCloudAgent, type ResolvedCloudAgent,
} from './cloudAgent/agent';
import {
  emitCodingModelDegraded, emitModelSelection, hasVendorKeys, isCodingModelDegraded,
  refuseCloudRunWithoutByo, resolveCloudRouting, resolveLearnedRoutingInputs,
  cloudRunRoleForModelPin, requestedModelForRole,
  type CloudRouting, type LearnedRoutingInputs,
} from './cloudAgent/routing';
export {
  AGENT_DEFAULT_MODEL_SENTINEL, DEFAULT_CLOUD_REF, agentAllowsHostExecution,
  loadAgentPsychometric, resolveCloudAgent,
} from './cloudAgent/agent';
export type { ResolvedCloudAgent } from './cloudAgent/agent';
export {
  emitCodingModelDegraded, emitModelSelection, isCodingModelDegraded,
  refuseCloudRunWithoutByo, resolveLearnedRoutingInputs,
  cloudRunRoleForModelPin, requestedModelForRole,
} from './cloudAgent/routing';
export type { CloudRouting, LearnedRoutingInputs } from './cloudAgent/routing';
import {
  cloudRunRole, cloudStallStep, completeUnderRunPolicy, recordModelCascade,
  recordStallStep, resumeCloudRunModelState, turnRequestFields,
  type CloudRunModelState,
} from './cloudAgent/cloudRunModelPolicy';
import {
  applyVerifyPhase, commitRunMemory, describeVerifyOutcome, recordRunVerifyEvents, runVerifyPhase,
} from './cloudAgent/runEndMemory';
import { codingFallbackSurface } from '../llm/codingFallbackSurface';
import { pricesForCall } from '../llm/catalogView';
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
import { and, eq } from 'drizzle-orm';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { buildMemoryCapability } from '../memory/memoryService';
import { approvedSkillsForRun, buildSkillAuthoringCapability } from '../skills/tenantSkillService';
import { rankSkillsForTask, renderSkillCatalogBlock, workspaceSkillSummaries } from '../skills/skillLibrary';
import { recordRunReflection, skillReflectionDirective } from '../skills/skillReflection';
import { isMemoryScope } from '../../domain/memory/memoryScope';
import { buildCoordinationCapability, claimWriteLease, guardRepoWrite } from '../coordination/coordinationCapability';
import { releaseAllForExecution, type LeaseHolder } from '../coordination/leaseService';
import { coordinationScopeKey } from '../../domain/coordination/resourceKey';
import { fetchCached } from './cloudWeb';
import { searchOwnedThenDiscover } from '../webSearch/demandSearch';
import { isValidatorReviewPayload } from '../validation/validatorReviewMarker';
import { recordActivity, SYSTEM_ACTOR } from '../activity/activityLog';
import { isIncidentTriagePayload, incidentIdFromPayload } from '../incident/incidentTriageMarker';
import { resolveTicketRepoContext, commitAgentFile, deleteAgentFile, type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { resolveTaskRepoRouter, recordRepoWrite, type TaskRepoRouter } from '../repos/taskRepoSet';
import { commitPrdAsPendingChange, taskPrdRepoPath } from '../repos/commitPrdToRepo';
import { resolveRepoRefSha } from '../repos/commitFileToRepo';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from '../repos/mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from '../repos/recordPullRequestRow';
import { publishAgentRunVerdict } from '../checks/publishTaskVerdict';
import { postRepoPrComment } from '../repos/postPrComment';
import { openClaimedPullRequest, openTaskRepoSetPullRequests } from '../repos/openTaskPullRequest';
import { readRepoFile, listRepoFiles, searchRepoCode, listBranchDiff } from '../repos/readRepoContents';
import { verifyWrittenFiles } from '../repos/verifyWrittenFiles';
import { pollBranchCi } from '../ci/pollCommitCiStatus';
import { CODING_BACKSTOP_MODELS, RECOGNIZED_CODER_MODELS, codingModelsForPlan, estimateRequestTokens, llmProxyForPlan, pickCloudModel, type ChatMessage, type EffectivePlan } from '../llm/LlmProxyService';
import type { ArcStage } from '@builderforce/workload';
import { byoRoutingOptions } from '../llm/tenantProxy';
import { evaluatePremiumModelAccess } from '../../domain/tenant/planFeatures';
import { TenantPlan } from '../../domain/shared/types';
import { compactMessages, buildGatewaySummarizer, toolsTokensOf, CLOUD_COMPACT_DEFAULTS } from '../llm/compactMessages';
import { resolveTenantLlmCredentials, byoVendorIdsFromCredentials, type TenantVendorKeys } from '../llm/tenantProviderKeyService';
import { assertCloudRunByo, type CloudByoFailure } from '../llm/cloudByoPolicy';
import { cloudAgentPlatformToolSchemas, resolveCloudAgentPlatformTool, callBuiltinTool } from '../llm/builtinMcpService';
import { durableRepoSemantic, durableRunCaps, prepSurfaceCaps } from './cloudAgent/runSurfaceCaps';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { openCostLoopSession, type CostLoopState } from './costLoop/costLoopSession';
import { workModeToolingPrompt } from './costLoop/workModePrompt';
import { cloudTierLadder } from './costLoop/verifierCascade';
import type { LoopGuardDeps } from './costLoop/loopGuards';
import { withAnswerReplay } from './costLoop/answerReplay';
import { evaluateFinishGates, finishGateSnapshot, initialFinishGateState, matchesRequiredReviewSignoff, missingReviewVerdictMessage, type RequiredReviewSignoff } from './cloudAgent/finishGates';
export { matchesRequiredReviewSignoff, missingReviewVerdictMessage, type RequiredReviewSignoff } from './cloudAgent/finishGates';
import { cloudReasoningExecParams, cloudRoutingExploration, toolRowCodecOptions } from './costLoop/runLevers';
import { isCostLeverOn } from '@builderforce/cost-levers';
import { ensureTaskPrdRecord, appendTaskPrdRevision, editTaskPrdSection, findTaskPrimarySpec } from '../prd/taskPrd';
import { loadCapabilityContext, loadPersonaSetpoints } from '../artifact/capabilityContext';
import { recordPersonalityEvent, compilePersonalityApplication } from '../persona/recordPersonalityEvent';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { applyPendingSteering, startCancelWatcher, CLOUD_RUN_CANCELLED_REASON } from './cloudLoopControl';
import { notifyExecutionSubscribers } from './executionEvents';
import { coercePausedLoopState, pauseExecutionForQuestion, withPausedToolResults, PAUSED_TOOL_RESULT_NOTE } from './executionPause';
import {
  CLOUD_RUN_TENANT_ROLE, cloudAgentToolsFor, cloudToolRegistry, policyGateCallKey,
} from './cloudAgentTools';
import {
  CURRENT_ENGINE_ID, evaluatePolicyGate, toolCallPaths, applyStringEdit, editFacts,
  type AgentEngine, type AgentRunInput, type AgentRunResult, type CapabilityProvider, type ToolContext, type PolicyGate, type AgentExecParams, type Capability,
  type PrdWriteCapability, type PrdUpdateResult,
} from '@builderforce/agent-tools';
import {
  appraiseTask, buildLimbicBlock, compileLimbicState, neutralLimbicState,
  applyLimbicDelta, appraiseAmygdala, homeostasis,
  type LimbicState, type LimbicEvent,
} from '@seanhogg/builderforce-memory-engine/limbic';
import { runAgentLoop, openAiChatCodec, readOpenAiToolCalls, type LoopHooks, type LoopPorts, type LoopResult } from '@builderforce/agent-loop';
import { buildLiveOrchestration } from './cloudLiveOrchestration';
import { isChildDelegation, meterExecutionIdOf, type CloudRunDelegation } from './cloudRunDelegation';
import { liveChildrenFinishBlock } from './cloudChildRuns';
import { resolveAgentPersonaBrief } from '../agent/agentPersonaBrief';
import { imageAdvertisedTools, readToolManifest } from './imageToolHandshake';
import { renderRunContext, summarizeBlocks, type RunContextBlock } from '@builderforce/run-context';
import { RUN_CONTEXT_ORDER } from './runContextSource';
import { buildRunContext } from './runContextService';
import { parseRemediation, parseFollowUp, parseRoleInstruction, parseCloudAgentRef, parseModel, parseOriginatingChatId } from './cloudDispatch';
import { classifyTaskAction } from '../llm/classifyTask';
import { deriveAllocationCategory } from '../llm/allocationCategories';
import {
  learnedRoutingEnabled,
  normalizeActionType,
  scopeHasSignal,
  type ActionModelRankStat,
  type ActionType,
} from '@builderforce/learned-routing';
import { getRoutingTable, MIN_SAMPLES, type RoutingScope } from '../llm/routingTable';
import { resolveTenantModel } from '../llm/tenantModelService';
import { reasoningParamsForModel } from '../llm/reasoningCapability';
import { contributeTextToProjectEverminds } from '../llm/projectEvermind';
import { resolveEvermindCodingRoute } from '../llm/evermindCodingEvalStore';
import { modelSupportsTools } from '../llm/vendors';
import { scoreRunOutcome, finalizeLearnWeight, runProducedOutput } from './scoreRunOutcome';
import { recordCloudToolEvent } from './cloudToolEvents';
import { recordRunRollbackSnapshot, teardownRunBranch, teardownCrashedRunArtifacts } from './runRollback';
import { handleCloudRunCrash } from './cloudSelfHeal';
import { cloudCrashReason } from './orphanReasons';
import { RuntimeService } from './RuntimeService';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import { resolveAppBaseUrl } from '../../env';
import type { Env } from '../../env';
import { isAgentRunnable } from '../../domain/containment/agentState';
import { recordTypedExecutionClaim } from '../provenance/finishClaimService';
import { authorizeCredentialDelegation, delegateCredential, ensureAgentRunIdentity, revokeRunPrincipal } from '../agentIdentity/agentRunIdentity';
import { checkRunLimits } from '../../domain/containment/runLimits';
import { isHumanOrExternalOutputTool, trustNotice } from '../../domain/trust/contentTrust';
import { inspectOutboundContent, recordContextContribution } from '../trust/trustService';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { boards, executionLimits, executions, tasks, ideAgents, taskFileChanges } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { submittingUserId } from './dispatcherLabel';
import { isPremiumCapExhausted } from '../llm/usageLedger';
import {
  agentCommitMessage, buildPrdCapability, ensureTaskPrd, loadWorkspaceContext,
  recordPrdDirective, recordTaskFileChange,
  type WorkspaceContext,
} from './cloudAgent/prd';
export { ensureTaskPrd, recordPrdDirective } from './cloudAgent/prd';
import {
  containerContextVersionKey, heartbeatExecution, invalidateContainerRunContexts,
  isExecutionCancelled, loadContainerRunContext, type ContainerRunContext,
} from './cloudAgent/runContext';
export {
  containerContextVersionKey, invalidateContainerRunContexts, loadContainerRunContext,
} from './cloudAgent/runContext';
import { OP_HANDLERS } from './cloudAgent/containerOps';

/**
 * The cloud tool-audit emitter now lives in `./cloudToolEvents` (so modules this
 * engine depends on can emit without an import cycle). Re-exported here because
 * this module has always been its public door — every existing importer, in this
 * file and across the routes, keeps working unchanged.
 */
export { recordCloudToolEvent };


export { parseLlmChoice, recordCloudUsage } from './cloudAgent/cloudLlmTurn';
import { imageRunTurn, recordCloudLlmTurn } from './cloudAgent/cloudLlmTurn';
import { strictWhenConnected } from '../llm/fundingOrder';

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
  opts?: {
    /** WHICH image is calling. The op protocol is shared verbatim between the
     *  Cloudflare Container and the GitHub Actions runner, and every op is
     *  surface-agnostic — except `ask_human`, whose resume has to redispatch to the
     *  transport the run actually came from. The caller knows; nothing in the
     *  execution row reliably does. Defaults to 'container' (the original caller). */
    surface?: 'container' | 'github_actions';
  },
): Promise<{ status: number; body: unknown }> {
  const { tenantId, taskId, projectId, cloudAgentRef, agentLabel, model } = ctx;
  const handler = OP_HANDLERS[op];
  if (!handler) return { status: 400, body: { error: `unknown op '${op}'` } };
  return handler({
    env, db, ctx, executionId, args, runtimeService,
    surface: opts?.surface ?? 'container',
    engine: { imageRunTurn, finalizeCloudRun },
    tenantId, taskId, projectId, cloudAgentRef, agentLabel, model,
    taskRow: { id: taskId, title: ctx.taskTitle, description: ctx.taskDescription },
  });
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
export interface CloudLoopState extends CostLoopState {
  messages: Array<Record<string, unknown>>;
  writtenPaths: string[];
  /** Next absolute step index to run. */
  step: number;
  /** The run's model hand-off state (`cloudAgent/cloudRunModelPolicy`): the locked
   *  model, released pins, broken/tried models and the stall budget. Persisted so
   *  every DO tick stays on the SAME model and the hand-off rules span the run. */
  modelPolicy?: CloudRunModelState;
  /** LEGACY — the locked model id a tick persisted before {@link modelPolicy} existed.
   *  Read once to resume such a tick on the same model; never written. */
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
  /** A reviewer run cannot become terminal until the exact lane/role verdict tool
   * succeeds. Persisted because durable runs execute one model turn per tick. */
  reviewVerdictRecorded?: boolean;
  requiredSignoff?: { roleKey: string; laneKey?: string };
  /** How many finish attempts the anti-stub gate has already blocked this RUN. MUST be
   *  persisted: the durable surface runs ONE step per alarm tick, so a loop-local
   *  counter resets to 0 every tick and MAX_PLACEHOLDER_FINISH_BLOCKS could never be
   *  reached — the gate would block a stub-shipping finish forever instead of relenting
   *  after N attempts and opening the PR annotated-unverified. */
  placeholderBlocks?: number;
  /** How many finish attempts THIS RUN has blocked because branch CI was still
   *  pending. Persisted across durable ticks (one step per alarm). */
  ciPendingBlocks?: number;
  /** How many finish attempts THIS RUN has blocked because branch CI failed. */
  ciFailureBlocks?: number;
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
  /** The launching canvas session's arc stage (idea/make/run/measure/reach), when
   *  known — an ephemeral per-run nudge on the role objective, never a durable
   *  fact (see `modelRoles.ts`). Absent for a headless/non-canvas launch. */
  arcStage?: ArcStage;
  /** Brain chat that launched this run. Enables exactly one scoped write-back tool. */
  originatingChatId?: number;
  /** Exact accountability slot a reviewer run must sign before it may finish. */
  requiredSignoff?: { roleKey: string; laneKey?: string };
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
  /** Caller-configured SAMPLING params for this run — a published tenant model's
   *  stored `temperature`/`top_p`, or an explicit Run-now override. Distinct from
   *  `execParams` (personality) and OUTRANKS it: an operator who set a temperature on
   *  the model meant that number. The gateway route already applied these; without
   *  them here the same tenant model sampled differently depending on whether it was
   *  called over HTTP or dispatched as an agent run. See `AgentRunInput.genParams`. */
  genParams?: { temperature?: number; topP?: number; maxTokens?: number };
  /**
   * REHEARSAL seam (Open/Closed + Dependency Inversion). The loop builds its surface
   * provider and then hands it here for the caller to wrap. Rehearsal supplies a shadow
   * decorator (application/rehearsal/shadowProvider.ts) that passes every READ straight
   * through and RECORDS every effect instead of performing it — so a dry-run/replay is
   * the real loop, the real registry and the real prompts, with nothing escaping.
   *
   * Absent on a live run, in which case the provider is used exactly as built and
   * behaviour is byte-identical. Deliberately NOT part of {@link CloudLoopState}: a
   * function cannot survive DO cursor persistence, so a rehearsal runs in one call
   * (`maxSteps`) rather than across alarm ticks.
   */
  decorateProvider?: (provider: CapabilityProvider) => CapabilityProvider;
  /**
   * Pin repo READS to this git ref instead of the base/branch the run would compute.
   * Replay uses it to re-run against the tree the original execution actually saw, so a
   * comparison measures the agent change rather than a moved main.
   */
  frozenReadRef?: string;
  /**
   * Skip the terminal {@link finalizeCloudRun} entirely. Set ONLY by rehearsal: the
   * shadow provider already guarantees `writtenPaths` stays empty (so no PR could
   * open), but finalize also releases steers, writes run summaries and touches the
   * ticket — none of which a rehearsal is entitled to do. Cheaper and far clearer than
   * relying on every branch inside finalize to no-op.
   */
  suppressFinalize?: boolean;
  /** Its place in a delegation tree (durable surface only) — see {@link CloudRunDelegation}. */
  delegation?: CloudRunDelegation;
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
  /** The run's capability set — `CLOUD_SURFACE_CAPS` plus whatever the TENANT
   *  unlocked (`durableRunCaps`: C5's `repo.semantic`). Must be the set the tool schemas
   *  were derived from. */
  capabilities: ReadonlySet<Capability>;
  /** Replay: pin repo reads to this ref rather than computing base→branch. */
  frozenReadRef?: string;
  principalId?: string;
  repositoryDelegationId?: string;
  /** The project's detected blueprint (services, databases, env vars). */
  blueprint: Awaited<ReturnType<typeof getLatestBlueprint>>;
}): CapabilityProvider {
  const { env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths, blueprint } = args;
  // Read/list against the ticket branch only once it exists (created on the first
  // commit). Before any write, the branch ref 404s — read from `base` instead, so
  // the agent sees the real codebase rather than mistaking the missing branch for
  // "no repo access".
  // A replay pins reads to the ref the ORIGINAL run saw; a live run computes it (base
  // before the first write, the ticket branch after — the branch does not exist until
  // the first commit, and a 404 there reads to the agent as "no repo access").
  const readRef = (): string =>
    args.frozenReadRef ?? (repoCtx ? (writtenPaths.size > 0 ? repoCtx.branch : repoCtx.base) : '');
  const noRepo = (suffix = ''): string => `no repo bound to this task (${repoMiss})${suffix}`;
  const credentialAllowed = (scope: 'repository:read' | 'repository:write'): Promise<boolean> =>
    args.principalId && args.repositoryDelegationId
      ? authorizeCredentialDelegation(db, { tenantId, principalId: args.principalId, delegationId: args.repositoryDelegationId, requiredScope: scope })
      : Promise.resolve(false);

  // ── REPEAT-READ GUARD ──────────────────────────────────────────────────────
  // A model that re-reads a file it already holds pays for it twice: a git-API round
  // trip here, and a `recordContextContribution` row per repeat. Nothing about
  // re-reading an UNCHANGED file can return different bytes, so an identical repeat is
  // served from the first result. Deliberately NOT the approval fingerprint
  // (`policyGateCallKey`) or the prose-loop detector (`detectRepetitionLoop`): it keys
  // on (ref, path), never on prose or approval identity.
  //
  // Correctness rests on two invalidations, both below: the memo is keyed by the SAME
  // `readRef()` the read uses, so the base→branch switch is a different key; and every
  // write/edit/delete to a path drops its entries, so a read that must see the run's
  // own new content always goes to the repo. A FAILED read is never memoized, so a
  // transient git failure is not cached for the rest of the run.
  //
  // Scope boundary, stated rather than implied: this saves the read's I/O and DB cost,
  // NOT the model's context tokens. `read_file`'s result shaper in
  // `@builderforce/agent-tools` rebuilds its payload from `content` and drops a
  // provider `note`, so an "already read" hint cannot reach the model from here; and
  // returning a content-less repeat would break `write_file`'s overwrite probe, which
  // reads through this same capability (`core-tools.ts`). Truncating a repeat read into
  // a stub belongs at that shaper.
  //
  // Lifetime, likewise: the memo lives as long as this provider, and the provider is
  // rebuilt every tick (`buildCloudProvider` is called per tick, not per run), so this
  // suppresses repeats WITHIN a tick — the repeated-read, repeated-search turn where
  // they actually happen — and a durable DO tick starts with an empty memo. Carrying
  // it ACROSS ticks is deliberately not done here: the only correct version of that
  // must cache file CONTENT in `CloudLoopState` (a set of keys alone would either
  // re-read anyway or wrongly serve stale bytes), which is a durable-state size
  // decision, not a local one. Stated here rather than left for the next reader to
  // assume.
  const readMemo = new Map<string, { path: string; content: string; truncated?: boolean }>();
  const forgetReads = (path: string): void => {
    for (const [key, cached] of readMemo) if (cached.path === path) readMemo.delete(key);
  };

  // MULTI-REPO SPANNING (0956). `repoCtx` is the task's PRIMARY repo — the only one
  // a single-repo task has, and the fallback for every write a spanning task cannot
  // route by pathGlob. The router is resolved LAZILY and exactly once per run: a
  // single-repo task therefore pays one indexed read on its first write, decrypts no
  // extra credential, and gets `forPath() === repoCtx` — the pre-0956 behaviour to
  // the letter. A task bound to 2+ repos routes each write to the repo whose
  // `pathGlobs` claim the path, and records the write so finalize can open a PR only
  // where code actually landed.
  let routerPromise: Promise<TaskRepoRouter> | null = null;
  const repoFor = async (path: string): Promise<TicketRepoContext | null> => {
    if (!repoCtx) return null;
    routerPromise ??= resolveTaskRepoRouter(db, integrationCredentialSecret(env), tenantId, taskRow.id, { ctx: repoCtx, reason: repoMiss });
    const router = await routerPromise.catch((error) => {
      reportCaughtError(error, { source: 'application/runtime/cloudAgentEngine.ts', operation: 'repoFor', context: { logMessage: '[cloud-write] repo-set resolution failed — routing to the primary repo', details: { tenantId, taskId: taskRow.id, error } } });
      return null;
    });
    return router?.forPath(path) ?? repoCtx;
  };

  // WHO this run is, for coordination purposes. A ticket is one blackboard, so every
  // agent staffed onto the same ticket — in the same stage or a later one — shares a
  // scope and contends for the same leases.
  const leaseHolder: LeaseHolder = {
    tenantId,
    executionId,
    label: agentLabel,
    taskId: taskRow.id,
    repoSlug: repoCtx ? `${repoCtx.owner}/${repoCtx.repo}` : '',
    // The ticket BRANCH, not the base: contention exists only between agents committing
    // to the same ref, and every ticket has its own. Keying on the repo alone would
    // serialize unrelated tickets that happen to touch one file.
    branch: repoCtx?.branch ?? '',
    scopeKey: coordinationScopeKey(taskRow.id),
  };

  return {
    capabilities: args.capabilities, semantic: durableRepoSemantic(args.capabilities, { env, tenantId, projectId, repoCtx }),
    repoRead: {
      async listFiles(sub, glob) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:read'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        const ref = readRef();
        // Glob is applied inside listRepoFiles, BEFORE the 400-path tree cap.
        // Filtering the already-sliced listing dropped matches past the cap and
        // the zero-match note then reported real files as missing.
        const ls = await listRepoFiles({ ...repoCtx, ref }, sub, glob);
        if (!ls.ok) return { ok: false, error: ls.reason };
        return { ok: true, ref, paths: ls.paths, truncated: ls.truncated };
      },
      async readFile(path) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:read'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        const ref = readRef();
        // An identical repeat of a read this run already served. Keyed by ref so the
        // base→branch switch reads for real, and consulted only BEFORE the round trip.
        const memoKey = `${ref}\u0000${path}`;
        const memo = readMemo.get(memoKey);
        if (memo) return { ok: true, path: memo.path, content: memo.content, truncated: memo.truncated };
        const rf = await readRepoFile({ ...repoCtx, ref }, path);
        if (rf.ok) {
          readMemo.set(memoKey, { path: rf.path, content: rf.content, ...(rf.truncated === true ? { truncated: true } : {}) });
          await recordContextContribution(db, { tenantId, executionId, sourceKind: 'repository_file', sourceRef: `${repoCtx.owner}/${repoCtx.repo}:${path}`, trustTier: 'repository', content: rf.content });
        }
        return rf.ok ? { ok: true, path: rf.path, content: rf.content, truncated: rf.truncated } : { ok: false, error: rf.reason };
      },
      async searchCode(query, scope) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:read'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        // The `path` scope is applied INSIDE searchRepoCode (server-side via GitHub's
        // `path:` qualifier), not post-filtered here — a post-filter over the capped
        // top-N global hits dropped a subdir's real matches and carried a stale
        // `truncated` flag, yielding `total:0, truncated:true` that looped the agent.
        const sr = await searchRepoCode({ ...repoCtx, ref: readRef() }, query, { maxResults: 30, path: scope });
        if (!sr.ok) return { ok: false, error: sr.reason };
        return { ok: true, query, total: sr.total, truncated: sr.truncated, matches: sr.matches };
      },
    },
    // Every write goes through the coordination guard, which takes an implicit
    // exclusive lease on the path first. Correctness must not depend on the model
    // choosing to call `claim_resource`, so the surface claims on its behalf: a peer
    // agent in the same stage now gets a refusal naming the holder instead of silently
    // reverting the other agent's change on the shared ticket branch.
    repoWrite: guardRepoWrite({
      async writeFile(path, content, _summary) {
        if (!repoCtx) return { ok: false, error: noRepo('; include the file contents in your final summary instead') };
        if (!(await credentialAllowed('repository:write'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        const inspection = await inspectOutboundContent(db, { tenantId, executionId, seam: 'repository_write', target: path, content });
        if (!inspection.ok) return { ok: false, error: `Outbound content blocked: ${inspection.reasons.join(', ')}. Remove credential material; never commit secrets.` };
        const firstWriteThisRun = !writtenPaths.has(path);
        const target = (await repoFor(path)) ?? repoCtx;
        const commit = await commitAgentFile(target, path, content, agentCommitMessage(firstWriteThisRun ? 'Add' : 'Update', path, taskRow.id, agentLabel));
        if (!commit.ok) return { ok: false, error: commit.reason };
        writtenPaths.add(path);
        // The run just changed this path: any memoized read of it is now stale, and
        // leaving it would hand the model bytes from before its own edit.
        forgetReads(path);
        await recordRepoWrite(db, tenantId, taskRow.id, target);
        // created vs modified comes from whether the path pre-existed in the repo
        // (commit.existed), not first-write-this-run.
        const change = commit.existed ? 'modified' : 'created';
        await recordTaskFileChange(db, tenantId, taskRow.id, executionId, path, change, agentLabel);
        notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change, ts: new Date().toISOString() });
        return { ok: true, branch: target.branch, commitUrl: commit.commitUrl, change };
      },
      async editFile(path, oldString, newString, replaceAll) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:write'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        // Read from the repo the write will land in, so a spanning task edits the
        // file it is about to commit rather than a same-named file in the primary.
        // For the primary that ref is the run-state-aware `readRef()`; for another
        // repo in the set the ticket branch may not exist yet, so fall back to base
        // (same base-before-first-commit rule `readRef` encodes for the primary).
        const target = (await repoFor(path)) ?? repoCtx;
        let rf = await readRepoFile({ ...target, ref: target === repoCtx ? readRef() : target.branch }, path);
        if (!rf.ok && target !== repoCtx) rf = await readRepoFile({ ...target, ref: target.base }, path);
        if (!rf.ok) return { ok: false, error: `cannot edit '${path}': ${rf.reason}` };
        if (rf.truncated) return { ok: false, error: `'${path}' is too large to edit safely here — rewrite it with write_file instead` };
        // EOL-tolerant, EOL-preserving match (shared with the VS Code provider) so an
        // agent that emits LF against a CRLF-committed file still edits it instead of
        // failing with "old_string not found" and giving up.
        const edit = applyStringEdit(rf.content, oldString, newString, replaceAll);
        if (!edit.ok || edit.content == null) return { ok: false, ...editFacts(edit), error: `cannot edit '${path}': ${edit.error ?? 'old_string not found'}` };
        const updated = edit.content;
        const inspection = await inspectOutboundContent(db, { tenantId, executionId, seam: 'repository_write', target: path, content: updated });
        if (!inspection.ok) return { ok: false, error: `Outbound content blocked: ${inspection.reasons.join(', ')}. Remove credential material; never commit secrets.` };
        const firstWriteThisRun = !writtenPaths.has(path);
        const commit = await commitAgentFile(target, path, updated, agentCommitMessage(firstWriteThisRun ? 'Edit' : 'Update', path, taskRow.id, agentLabel));
        if (!commit.ok) return { ok: false, error: commit.reason };
        writtenPaths.add(path);
        // Same invalidation as `writeFile` — this run just changed the path. The
        // read above went straight to `readRepoFile` precisely because an edit must
        // always see the CURRENT bytes, memo or no memo.
        forgetReads(path);
        await recordRepoWrite(db, tenantId, taskRow.id, target);
        await recordTaskFileChange(db, tenantId, taskRow.id, executionId, path, 'modified', agentLabel);
        notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: 'modified', ts: new Date().toISOString() });
        return { ok: true, branch: target.branch, commitUrl: commit.commitUrl, change: 'modified', ...editFacts(edit) };
      },
      async deleteFile(path, reason) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:write'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        const suffix = reason && reason.trim() ? ` — ${reason.trim()}` : '';
        const target = (await repoFor(path)) ?? repoCtx;
        const del = await deleteAgentFile(target, path, agentCommitMessage('Remove', path, taskRow.id, agentLabel, suffix));
        if (del.ok) {
          writtenPaths.delete(path);
          // The path is gone from the branch: a memoized read of it would hand back
          // content that no longer exists.
          forgetReads(path);
          await recordRepoWrite(db, tenantId, taskRow.id, target);
          await recordTaskFileChange(db, tenantId, taskRow.id, executionId, path, 'deleted', agentLabel);
          notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: 'deleted', ts: new Date().toISOString() });
          return { ok: true, branch: target.branch, commitUrl: del.commitUrl };
        }
        if (del.code === 'not_found') {
          // Not on the branch — benign no-op so the model doesn't treat it as a failure.
          return { ok: true, deleted: false, note: `'${path}' is not on the branch, so there is nothing to delete.` };
        }
        return { ok: false, error: del.reason };
      },
    }, {
      env,
      db,
      holder: leaseHolder,
      onRefused: (path, heldBy) => {
        // A refusal is a real coordination event, not a tool error — surface it on the
        // run timeline so an operator can see two agents contending for one file.
        void recordCloudToolEvent(db, {
          tenantId, cloudAgentRef, executionId,
          toolName: 'coordination.refused', category: 'tool',
          detail: { path, heldBy },
          result: `write to '${path}' refused — held by ${heldBy}`,
        }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "buildCloudProvider", context: { logMessage: '[cloud-run] coordination refusal telemetry failed', details: { tenantId, executionId, path, error } } }));
      },
    }),
    staticCheck: {
      async verify() {
        if (!repoCtx) return { ok: true, ran: false, note: `No repository is bound (${repoMiss}) — nothing to validate here; return the deliverable in your finish summary.` };
        if (writtenPaths.size === 0) return { ok: true, ran: false, note: 'No files written yet — write your changes first, then call run_checks to statically validate config files.' };
        const v = await verifyWrittenFiles({ ...repoCtx, ref: readRef() }, writtenPaths);
        if (!v.ok) {
          return {
            ok: false, ran: true, kind: 'static-validation',
            errors: v.errors,
            note: `Static validation FAILED on ${v.errors.length} file(s) — fix the parse error(s) below with write_file, then call run_checks again.`,
          };
        }
        // Ticket #3092: this executor has no shell, so branch CI is the in-run
        // build/type-check/test. Poll HEAD; a red result fails the tool so the
        // agent fixes before finishing. `none` (no checks yet / PR-only workflow)
        // is not a failure — finish will still refuse a fabricated "tests passed".
        const ci = await pollBranchCi(repoCtx);
        const short = ci.sha ? ci.sha.slice(0, 7) : 'HEAD';
        const staticNote = `Static source/config validation PASSED for ${v.checked.length} changed file(s)`
          + `${v.skipped.length ? ` (${v.skipped.length} file(s) had no applicable shell-free policy)` : ''}.`;
        if (ci.status === 'failure') {
          return {
            ok: false, ran: true, kind: 'branch-ci',
            checked: v.checked, skipped: v.skipped,
            errors: (ci.failed.length ? ci.failed : ['ci']).map((name) => ({ path: `(ci) ${name}`, message: ci.summary })),
            note: `${staticNote} CI FAILED on ${short} (${ci.count} check(s)): ${ci.summary}. Fix, then call run_checks again. Do not claim tests passed.`,
          };
        }
        const ciNote = ci.status === 'success'
          ? ` CI on ${short} is GREEN (${ci.count} check(s)). You may claim those checks passed.`
          : ci.status === 'pending'
            ? ` CI is PENDING on ${short} (${ci.count} check(s)). Do not finish yet; call run_checks again. Do not claim tests passed.`
            : ' No CI checks on this commit yet (none configured, or they only run after the PR opens). Do not claim a local build/type-check/test passed.';
        return {
          ok: true, ran: true, kind: 'static-validation',
          checked: v.checked, skipped: v.skipped,
          note: staticNote + ciNote,
        };
      },
    },
    // Human-in-the-loop. The durable surface keeps its conversation in the DO
    // cursor, so it hands NO loop state to the pause record — but it goes through
    // the SAME primitive the container/Actions surfaces do, so the approval, the
    // needs-attention routing and the resume record are identical everywhere.
    human: {
      async ask(question, context) {
        const { approvalId } = await pauseExecutionForQuestion(env, db, {
          tenantId, executionId, taskId: taskRow.id, projectId,
          ...(cloudAgentRef ? { cloudAgentRef } : {}),
          agentLabel, question, ...(context ? { context } : {}),
          surface: 'durable',
        });
        return { paused: true, approvalId, note: 'Question sent to a human. The run is paused until it is answered; you will resume with the answer.' };
      },
    },
    // The ticket's PRD, WRITABLE. Prep hands the run its PRD as context; this is what
    // lets the run write back to it — a decision it made, or a section it found wrong —
    // through the same `specs` writer + branch-commit path the first draft used. WHICH
    // ticket's PRD is fixed by the run, never by the model.
    prd: buildPrdCapability(env, db, { executionId, tenantId, projectId, taskId: taskRow.id, taskTitle: taskRow.title, agentLabel }),
    // Durable cross-run memory, GOVERNED (0371): the run's scope chain decides both
    // what it may recall (ticket → project → tenant, never a sibling project) and where
    // a write lands, and every fact carries its origin run + optional TTL. The backing
    // table is a routing detail of the scope, not a decision made here. B4: a recall the
    // project's answered-question memory already holds is replayed (`answerReplay.ts`).
    memory: withAnswerReplay(buildMemoryCapability({ db, env, tenantId, projectId, ticketId: taskRow.id, origin: 'cloud-run', executionId }), { env, db, tenantId, projectId, agentRef: cloudAgentRef ?? null }),
    // Multi-agent coordination for this ticket: leases + the shared blackboard.
    coordination: buildCoordinationCapability({ env, db, holder: leaseHolder }),
    // Skill authoring: a run that worked out a repeatable procedure can PROPOSE it
    // for review. Drafts only — approval is a human write, so a run can never change
    // what other agents are instructed to do. The workspace/project/run are stamped
    // here, exactly as `memory` resolves its own scope.
    skillAuthor: buildSkillAuthoringCapability({ env, db, tenantId, projectId, executionId, taskId: taskRow.id, agentLabel }),
    // Read a public URL (docs / an API spec / a linked issue) so the agent isn't
    // limited to what the repo already contains — and discover that URL in the first
    // place. `search` checks the tenant's OWNED crawled index first and only falls back
    // to a vendor (tenant BYO key → the operator's own key → SearXNG → keyless
    // encyclopedic floor) to discover pages worth crawling, via the SAME
    // `searchOwnedThenDiscover` primitive the Brain's `web.search` MCP tool and the
    // workflow `web-search` node use — so an autonomous run's research builds the
    // tenant's index instead of being thrown away when the tool call returns. SSRF
    // egress policy + byte cap + timeout + the read-through cache + per-query metering
    // all live in cloudWeb.
    web: {
      async fetch(url: string) {
        const result = await fetchCached(env, url);
        if (result.ok) await recordContextContribution(db, { tenantId, executionId, sourceKind: 'web_fetch', sourceRef: result.url ?? url, trustTier: 'external', content: result.content ?? '' });
        return result;
      },
      async search(query: string) {
        const result = await searchOwnedThenDiscover({ db, env, tenantId, request: { query } });
        if (result.ok) await recordContextContribution(db, { tenantId, executionId, sourceKind: 'web_search', sourceRef: query, trustTier: 'external', content: JSON.stringify(result) });
        return result;
      },
    },
  };
}

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
  projectId: number,
  opts?: CloudLoopOpts,
): Promise<CloudLoopResult> {
  if (env.AGENT_EXECUTION_ENABLED?.trim().toLowerCase() === 'false') {
    return { ok: false, output: 'Agent execution is halted by the platform operator.', cancelled: true, finished: true };
  }
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
    const repoResolved = await resolveTicketRepoContext(db, integrationCredentialSecret(env), tenantId, taskRow.id);
    repoCtx = repoResolved.ok ? repoResolved.ctx : null;
    repoMiss = repoResolved.ok ? '' : repoResolved.reason;
  }
  const writtenPaths = new Set<string>(opts?.resume?.writtenPaths ?? []);
  if (repoCtx && !opts?.resume) await stampExecutionSourceRef(db, tenantId, executionId, repoCtx);

  // Tenant "LLM" (migration 0211): if `model` is a `tenant_model:<slug>` ref, expand
  // it to its configured base model + system directives so THIS run honours the
  // tenant's model config on every surface (Worker/DO/Container all funnel here).
  // `baseModel: null` means "run on the plan default" → effectiveModel = undefined.
  // Unknown/non-tenant refs resolve to null and pass through unchanged.
  const tenantModel = await resolveTenantModel(env, db, tenantId, model);
  let effectiveModel = tenantModel ? (tenantModel.baseModel ?? undefined) : model;
  // ...and its SAMPLING params. The gateway route has always applied these; the cloud
  // loop never did, so a published tenant model with `temperature: 0.2` sampled at 0.2
  // over HTTP and at the persona default when the SAME model was dispatched as an
  // agent run. Explicit caller `genParams` (a Run-now override) still win — this only
  // fills what the caller did not set, exactly as the route does.
  const tenantModelParams: { temperature?: number; topP?: number } = {
    ...(typeof tenantModel?.params.temperature === 'number' ? { temperature: tenantModel.params.temperature } : {}),
    ...(typeof tenantModel?.params.top_p === 'number' ? { topP: tenantModel.params.top_p as number } : {}),
  };
  const genParams: { temperature?: number; topP?: number; maxTokens?: number } =
    { ...tenantModelParams, ...(opts?.genParams ?? {}) };
  // Curated platform tools give this run the SAME work-management reach the Brain
  // has (create follow-up tasks, update OKRs, read what's remaining) — advertised
  // alongside the repo/file tools and dispatched in-process below. The prompt
  // guidance that makes the agent USE them lives in prepareCloudRun so every
  // surface (Worker/DO durable + the container) gets it once (DRY).
  // `web.search` resolves a backing (tenant BYO key, operator key, or the keyless
  // encyclopedic floor) PER CALL inside `searchOwnedThenDiscover` — cheap and cached on
  // its own, so there is no run-level pre-resolution here — and it ALWAYS resolves,
  // which is why it is part of CLOUD_SURFACE_CAPS rather than a per-run addition: the
  // advertised schemas and the wired backing come from the same constant and cannot
  // drift.
  const surfaceCaps = durableRunCaps(env, tenantId, opts?.delegation, repoCtx);
  /** Where this run's tokens bill — a child's are its parent's. */
  const meterExecutionId = meterExecutionIdOf(executionId, opts?.delegation);
  const runIdentity = await ensureAgentRunIdentity(db, {
    tenantId, executionId, agentRef: cloudAgentRef, issuedBy: `execution:${executionId}`,
    capabilities: [...surfaceCaps],
  });
  const releasedModel = runIdentity.definition?.baseModel;
  if (typeof releasedModel === 'string' && releasedModel.trim() && releasedModel !== AGENT_DEFAULT_MODEL_SENTINEL) effectiveModel = releasedModel.trim();
  const repositoryDelegationId = repoCtx
    ? await delegateCredential(db, {
      tenantId, principalId: runIdentity.principalId, credentialKind: 'repository', credentialRef: repoCtx.repoId,
      scopes: ['repository:read', 'repository:write'],
    })
    : undefined;
  const [declaredLimits] = await db.select({
    maxFiles: executionLimits.maxFiles,
    maxRepositories: executionLimits.maxRepositories,
    maxSpendMillicents: executionLimits.maxSpendMillicents,
  }).from(executionLimits).where(and(eq(executionLimits.tenantId, tenantId), eq(executionLimits.executionId, executionId))).limit(1);
  const cloudTools = [...cloudAgentToolsFor(surfaceCaps), ...cloudAgentPlatformToolSchemas(opts?.originatingChatId)];
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
  //
  // This loop is tool-driven on EVERY turn (`cloudTools` below), which used to
  // disqualify Evermind outright — a tool-less backend handed `tools` answers in
  // prose rather than failing, so the agent narrated calls it could never emit. It
  // tool-calls now (constrained decoding, ../llm/evermindToolCall), so the pin is
  // honoured; `modelSupportsTools` remains the shared declaration for any FUTURE
  // tool-less vendor and still guards an explicitly configured `base_model`.
  const requestedInferenceModel = typeof effectiveModel === 'string' && effectiveModel.startsWith('evermind/')
    ? effectiveModel
    : undefined;
  // …and every turn of this loop is a CODING turn, so the pin must also clear the
  // Evermind coding-quality gate (a recorded coding eval ≥ 90% of the frontier baseline
  // for this exact head version — operator decision 2026-09-12). Closed → the pin is
  // dropped and the run takes the normal coding selection; never an error.
  const evermindCoding = requestedInferenceModel
    ? await resolveEvermindCodingRoute(env, db, tenantId, requestedInferenceModel)
    : undefined;
  const projectInferenceModel = requestedInferenceModel && evermindCoding?.qualified && modelSupportsTools(requestedInferenceModel)
    ? requestedInferenceModel
    : undefined;
  if (requestedInferenceModel && !projectInferenceModel) {
    console.warn(
      evermindCoding?.qualified
        ? `[evermind] refusing to pin ${requestedInferenceModel} for a tool-driven agent run (no tool-calling); selecting from the coding pool instead`
        : `[evermind] not pinning ${requestedInferenceModel} for a coding run — coding-eval gate closed `
          + `(${evermindCoding?.gate?.reason ?? 'not a project head'}); selecting from the coding pool instead`,
    );
  }

  // The task brief is committed during prep, but deliberately is NOT counted as a
  // run deliverable. A brief without implementation must never open a PR by itself.

  // Resume from persisted state (DO surface) or start fresh (Worker surface).
  const messages: Array<Record<string, unknown>> = opts?.resume?.messages ?? [
    { role: 'system', content: effectiveSystemPrompt },
    { role: 'user', content: userContent },
  ];
  const startStep = opts?.resume?.step ?? 0;
  // Steps THIS invocation may take before yielding (the DO passes 1 per alarm tick).
  // Undefined = the whole run in one call. There is no absolute step cap on a run: it
  // ends when it finishes, is cancelled, or trips the kernel's consecutive-tool-failure
  // breaker — a run is not wrong for being long, only for being stuck.
  const maxThisCall = opts?.maxSteps;

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
  // Fail-closed BYO (GAP-B4). A workspace that CONNECTED providers has declared
  // "run on my account". If none of them resolved this call, stop the run with the
  // named reason instead of composing a chain that would spend from the operator
  // pool — a silent platform-key fallback is a billing leak, not a graceful degrade.
  const byoBlocked = await refuseCloudRunWithoutByo(db, { tenantId, cloudAgentRef, executionId }, loopCreds);
  if (byoBlocked) return { ok: false, output: byoBlocked.message, cancelled: false, finished: true };
  const { anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, vendorKeys: tenantVendorKeys } = loopCreds;
  // `codingOnly` keeps the failover cascade inside the curated coding pool, so an
  // exhausted free run escalates to the paid coding backstop instead of degrading
  // onto a non-coder (gemini-flash-lite) or a tool-unreliable vendor (Ollama).
  const proxy = llmProxyForPlan(env, routing.effectivePlan, routing.premiumOverride, { backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true, ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}), ...(openaiCodexAuth ? { openaiCodexAuth } : {}), ...(xaiOAuthToken ? { xaiOAuthToken } : {}), ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}), ...byoRoutingOptions(loopCreds), ...strictWhenConnected(loopCreds.configuredProviders.length > 0) });

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
  // Spawn / call-purpose role on a child run, board delivery role on a signoff
  // run, else the parent loop's existing `'code'`. Feeds ROLE_MODELS before the
  // learned ranker / plan coding seed; an explicit user/agent/Evermind pin still wins.
  const roleForPin = cloudRunRoleForModelPin({
    spawnRole: opts?.delegation?.spec?.role,
    deliveryRole: opts?.requiredSignoff?.roleKey,
  });
  const requested = requestedModelForRole(env, roleForPin, effectiveModel);
  // The resolved pin rides CloudLoopState so the DO surface keeps every tick on it.
  // A live project-Evermind pin hard-pins the project model (strict) and skips the
  // coding-pool selection entirely; otherwise the normal learned-routing seed runs.
  //
  // STRICT is load-bearing and stays: it bypasses chain composition entirely, which
  // is the only reason a project-Evermind pin survives for a BYO tenant (the composer
  // filters every non-connected vendor out of the chain, and `evermind` is nobody's
  // connected vendor). Now that the head can DECLINE a turn it isn't competent for,
  // the graceful fallback rides the run policy's per-turn cascade instead.
  // Child durable runs carry CloudChildSpec.role; the parent loop is 'code' (the
  // phase rule in cloudRunModelPolicy).
  const runRole = cloudRunRole(opts?.delegation?.spec?.role);
  const pick = projectInferenceModel
    ? { model: projectInferenceModel, strict: true as const }
    : pickCloudModel(requested, routing.effectivePlan, routing.premiumOverride, {
        // Carries the gate's verdict so a closed-gate Evermind pin is dropped here too.
        ...(evermindCoding ? { evermindCoding } : {}),
        actionType: learned.actionType,
        actionStats: learned.actionStats,
        bias: opts?.routingBias,
        role: runRole,
        arcStage: opts?.arcStage,
        // A cost-first role (explore / utility / verify) orders by expected cost.
        prices: await pricesForCall(env, runRole, opts?.arcStage), explore: cloudRoutingExploration(env, tenantId),
        // Context-aware seed: don't pick a small-window model for a big first turn.
        estimatedTokens: estimateRequestTokens(messages, cloudTools),
        // A free tenant may pin a model their connected provider (BYO) serves.
        byoVendors: byoVendorIdsFromCredentials(loopCreds),
        // Tenant BYO precedence — lead with the owner's chosen account (e.g. Meta first).
        byoVendorPriority: loopCreds.vendorPriority,
        byoAlertedVendors: loopCreds.alertedVendors ?? [],
        isSuperadmin: routing.isSuperadmin,
        registeredModels: loopCreds.registeredModels,
        preferredRegisteredModel: loopCreds.preferredOpenRouterModel,
        byoSelectedModels: loopCreds.byoSelectedModels,
        // A PREMIUM pin is honoured only with a paid plan + a validated card; otherwise
        // it's ignored and the run uses the plan's coding default.
        premiumEntitled: routing.premiumEntitled,
      });
  // THE model hand-off policy for this run: locks onto what serves turn 1, releases a
  // pin on 429/413/503 or an Evermind decline, fails over a model that only narrates.
  // Carried across DO ticks in CloudLoopState.
  // Verify is a different model than the author. Seed it from ROLE_MODELS with no
  // explicit pin — the coder's `requested` must not become the review model.
  const verifyPin = requestedModelForRole(env, 'verify');
  let modelState: CloudRunModelState = resumeCloudRunModelState(
    opts?.resume?.modelPolicy, opts?.resume?.pinnedModel, pick, opts?.delegation?.spec?.role,
    verifyPin ? { verify: verifyPin } : undefined,
  );
  const cloudToolNames = cloudTools.map((t) => t.function.name);
  /** What answered the latest turn — the only id naming a spent model under auto-select. */
  let lastResolvedModel: string | undefined;

  // Make the model choice legible on the timeline — once, at run start (resume ticks
  // already locked their pin). The companion to llm.complete + coding_model_degraded:
  // those report what RAN; this reports why it was chosen. Best-effort.
  if (!opts?.resume) {
    await emitModelSelection(db, {
      tenantId, cloudAgentRef, executionId,
      requested, pick, plan: routing.effectivePlan, premium: routing.premiumOverride,
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
  // The finish gates' counters (`cloudAgent/finishGates.ts`): honesty, anti-stub, in-run
  // CI, the completeness self-review and the reviewer verdict. Carried across DO ticks
  // via resume state — a per-call counter would reset before any cap was reached.
  const gates = initialFinishGateState(opts?.resume, isChildDelegation(opts?.delegation));
  const requiredSignoff = opts?.resume?.requiredSignoff ?? opts?.requiredSignoff;

  // Governance gates (compile-primitive policy modality). Resolved ONCE: a resumed
  // run reuses the gates persisted on its first tick (the payload may not survive
  // to later ticks); a fresh run seeds them from the dispatch payload.
  // `policyAskedGates` holds one entry per already-approved CALL — keyed by
  // {@link policyGateCallKey} (gate + tool + argument hash), NOT by gate id — so an
  // approval covers exactly the call a human saw. A retried identical call proceeds;
  // a different call through the same gate is asked again.
  const policyGates: PolicyGate[] = opts?.resume?.policyGates ?? opts?.policyGates ?? [];
  const policyAskedGates = new Set<string>(opts?.resume?.policyAskedGates ?? []);
  // The cost levers (costLoop/): advertised tools, volatile tail, output cap, run budget.
  const cost = await openCostLoopSession({
    env, db, tenantId, executionId, taskId: taskRow.id, meterExecutionId, plan: routing.effectivePlan, role: runRole, catalog: cloudTools,
    ...(opts?.resume ? { resume: opts.resume } : {}), promptTexts: [effectiveSystemPrompt, userContent],
    required: requiredSignoff ? ['builtin_kanban_signoff'] : [],
    record: (toolName, category, detail, result) => recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName, category, detail, result }),
  });
  // D1 + D2: the role's tier ladder, and a soft seed's weak-first start (first tick only).
  const ladder = cloudTierLadder(byoVendorIdsFromCredentials(loopCreds), routing.effectivePlan, routing.premiumOverride, loopCreds.configuredProviders.length > 0);
  const stepFeatures = (turnIndex: number) => ({ actionType: learned.actionType, role: runRole, promptTokens: estimateRequestTokens(messages, cloudTools), toolCount: cloudTools.length, turnIndex });
  if (!opts?.resume) modelState = await cost.guards.seedModel(modelState, { strict: pick.strict === true, ladder, features: stepFeatures(0) });

  // Hard cancel: a background watcher polls the (cross-isolate) execution status
  // and aborts the in-flight gateway fetch the instant it sees CANCELLED, so a
  // cancel mid-completion stops token spend immediately instead of running the
  // current step to completion. The per-step check below still covers the gap
  // between steps; together they make cancel a true interrupt.
  const cancelChannel = startCancelWatcher(isCancelled);
  const abortController = cancelChannel.controller;

  // W6: Retrieve the project's blueprint for this run
  // This provides the agent with information about the project's services, databases, etc.
  const blueprint = await getLatestBlueprint(env, projectId).catch((error) => {
    reportCaughtError(error, { source: 'application/runtime/cloudAgentEngine.ts', operation: 'getLatestBlueprint', context: { logMessage: '[cloud-run] failed to load blueprint', projectId } });
    return null;
  });

  // The surface's capability backing + the tool context handed to every dispatch.
  // The provider closes over the LIVE `writtenPaths` set + `repoCtx`, so write/delete
  // bookkeeping and the base→branch read switch stay correct as the run progresses.
  const builtProvider = buildCloudProvider({
    env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths,
    capabilities: surfaceCaps,
    principalId: runIdentity.principalId,
    ...(repositoryDelegationId ? { repositoryDelegationId } : {}),
    ...(opts?.frozenReadRef ? { frozenReadRef: opts.frozenReadRef } : {}),
    blueprint,
  });
  // Rehearsal wraps the provider here (see CloudLoopOpts.decorateProvider). A live run
  // passes nothing and uses the provider as built.
  const decoratedProvider = opts?.decorateProvider ? opts.decorateProvider(builtProvider) : builtProvider;
  // Delegation. A child is its OWN durable run (`cloudLiveOrchestration.ts`) — the same
  // backing every cloud surface spawns through — so a run with no place in a tree (a
  // rehearsal) gets no spawner: a dry run must not start real runs.
  const provider: CapabilityProvider = {
    ...decoratedProvider,
    ...(opts?.delegation ? {
      orchestration: buildLiveOrchestration({
        env, db, runtime: opts.delegation.runtime, parent: opts.delegation.parent,
        // Delegating AS one of the workspace's agents — the ONE persona compiler.
        personaBrief: (agent) => resolveAgentPersonaBrief(env, tenantId, agent),
        heartbeat: () => heartbeatExecution(db, executionId),
      }),
    } : {}),
  };
  const toolCtx: ToolContext = { caps: provider, signal: abortController.signal };

  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton (step budget, cancel poll, argument parsing, the
  // assistant/tool rows, the finish / ask_human control signals) lives ONCE in
  // `@builderforce/agent-loop` — the same kernel the Brain, the canvas and the on-prem
  // runtime drive. Everything cloud-specific below is a hook or a port; nothing iterates.
  type Row = Record<string, unknown>;
  const codec = openAiChatCodec<Row>(toolRowCodecOptions(env, tenantId)); // C7: the shared tool-row budget
  const evt = { tenantId, cloudAgentRef, executionId };
  const dataOk = (data: unknown): boolean => !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false);
  // Per-call timers, by call id: a turn's reads may dispatch concurrently (D8).
  const tStart = new Map<string, number>();

  const hooks: LoopHooks<Row> = {
    // Between-step guard: stop before issuing the next (paid) call if cancelled.
    isCancelled: () => cancelChannel.check(),
    // The kernel already cut a looped turn back to its first copy; this only leaves the
    // evidence, so a run that "kept saying the same thing" names the model that did it.
    onRepetitionLoop: async (ctx, loop) => {
      await recordCloudToolEvent(db, {
        ...evt,
        toolName: 'llm.repetition_loop', category: 'llm',
        detail: { step: ctx.step, model: lastResolvedModel ?? modelState.policy.model ?? null, copies: loop.copies },
        result: `the model repeated one block ${loop.copies} times — kept the first copy: "${loop.block.trim().slice(0, 120)}"`,
      });
    },

    beforeTurn: async (ctx) => {
      // Declared limits (+ the A2 token cap) against the run's spend so far.
      const contained = await cost.beforeTurn(ctx.step, declaredLimits, writtenPaths.size, repoCtx ? 1 : 0);
      if (contained) return { action: 'stop', ok: false, output: contained };

      // Mid-run steering: drain any user follow-ups posted to this execution since the
      // previous step and splice them in as user turns BEFORE the next paid call, so a
      // cloud agent (V1 / V2-durable / V2-container fallback) actually changes course
      // mid-run instead of the message being a no-op. Each steer is drained once
      // (consumed_at is stamped by pullPendingSteering).
      await applyPendingSteering(db, { tenantId, cloudAgentRef, executionId, messages, step: ctx.step });

      // Compress the conversation BEFORE the paid call so a long run never re-sends a
      // ballooning history (the 97K-token turn that 413'd). Compacts only when over
      // budget; summarizes the bulky middle into a builder-memory note (free pool),
      // falling back to elision. Mutated IN PLACE so the compacted form persists into
      // CloudLoopState — the DO surface won't re-summarize the same prefix next tick.
      // Sized to the model the policy asks for next when it names one (its catalog window).
      const compaction = await compactMessages(
        messages,
        { ...CLOUD_COMPACT_DEFAULTS, ...cost.compactOptions(), ...(modelState.policy.model ? { targetModel: modelState.policy.model } : {}) },
        buildGatewaySummarizer(env),
      );
      if (compaction.compacted) {
        messages.length = 0;
        messages.push(...compaction.messages);
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'context.compacted', category: 'llm',
          detail: { step: ctx.step, beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens, summarized: compaction.summarized, droppedMessages: compaction.droppedMessages, maskedObservations: compaction.maskedObservations ?? 0 },
          result: `compressed ~${compaction.beforeTokens} → ~${compaction.afterTokens} tokens (${compaction.summarized ? 'builder-memory summary' : compaction.droppedMessages === 0 && compaction.maskedObservations ? 'stale tool outputs masked' : 'elided'})`,
        });
      }
      return undefined;
    },

    onNoToolCalls: async (ctx, turn) => {
      // An owner never ends with children still working (their reports would strand).
      const childBlock = opts?.delegation ? await liveChildrenFinishBlock(db, tenantId, executionId) : null;
      if (childBlock) {
        messages.push({ role: 'assistant', content: turn.content });
        messages.push({ role: 'user', content: childBlock });
        return { action: 'continue' };
      }
      if (requiredSignoff && !gates.reviewVerdictRecorded) {
        const error = missingReviewVerdictMessage(requiredSignoff);
        messages.push({ role: 'assistant', content: turn.content });
        messages.push({ role: 'user', content: error });
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'finish.blocked', category: 'tool',
          detail: { reason: 'review_verdict_missing', ...requiredSignoff },
          result: error,
        });
        return { action: 'continue' };
      }
      // A turn that only DESCRIBED the work (or said nothing) is not a finish: re-prompt
      // it, then fail over to a model that acts, then stop and say why — the stall step
      // every agent loop shares (`@builderforce/run-policy`).
      const stall = cloudStallStep(modelState, {
        text: turn.content, toolCallCount: 0, toolNames: cloudToolNames, requestText: userContent, resolvedModel: lastResolvedModel,
      }, codingFallbackSurface(byoVendorIdsFromCredentials(loopCreds), routing.effectivePlan, routing.premiumOverride));
      modelState = stall.state;
      await recordStallStep(db, evt, stall.step, lastResolvedModel, ctx.step);
      if (stall.step.kind === 'nudge' || stall.step.kind === 'failover') {
        if (turn.content) messages.push({ role: 'assistant', content: turn.content });
        messages.push({ role: 'user', content: stall.step.nudge });
        return { action: 'continue' };
      }
      if (stall.step.kind === 'exhausted') {
        return { action: 'finish', output: turn.content ? `${turn.content}\n\n${stall.step.notice}` : stall.step.notice };
      }
      return { action: 'finish' };
    },

    beforeDispatch: async (call) => {
      tStart.set(call.id, Date.now());
      const name = call.name;
      const parsed = call.args;
      if (call.malformed) {
        reportCaughtError(new Error('malformed tool arguments'), { source: "application/runtime/cloudAgentEngine.ts", operation: "runCloudToolLoop", level: 'warning', context: { logMessage: '[cloud-run] malformed tool arguments; invoking with empty object', details: {
          tenantId,
          executionId,
          toolCallId: call.id,
          toolName: name,
          arguments: call.raw.arguments.slice(0, 200),
        } } });
      }

      // Governance gate (compile-primitive policy modality): enforce BEFORE dispatch,
      // so a gate authored on the spec applies identically on every surface (this loop
      // runs on both the durable + Worker cloud surfaces). `block` refuses the tool —
      // the agent sees the refusal and must take another path; `require-approval` parks
      // the run on a human question (reusing the ask_human pause/resume path) the FIRST
      // time it is reached, then proceeds once the human has answered (the run resumes).
      const gate = evaluatePolicyGate(policyGates, name, toolCallPaths(parsed));
      const candidatePath = typeof parsed.path === 'string' ? parsed.path : null;
      const prospectiveFiles = candidatePath && /^(write_file|edit_file|delete_file)$/.test(name) && !writtenPaths.has(candidatePath)
        ? writtenPaths.size + 1 : writtenPaths.size;
      const containmentBlock = declaredLimits ? checkRunLimits(declaredLimits, {
        files: prospectiveFiles, repositories: repoCtx ? 1 : 0, spendMillicents: 0,
      }) : null;
      const outboundInspection = isHumanOrExternalOutputTool(name)
        ? await inspectOutboundContent(db, { tenantId, executionId, seam: 'tool_output', target: name, content: JSON.stringify(parsed) })
        : { ok: true as const };
      if (!outboundInspection.ok) {
        return { result: { data: { ok: false, error: `Outbound content blocked: ${outboundInspection.reasons.join(', ')}. Remove credential material before contacting a human or external system.` }, isError: true } };
      }
      if (containmentBlock) {
        await recordCloudToolEvent(db, { ...evt, toolName: 'containment.blocked', category: 'tool', toolCallId: call.id, detail: { tool: name, path: candidatePath, limits: declaredLimits }, result: containmentBlock });
        return { result: { data: { ok: false, error: `Blocked by the run's declared containment policy: ${containmentBlock}.` }, isError: true } };
      }
      if (gate.action === 'block') {
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'policy.blocked', category: 'tool', toolCallId: call.id,
          detail: { tool: name, gateId: gate.gateId, reason: gate.reason },
          result: `Blocked ${name}: ${gate.reason}`,
        });
        return { result: { data: { ok: false, error: `Blocked by governance policy: ${gate.reason}. Do not retry this tool — accomplish the task another way, or finish and explain why it cannot proceed.` }, isError: true } };
      }
      if (gate.action === 'require-approval' && !policyAskedGates.has(policyGateCallKey(gate.gateId, name, parsed))) {
        // First encounter OF THIS CALL — ask a human and park. The answer resumes the
        // run; the call key is recorded (in resume state) so the re-reached identical
        // call proceeds (below), while a DIFFERENT call through the same gate is asked
        // on its own merits rather than riding the earlier approval.
        const question = `Approve the agent's use of "${name}"? ${gate.reason}`;
        const { approvalId } = await pauseExecutionForQuestion(env, db, {
          tenantId, executionId, taskId: taskRow.id, projectId,
          ...(cloudAgentRef ? { cloudAgentRef } : {}),
          agentLabel,
          question,
          context: `Governance gate "${gate.gateId}" requires human approval before this tool may run with these arguments: ${JSON.stringify(parsed).slice(0, 500)}`,
          // Same surface, same record: a governance park and an `ask_human` park are
          // the same pause, so a gated run also lands in needs-attention and restores
          // its lane on resume.
          surface: 'durable',
        });
        policyAskedGates.add(policyGateCallKey(gate.gateId, name, parsed));
        // A governance park IS an ask_human park: the same control signal parks the run.
        return { result: {
          data: { ok: false, error: `Paused for human approval of "${name}" (governance gate ${gate.gateId}).` },
          control: { kind: 'ask_human', approvalId, question },
        } };
      }
      // allow — or a require-approval gate already asked + answered.
      return undefined;
    },

    // The finish gates (`cloudAgent/finishGates.ts`), then the verifier cascade (D1) on
    // their named verdict. The run enters `verify` HERE, where it verifies — a phase
    // applied in the end-of-run tail reduced the state into a value nobody read.
    onFinish: async (ctx, summary) => cost.guards.finish(await evaluateFinishGates({
      db, evt, repoCtx, writtenPaths, requiredSignoff, delegated: !!opts?.delegation, summary, output: ctx.output, gates,
      enterVerify: () => { modelState = { ...modelState, policy: applyVerifyPhase(modelState.policy) }; },
    }), ctx.step, guardDeps),

    afterDispatch: async (call, result) => {
      const name = call.name;
      const parsed = call.args;
      const succeeded = dataOk(result.data);
      if (matchesRequiredReviewSignoff(requiredSignoff, name, parsed, succeeded)) {
        gates.reviewVerdictRecorded = true;
      }
      await recordCloudToolEvent(db, {
        ...evt,
        toolName: name, category: 'tool', toolCallId: call.id,
        detail: name === 'write_file' ? { path: parsed.path, summary: parsed.summary } : parsed,
        result: JSON.stringify(result.data).slice(0, 300),
        durationMs: Date.now() - (tStart.get(call.id) ?? Date.now()),
      });
      if (succeeded && (name === 'run_checks' || name === 'run_command' || name === 'builtin_reviews_record')) {
        const kind = name === 'builtin_reviews_record' ? 'review_verdict' : 'validation';
        await recordTypedExecutionClaim(db, { tenantId, executionId, kind, statement: `${name} completed successfully` });
      }
      return undefined;
    },
  };

  const ports: LoopPorts<Row> = {
    complete: async (ctx) => {
      // Per-step dynamic directive seam (the V3 affect block, + budget / task state) on
      // THIS request only — `messages` stays untouched. B1 trails it after the history.
      const requestMessages = cost.turnMessages(messages, opts?.dynamicSystem);
      const turnTools = cost.tools();

      const tGen0 = Date.now();
      // ONE turn under the run policy: it asks for the locked/pinned model, and when the
      // gateway answers 429/413/503 (or a project Evermind DECLINES with a 400) it drops
      // the pin and re-asks once on the gateway's cascade — a pin gets NO in-proxy
      // cascade, so this is what keeps one unavailable model from ending the run. A
      // fetch the cancel watcher aborted mid-call throws here; the kernel reports it as
      // `cancelled` because the run's signal is the watcher's.
      const turnRun = await completeUnderRunPolicy(modelState, (req) => proxy.complete(
        {
          messages: requestMessages as unknown as ChatMessage[],
          tools: turnTools,
          ...turnRequestFields(req),
          // Sampling. Caller-configured `genParams` OUTRANK the personality-derived
          // temperature: an operator who set a temperature on the published model
          // meant that number, whereas the persona value is a derived default.
          ...(genParams.temperature ?? opts?.execParams?.temperature) != null
            ? { temperature: genParams.temperature ?? opts?.execParams?.temperature }
            : {},
          ...(genParams.topP != null ? { top_p: genParams.topP } : {}),
          ...cost.turnFields(genParams.maxTokens),
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
          ...(req.strict
            ? reasoningParamsForModel(req.model, cost.guards.reasoning(cloudReasoningExecParams(env, tenantId, opts?.execParams, req.role), req.role), {
                isFirstTurn: !messages.some((m) => (m as { role?: string }).role === 'assistant'),
              }) ?? {}
            : {}),
          useCase: 'task_execution',
          prompt_cache_key: `cloud:${executionId}`,
        },
        undefined,
        undefined,
        abortController.signal,
      ), (outcome) => recordModelCascade(db, evt, outcome, ctx.step));
      modelState = turnRun.state;
      await cost.recordTurn(turnRun.result);
      // Shared post-`complete` processing (metering + `llm.complete`/degraded/agent.message
      // telemetry) — identical to the container `llm` op. `notify: false`: the loop streams
      // its own final turn. The degraded comparison is the seed/pin (`pick.model`), not the
      // just-locked model.
      const turn = await recordCloudLlmTurn(turnRun.result, {
        env, db, tenantId, cloudAgentRef, executionId: meterExecutionId, taskId: taskRow.id, projectId,
        requestedModel: pick.model, fallbackModel: modelState.policy.model,
        effectivePlan: routing.effectivePlan, premiumOverride: routing.premiumOverride,
        role: runRole,
        phase: modelState.policy.phase,
        turnInput: { messages: requestMessages, tools: turnTools }, toolSchemaTokens: toolsTokensOf(turnTools),
      }, { tGen0, step: ctx.step, notify: false });
      if (!turn.ok) return { failed: turn.error };
      lastResolvedModel = turn.resolvedModel;
      // A turn that acted proves the model is working: its stall budget starts over.
      if (turn.toolCalls.length > 0 && modelState.stallRecoveries > 0) modelState = { ...modelState, stallRecoveries: 0 };
      return { content: turn.content, toolCalls: readOpenAiToolCalls({ tool_calls: turn.toolCalls }) };
    },

    dispatch: async (call) => {
      const meta = cost.dispatch(call);
      if (meta) return meta;
      const platformTool = resolveCloudAgentPlatformTool(call.name, opts?.originatingChatId);
      if (platformTool) {
        // Curated platform tool (create task / update OKR / read remaining work) —
        // run in-process, tenant-scoped, defaulting the project to THIS run's so a
        // follow-up task lands on the right project unless the model names another.
        // MANAGER role so the OKR/task writes the user asked for are permitted; the
        // subset is admin/destructive-free so this can't reach keys/security/etc.
        try {
          const data = await callBuiltinTool(db, {
            tenantId, tool: platformTool,
            arguments: { projectId, ...call.args, ...(opts?.originatingChatId != null ? { chatId: opts.originatingChatId } : {}) },
            env, userId: cloudAgentRef ?? null, agentRef: cloudAgentRef ?? null,
            role: CLOUD_RUN_TENANT_ROLE,
            // Provenance (ticket 5301): this run formed the belief, so a
            // project_facts.remember from here carries the execution id. The model is
            // known but the token counts are metered per turn, not per tool call, and a
            // half-known origin cost is stored as none — so it is omitted, not invented.
            executionId: meterExecutionId,
          });
          return { data: data && typeof data === 'object' ? (data as Record<string, unknown>) : { ok: true, result: data } };
        } catch (e) {
          return { data: { ok: false, error: e instanceof Error ? e.message : String(e) }, isError: true };
        }
      }
      // Repo/file/static-check/human tools. Dispatch through the ONE capability-gated
      // registry — each reaches the repo / static-check / human ONLY via the injected
      // provider (so the same definition runs on-prem against a disk/shell provider).
      // `finish` and `ask_human` come back as CONTROL signals the kernel interprets
      // (through the `onFinish` gates above).
      const dispatched = await cloudToolRegistry.dispatch(call.name, call.args, toolCtx);
      return { data: dispatched.data, ...(dispatched.control ? { control: dispatched.control } : {}) };
    },
  };

  // The in-run guards (`costLoop/loopGuards.ts`: A3 / D7 / D1 / D8) around the hooks and ports.
  const guardDeps: LoopGuardDeps = {
    db, evt, role: runRole, ladder, repoCtx, resolvedModel: () => lastResolvedModel, features: stepFeatures,
    model: { get: () => modelState, set: (next) => { modelState = next; } },
    pause: (question) => pauseExecutionForQuestion(env, db, { tenantId, executionId, taskId: taskRow.id, projectId, ...(cloudAgentRef ? { cloudAgentRef } : {}), agentLabel, question, surface: 'durable' }),
  };
  let loop: LoopResult;
  try {
    loop = await runAgentLoop<Row>({
      messages, codec, ...cost.guards.wrap(hooks, ports, guardDeps),
      signal: abortController.signal,
      budget: { startStep, ...(maxThisCall != null ? { maxSteps: maxThisCall } : {}) },
    });
  } catch (error) {
    // A thrown tool/LLM path is terminal for this invocation. Hand leases back now;
    // otherwise peers remain blocked until the 15-minute TTL even though this run can
    // no longer use them. Preserve the original failure if cleanup itself fails.
    await releaseAllForExecution(env, db, tenantId, executionId, coordinationScopeKey(taskRow.id))
      .catch((releaseError) => reportCaughtError(releaseError, {
        source: 'application/runtime/cloudAgentEngine.ts', operation: 'runCloudToolLoop.releaseAfterThrow',
        context: { tenantId, executionId, taskId: taskRow.id, error: releaseError },
      }));
    throw error;
  } finally {
    // Stop the cancel watcher so its timer can't outlive the run, and abort any
    // fetch still in flight. The watcher is fire-and-forget (it swallows its own
    // read errors), so there is nothing left to await here.
    cancelChannel.stop();
    abortController.abort();
  }
  finalOutput = loop.output;
  finished = loop.finished;
  cancelled = loop.cancelled;
  step = loop.step;
  awaitingInput = loop.awaitingInput
    ? { approvalId: loop.awaitingInput.approvalId ?? '', question: loop.awaitingInput.question }
    : null;
  // A hard stop inside the loop (containment limit, a recorded gateway failure) is
  // terminal for the run WITHOUT finalize or lease release — exactly the two early
  // returns the loop used to make itself.
  if (!loop.ok) return { ok: false, output: finalOutput, cancelled, finished: true };

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
    modelPolicy: modelState,
    routing,
    repoCtx,
    repoMiss,
    ...finishGateSnapshot(gates),
    requiredSignoff,
    policyGates,
    policyAskedGates: [...policyAskedGates],
    ...cost.snapshot(),
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

  // Durable (DO) surface: the per-tick budget is spent but the run isn't done (not
  // finished, not cancelled, not stopped by the failure breaker). Hand back the resume
  // state for the next alarm tick WITHOUT shipping — finalize only happens once the run
  // truly ends. (The Worker surface never sets deferFinalize, so it always falls through
  // to the finalize below — behavior unchanged.)
  const runDone = finished || cancelled || loop.exhausted;
  if (!runDone && opts?.deferFinalize) {
    return {
      ok: true,
      output: '',
      cancelled,
      finished: false,
      state: resumeState(),
    };
  }

  // Terminal: hand every path this run held back to its peers immediately rather than
  // making them wait out the lease TTL. Released here (not in `finally`) because a
  // DEFERRED tick is not the end of the run — the agent keeps its leases across ticks,
  // which is exactly what makes a multi-tick read→edit→write sequence safe.
  await releaseAllForExecution(env, db, tenantId, executionId, coordinationScopeKey(taskRow.id));

  // The global step cap is a safety limit, never an evidence bypass. Exhausting it
  // without the required reviewer verdict fails the run and leaves the slot open
  // for retry/escalation; it must not finalize as successful acceptance.
  if (requiredSignoff && !gates.reviewVerdictRecorded) {
    return {
      ok: false,
      output: missingReviewVerdictMessage(requiredSignoff),
      cancelled,
      finished: true,
    };
  }

  // Rehearsal: the loop is over and nothing may be shipped, closed or summarised onto
  // the real ticket. Hand the transcript back and stop.
  if (opts?.suppressFinalize) return { ok: true, output: finalOutput, cancelled, finished: true };

  // ── VERIFY, then REMEMBER ───────────────────────────────────────────────────
  // The tail this run used to skip. It enters the run policy's `verify` phase around
  // the surface's own verification action (`verifyWrittenFiles` + `pollBranchCi` both
  // already ran in `onFinish`), then commits what the run learned. Both steps are
  // best-effort — neither may delay or undo the finalize below, which IS this run's
  // result.
  await runVerifyThenRemember({ env, db, tenantId, projectId, executionId, taskRow, agentLabel, ...(cloudAgentRef ? { cloudAgentRef } : {}), writtenPaths, finalOutput, ciVerified: gates.ciVerified, modelState });

  const fin = await finalizeCloudRun(env, db, {
    tenantId, cloudAgentRef, executionId, taskRow, agentLabel,
    repoCtx, repoMiss, writtenPaths, finalOutput, cancelled, ciVerified: gates.ciVerified,
  });
  return { ok: fin.ok, output: fin.output, cancelled, finished: true };
}

/**
 * The shared verify-then-remember tail, run from this file so it can move the run's
 * OWN policy state (only a host holding `modelState` can reduce it). Everything it
 * touches is best-effort by contract, so it is one call that cannot fail the run:
 *
 *  1. `runVerifyPhase` selects the verification verdict from what `onFinish` already
 *     ran (`ciVerified`), and `recordRunVerifyEvents` writes BOTH halves onto the
 *     timeline while returning the `verify_started` event for the reducer.
 *  2. The `verify_started` policy event is applied where the run actually VERIFIES —
 *     in `onFinish`, next to `verifyWrittenFiles`/`pollBranchCi` — because that is the
 *     only place the new phase can ride the live `modelState` into the turns a blocked
 *     finish forces. Applying it here, to a state this function only holds a COPY of
 *     and at the very end of the run, reduced it into a value nobody read. This tail
 *     asserts the phase rather than re-applying it.
 *  3. `commitRunMemory` writes the outcome into the governed memory the run already
 *     had as a capability. A failed write is reported and the run still finishes.
 */
async function runVerifyThenRemember(args: {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  executionId: number;
  taskRow: { id: number; title: string };
  agentLabel: string;
  cloudAgentRef?: string;
  writtenPaths: Set<string>;
  finalOutput: string;
  ciVerified: boolean;
  modelState: CloudRunModelState;
}): Promise<void> {
  const { env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, writtenPaths, finalOutput, ciVerified, modelState } = args;
  try {
    // The durable surface has no shell, so its verification is the branch CI /
    // static check `onFinish` already ran — recorded honestly, never as a local
    // typecheck/test that did not happen.
    const outcome = runVerifyPhase({
      surface: 'durable',
      writtenPaths,
      results: ciVerified ? [{ command: 'branch-ci', exitCode: 0 }] : null,
    });
    recordRunVerifyEvents({ db, tenantId, executionId, ...(cloudAgentRef ? { cloudAgentRef } : {}) }, outcome);
    // The `verify_started` POLICY event is applied where the run actually verifies —
    // in `onFinish`, next to `verifyWrittenFiles`/`pollBranchCi` — because only the
    // live `modelState` can carry the new phase into the turns a blocked finish
    // forces. Applying it to a `modelState` this function only holds a COPY of, at
    // the very end of the run, reduced the state into a value nobody read. Assert the
    // invariant instead of pretending to perform the transition: a run that reaches
    // here having verified must already be in the verify phase.
    if (modelState.policy.phase !== 'verify') {
      reportCaughtError(new Error(`run reached its verify tail still in the '${modelState.policy.phase}' phase`), {
        source: 'application/runtime/cloudAgentEngine.ts',
        operation: 'runVerifyThenRemember.assertVerifyPhase',
        context: { logMessage: '[cloud-run] verify phase was not applied before the run end', details: { tenantId, executionId, phase: modelState.policy.phase } },
      });
    }
    await commitRunMemory({
      db, env, tenantId, projectId, ticketId: taskRow.id, executionId,
      ...(cloudAgentRef ? { cloudAgentRef } : {}),
      summary: finalOutput?.trim() || `${agentLabel} finished ${taskRow.title}`,
      verifyNote: describeVerifyOutcome(outcome),
      writtenPaths: [...writtenPaths],
    });
  } catch (error) {
    // Belt-and-braces: `commitRunMemory` swallows its own failures, but a defect in
    // the tail must still never cost this run its result.
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgentEngine.ts',
      operation: 'runVerifyThenRemember',
      context: { logMessage: '[cloud-run] verify/remember tail failed; finishing without it', details: { tenantId, executionId, error } },
    });
  }
}

/** Capture the exact tree a run starts from. Best-effort on the provider read, but
 * never fabricates a ref: absence remains explicit in rehearsal reports. */
export async function stampExecutionSourceRef(db: Db, tenantId: number, executionId: number, repoCtx: TicketRepoContext): Promise<string | null> {
  const sourceSha = await resolveRepoRefSha(repoCtx, repoCtx.branch) ?? await resolveRepoRefSha(repoCtx, repoCtx.base);
  if (!sourceSha) return null;
  const [run] = await db.select({ payload: executions.payload }).from(executions).where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId))).limit(1);
  let payload: Record<string, unknown> = {};
  try { payload = run?.payload ? JSON.parse(run.payload) as Record<string, unknown> : {}; } catch { payload = {}; }
  if (payload.sourceSha === sourceSha) return sourceSha;
  await db.update(executions).set({ payload: JSON.stringify({ ...payload, sourceSha }) }).where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId)));
  return sourceSha;
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
  /** Mirrors {@link CloudLoopOpts.arcStage} — carried on the context so `run()`
   *  can thread it into the loop options on every tick. */
  arcStage?: ArcStage;
  /** Brain chat that launched the execution, when this is a conversation-originated run. */
  originatingChatId?: number;
  /** Resolved assigned artifacts (skills/personas/content). Used by V3 to derive
   *  limbic setpoints from the assigned personas' psychometric profiles. */
  artifacts?: ResolvedArtifacts;
  /** Execution levers compiled from the personas + the agent's own personality
   *  (from {@link prepareCloudRun}). Passed through to the loop's per-turn LLM call. */
  execParams?: AgentExecParams;
  /** The agent's OWN psychometric JSON (ide_agents.psychometric). Folded into the
   *  limbic setpoints alongside the assigned personas. */
  agentPsychometric?: string | null;
  /** Exact accountability slot a reviewer run must sign before it may finish. */
  requiredSignoff?: RequiredReviewSignoff;
  /** How this surface drives the engine. Absent ⇒ `worker` (whole loop, one call). */
  surface?: CloudEngineSurface;
  /** Mirrors {@link CloudLoopOpts.delegation}. */
  delegation?: CloudRunDelegation;
}

/**
 * The surface a cloud run executes on — the ONE place a caller says how many steps
 * an invocation may take and what happens at the end of it, so no call site needs
 * to know the loop's option names.
 *  - `worker`: the whole loop in one call, finalized (PR/merge) at the end.
 *  - `durable`: `maxSteps` per alarm tick; the resume state is handed back instead of
 *    finalizing, and the tick runs under the cursor-held affective state (the DO
 *    evolves it between ticks). No state ⇒ a pre-affect cursor: no directive.
 *  - `rehearsal`: the real loop with every effect shadowed by `decorateProvider`,
 *    nothing finalized, reads optionally pinned to `frozenReadRef`.
 */
export type CloudEngineSurface =
  | { kind: 'worker' }
  | { kind: 'durable'; maxSteps: number; limbicState?: LimbicState }
  | { kind: 'rehearsal'; maxSteps: number; decorateProvider: (provider: CapabilityProvider) => CapabilityProvider; frozenReadRef?: string };

/**
 * The cloud agent engine behind the shared {@link AgentEngine} seam — THE current
 * engine (V3). It drives {@link runCloudToolLoop} (the shared `@builderforce/agent-loop` kernel + the cloud ports/hooks)
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
    const rc = this.rc;
    const surface: CloudEngineSurface = rc.surface ?? { kind: 'worker' };
    // Affect: a durable tick runs under the state its cursor carries (evolved tick to
    // tick by the DO); every other surface seeds it here from the personas' setpoints
    // appraised against the task. Injected through the loop's per-step seam — never
    // into the persisted prompt/conversation.
    const limbicState = surface.kind === 'durable' ? surface.limbicState : await this.seedLimbicState();
    const directive = limbicState ? buildLimbicBlock(limbicState) : '';
    const r = await runCloudToolLoop(
      rc.env, rc.db, rc.executionId, rc.tenantId, rc.taskRow,
      rc.cloudAgentRef, rc.agentLabel, input.model, input.systemPrompt, input.userContent,
      rc.isCancelled, rc.projectId,
      {
        routingBias: rc.routingBias,
        arcStage: rc.arcStage,
        ...(rc.originatingChatId != null ? { originatingChatId: rc.originatingChatId } : {}),
        ...(rc.requiredSignoff ? { requiredSignoff: rc.requiredSignoff } : {}),
        ...(directive ? { dynamicSystem: directive } : {}),
        ...(input.policy?.gates ? { policyGates: [...input.policy.gates] } : {}),
        ...(rc.execParams ? { execParams: rc.execParams } : {}),
        ...(input.genParams ? { genParams: { ...input.genParams } } : {}),
        ...(input.resume ? { resume: input.resume as CloudLoopState } : {}),
        ...(surface.kind === 'durable' ? { maxSteps: surface.maxSteps, deferFinalize: true } : {}),
        // A child's parent opens the pull request for the whole tree.
        ...(rc.delegation ? { delegation: rc.delegation, ...(isChildDelegation(rc.delegation) ? { suppressFinalize: true } : {}) } : {}),
        ...(surface.kind === 'rehearsal'
          ? { maxSteps: surface.maxSteps, suppressFinalize: true, decorateProvider: surface.decorateProvider, ...(surface.frozenReadRef ? { frozenReadRef: surface.frozenReadRef } : {}) }
          : {}),
      },
    );
    return { ok: r.ok, output: r.output, cancelled: r.cancelled, finished: r.finished, awaitingInput: r.awaitingInput, state: r.state };
  }

  /** Personality = setpoints (from the assigned personas' psychometric profiles);
   *  dynamics = the task-appraised affect around those setpoints. Recorded on the
   *  Observability timeline once per seed. */
  private async seedLimbicState(): Promise<LimbicState> {
    const rc = this.rc;
    const setpoints = await loadPersonaSetpoints(rc.env, rc.db, rc.artifacts?.personas ?? [], rc.agentPsychometric);
    const state = initialCloudLimbicState(rc.taskRow, setpoints);
    await recordLimbicState(rc.db, { tenantId: rc.tenantId, cloudAgentRef: rc.cloudAgentRef, executionId: rc.executionId }, state);
    return state;
  }
}

/** The affective state a cloud run starts in: the assigned personas' resting
 *  setpoints, appraised against the task text. Pure + Worker-safe. */
export function initialCloudLimbicState(
  taskRow: { title: string; description: string | null },
  setpoints?: LimbicState,
): LimbicState {
  return appraiseTask(`${taskRow.title}\n${taskRow.description ?? ''}`, setpoints ?? neutralLimbicState());
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
  const after = ev ? applyLimbicDelta(prev, appraiseAmygdala(ev)) : prev;
  return homeostasis(after, setpoints ?? neutralLimbicState(), { rate: 0.1 });
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
  }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "recordLimbicState", context: { logMessage: '[cloud-run] limbic-state telemetry failed', details: { tenantId: args.tenantId, executionId: args.executionId, error } } }));
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
 * until a human approves. When `CLOUD_AUTOMERGE_ENABLED` is on, shipping waits for
 * green CI by default (`CLOUD_AUTOMERGE_REQUIRE_GREEN`; opt out with 0/false/off).
 * Never throws.
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
    /** True when in-run branch CI reported success before finish (ticket #3092). */
    ciVerified?: boolean;
  },
): Promise<{ ok: boolean; output: string }> {
  const { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, finalOutput, cancelled } = args;
  const ciVerified = !!args.ciVerified;
  // A steer that arrived after the loop's last step is NOT released here: the row is
  // not terminal yet, and such a steer now starts a follow-up run (lateSteerFollowUp.ts)
  // that must never start beside the run it follows. Each surface settles it right
  // after its terminal transition — CloudRunnerDO.cleanup, and the container / GitHub
  // Actions `finalize` op.
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
  // Atomic single-PR claim (0140), via the ONE task PR-open step the Done-drag path
  // also uses (`openClaimedPullRequest`): claim BEFORE the external create so this
  // inline run-end finalize can't open a duplicate PR alongside a concurrent human
  // Done-drag. Lost claim => another path is opening the PR; skip everything below
  // and treat it as "PR exists". A failed create has already released the claim.
  const opened = repoCtx && writtenPaths.size > 0 && !cancelled
    ? await openClaimedPullRequest(db, tenantId, taskRow.id, {
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
      title: `Task #${taskRow.id}: ${taskRow.title}`,
      body: `Changes for task #${taskRow.id}, by ${agentLabel}. Files: ${[...writtenPaths].join(', ')}.\n\n${ciVerified
        ? '> ✅ **CI was green in-run** on the ticket-branch HEAD (combined commit status / check-runs). Re-check CI on this PR before merge — opening it or a later push can still go red.'
        : '> ⚠ **Not verified in-agent.** This serverless executor has no shell and ran no local build, type-check, lint, or tests. CI on this PR is the source of truth — do not merge on the agent\'s summary alone.'}`,
    }).catch(() => ({ ok: false as const, claimLost: true as const }))
    : null;
  if (repoCtx && opened && !('claimLost' in opened)) {
    const pr = opened;
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
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] task PR metadata update failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));

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
      if (prOpened) await recordTypedExecutionClaim(db, { tenantId, executionId, kind: 'delivery', statement: `Opened pull request #${pr.ok ? pr.number : ''} for human review.` });
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
        await markPullRequestMergedById(db, prRowId, tenantId, { mergeSha: m.sha ?? null })
          .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] merged PR persistence failed', details: { tenantId, executionId, prRowId, error } } }));
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

  // ── MULTI-REPO SPANNING (0956) ─────────────────────────────────────────────
  // The primary repo's PR (above) is unchanged. A task bound to a repo SET may
  // also have committed to OTHER repos; each of those has its own branch and earns
  // its own PR — but only if it actually received writes. `openTaskRepoSetPullRequests`
  // reads the per-binding write counter, so a bound repo the agent never touched
  // opens nothing. Returns [] for every single-repo task (the overwhelming case).
  let spanningNote = '';
  if (writtenPaths.size > 0 && !cancelled) {
    const spanning = await openTaskRepoSetPullRequests(
      db, integrationCredentialSecret(env), tenantId, taskRow.id, repoCtx?.repoId ?? null,
      {
        title: `Task #${taskRow.id}: ${taskRow.title}`,
        body: `Changes for task #${taskRow.id}, by ${agentLabel} (this ticket spans multiple repositories).

${ciVerified
          ? '> ✅ **CI was green in-run** on the ticket-branch HEAD. Re-check CI on this PR before merge.'
          : '> ⚠ **Not verified in-agent.** CI on this PR is the source of truth.'}`,
      },
    ).catch((error) => {
      reportCaughtError(error, { source: 'application/runtime/cloudAgentEngine.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] spanning PR open failed', details: { tenantId, executionId, taskId: taskRow.id, error } } });
      return [];
    });
    if (spanning.length > 0) {
      spanningNote = ` Also opened ${spanning.filter((p) => p.url).length} PR(s) in ${spanning.map((p) => p.slug).join(', ')}.`;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'pr_opened_spanning', category: 'tool',
        detail: { repos: spanning.map((p) => p.slug) },
        result: spanning.map((p) => (p.url ? `${p.slug} #${p.number}` : `${p.slug}: ${p.error}`)).join('; ').slice(0, 300),
      });
    }
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
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] run branch teardown failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
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
      ? `Committed ${writtenPaths.size} file(s)${repoCtx?.branch ? ` to \`${repoCtx.branch}\`` : ''}${prOpened ? ', opened a PR' : ''}${mergeNote}${noPrNote}.${spanningNote}`
      : cancelled ? CLOUD_RUN_CANCELLED_REASON : '(no output produced)');
  // Only a FAILED auto-merge breaks the "ship it" contract. Approval-gated runs end
  // with the PR open by design, so an unmerged PR there is success, not failure.
  const autoMergeFailed = prOpened && cloudAutoMergeEnabled(env) && !merged;
  // Mark the result unverified whenever a PR was opened: nothing was built or tested
  // in-agent, so the summary's claims are not authoritative — CI on the PR is.
  const unverifiedNote = prOpened && ciVerified
    ? '\n\n✅ In-run CI on the ticket-branch HEAD was green. Re-check CI on this PR before merge.'
    : prOpened
    ? '\n\n⚠ Not verified in-agent — this serverless executor ran no local build/type-check/tests. CI on the PR is the source of truth.'
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
    await contributeTextToProjectEverminds(env, db, tenantId, repoCtx.projectId, output, learnWeight, taskRow.title)
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] Evermind contribution failed', details: { tenantId, executionId, projectId: repoCtx.projectId, error } } }));
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
    }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] GitHub check publication failed', details: { tenantId, executionId, prNumber: openedPrNumber, error } } }));
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
    const comment = `### 🤖 ${agentLabel} — task #${taskRow.id}\n\n${output}${fileBlock}${unverifiedNote}${runUrl}`;
    const inspection = await inspectOutboundContent(db, { tenantId, executionId, seam: 'pull_request_comment', target: `${repoCtx.owner}/${repoCtx.repo}#${openedPrNumber}`, content: comment });
    if (inspection.ok) {
      await recordTypedExecutionClaim(db, { tenantId, executionId, kind: 'human_message', statement: output }).catch(() => ({ ok: false as const, error: 'claim failed' }));
      await postRepoPrComment(
        env, db, tenantId, repoCtx.repoId, openedPrNumber,
        comment,
        { kind: 'agent-run', scope: executionId },
      ).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] PR summary comment failed', details: { tenantId, executionId, prNumber: openedPrNumber, error } } }));
    }
  }

  // STAMP WHAT THIS RUN LEFT BEHIND (0385) — the last thing finalize does, from the
  // SAME facts the learn weight above is graded on, so the two can never disagree.
  //
  // This is the signal the autonomy breaker was missing. It counted `failed` runs only,
  // so a run that COMPLETED and shipped nothing reset the streak and was re-dispatched
  // on the next five-minute tick, forever: 5,931 completed runs against 10 failures and
  // 3 finished tickets in one day on project 11, one agent at 5,796 runs / 0 finished,
  // while 371 tickets on the same board had never run at all because the tenant's
  // dispatch ceiling was spent on the re-runs.
  //
  // A CANCELLED run is deliberately left UNJUDGED (null): a person stopped it, which
  // says nothing about whether the ticket can succeed — the same reading the breaker
  // already takes of a cancellation, and of a platform eviction.
  if (!cancelled) {
    await db.update(executions)
      .set({ produced: runProducedOutput({ merged, prOpened, producedChanges: writtenPaths.size > 0 }) })
      .where(eq(executions.id, executionId))
      .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudAgentEngine.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] produced-stamp failed — this run will not count toward the autonomy breaker', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
  }

  // Did this run clear the reflection bar? Recorded either way, because "a run that
  // produced verified work proposed no skill" is a fact a reviewer should be able to
  // see — and (E1) a verified run whose model proposed nothing gets a DRAFT written for
  // it from its own trace. Never throws.
  await recordRunReflection(env, db, {
    tenantId, ...(cloudAgentRef ? { cloudAgentRef } : {}), executionId, taskRow, agentLabel,
    projectId: repoCtx?.projectId ?? null, merged, prOpened, ciVerified, writtenPaths: [...writtenPaths],
  });

  // The run is terminal: its callback principal stops authenticating NOW, not at its
  // 24h expiry. Best-effort — the DB-state check on every callback already refuses a
  // terminal run; this is what makes the revocation visible in the principal row.
  await revokeRunPrincipal(db, tenantId, executionId)
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudAgentEngine.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] run principal revocation failed', details: { tenantId, executionId, error } } }));

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
  opts?: {
    shell?: boolean;
    /**
     * REHEARSAL: prep must not change anything.
     *
     * The shadow provider (application/rehearsal/shadowProvider.ts) intercepts the
     * LOOP, but prep runs BEFORE the loop and is not read-only by default: it drafts
     * and commits a PRD to the real ticket branch, and records a personality-
     * application event attributed to the agent. Both escape a rehearsal — the first
     * as a real commit, the second as skew in personality telemetry. This flag makes
     * prep observe-only; everything it READS is unchanged, so the prompts a rehearsal
     * runs on are the prompts the live run would get (minus a PRD it would have
     * created, which the report notes).
     */
    readOnly?: boolean;
    /** Rehearsal/replay may pin the exact immutable definition observed by the source
     * run. Live runs omit this and freeze the current row at the run boundary. */
    agentDefinitionSnapshot?: Record<string, unknown>;
  },
): Promise<{ systemPrompt: string; userContent: string; execParams: AgentExecParams; agentPsychometric: string | null }> {
  const tPrep0 = Date.now();
  // The capability set this run's surface advertises. Resolved ONCE: the identity it
  // issues and the prompt it builds have to agree about which tools exist, and a
  // second `opts?.shell ? … : …` further down is how they stop agreeing.
  const surfaceCaps = prepSurfaceCaps(env, tenantId, opts?.shell === true);
  const prepIdentity = await ensureAgentRunIdentity(db, {
    tenantId, executionId, agentRef: cloudAgentRef, issuedBy: `execution:${executionId}`,
    capabilities: [...surfaceCaps],
  });
  // The agent's OWN personality (independent of assigned personas) — folded into the
  // capability prompt block, the exec params, and (by the caller) the limbic setpoints.
  const frozenPsychometric = opts?.agentDefinitionSnapshot?.psychometric ?? prepIdentity.definition?.psychometric;
  const agentPsychometric = typeof frozenPsychometric === 'string'
    ? frozenPsychometric
    : await loadAgentPsychometric(env, tenantId, cloudAgentRef);
  // The PRD is the slow leg — on a first pass it is a paid LLM draft plus a real branch
  // commit — so it is started here and handed to the shared assembler as a PROMISE,
  // keeping it overlapped with every other read exactly as the old inline `Promise.all`
  // did. Only the CLOUD path may create a PRD; every other surface reads the stored one.
  const prdPromise = ensureTaskPrd(env, db, executionId, taskRow, tenantId, projectId, taskRow.id, agentLabel, model, opts?.readOnly === true);
  const [capabilities, workspace, workspaceSkills] = await Promise.all([
    loadCapabilityContext(env, db, tenantId, artifacts, agentPsychometric),
    // The repo the agent runs against — its identity + top-level shape (so a wrong/
    // empty binding is visible before any LLM spend) AND what a prior pass already
    // committed to this branch (so a re-run reconciles instead of blindly appending).
    // Best-effort: a clean first run / no repo yields an empty workspace.
    loadWorkspaceContext(env, db, integrationCredentialSecret(env), tenantId, taskRow.id),
    // Procedures THIS workspace approved — including ones an earlier run proposed
    // after producing graded proof. Cached read; only `approved` rows are returned,
    // so a draft never reaches a prompt.
    approvedSkillsForRun(env, db, tenantId, projectId ?? null),
  ]);
  const prd = await prdPromise;
  const priorChanges = workspace.priorChanges;
  const repoLabel = workspace.repo ? `${workspace.repo.owner}/${workspace.repo.repo}` : null;
  await Promise.all([
    recordContextContribution(db, { tenantId, executionId, sourceKind: 'ticket', sourceRef: String(taskRow.id), trustTier: 'tenant', content: `${taskRow.title}\n${taskRow.description ?? ''}` }),
    ...(prd ? [recordContextContribution(db, { tenantId, executionId, sourceKind: 'prd', sourceRef: String(taskRow.id), trustTier: 'tenant', content: prd })] : []),
    ...(repoLabel ? [recordContextContribution(db, { tenantId, executionId, sourceKind: 'repository', sourceRef: repoLabel, trustTier: 'repository', content: `${workspace.topLevel.join('\n')}\n${priorChanges.map((c) => c.path).join('\n')}` })] : []),
  ]);
  // Record capability loading as its own timeline event so the Observability
  // timeline shows exactly which Skills/Personas/Content the cloud agent loaded.
  const cap = capabilities.summary;
  if (cap.skills.length || cap.personas.length || cap.content.length) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'capabilities.load', category: 'context',
      detail: cap,
      // Say which of them this agent actually CARRIES. "3 skills loaded" was true of a
      // run whose agent was assigned none of them — every one inherited from the tenant.
      result: `${cap.personas.length} persona(s), ${cap.skills.length} skill(s), ${cap.content.length} content`
        + ` · ${cap.agentPinned.length} agent-pinned, ${(cap.skills.length + cap.personas.length + cap.content.length) - cap.agentPinned.length} inherited`
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
  // Skipped for a rehearsal: this attributes a personality APPLICATION to the agent,
  // and a probe must not move the numbers that describe how the real agent behaves.
  if (cloudAgentRef && !opts?.readOnly) {
    const application = compilePersonalityApplication({
      agentPsychometric,
      execParams: capabilities.execParams,
      personaIds: capabilities.summary.personas,
    });
    if (application) {
      await recordPersonalityEvent(env, db, tenantId, { agentRef: cloudAgentRef, executionId, ...application })
        .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "prepareCloudRun", context: { logMessage: '[cloud-run] personality telemetry failed', details: { tenantId, executionId, cloudAgentRef, error } } }));
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

  // The role-participation ask: "you are the <role> accountable for this ticket —
  // record your verdict with builtin_kanban_signoff". Written by
  // buildSignoffRequestPayload / buildProducerRequestPayload and, until this line,
  // read by nothing — so a reviewer was dispatched to judge work and never asked to
  // record the judgement. See parseRoleInstruction for the measured impact.
  const roleInstruction = parseRoleInstruction(payload);

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

  // ── The run's context, as BLOCKS ────────────────────────────────────────────
  //
  // Everything below is a `RunContextBlock` from `@builderforce/run-context`, not a
  // string spliced into a local array. The blocks the api can assemble for ANY surface
  // (strategy, PRD, governance, the ticket, project memory, Evermind lessons) come from
  // `buildRunContext`; the ones only THIS executor knows — the headline directive, the
  // bound repository, what a prior pass left on the branch, the capability prompt and the
  // executor-specific tool guidance — are handed to it as `extraBlocks` so they travel
  // the same reconciliation path. `renderRunContext` then produces the two prompts, in
  // the same order and with the same separators this function used to build inline.
  const surfaceBlocks: RunContextBlock[] = [
    // FIRST, deliberately: this is the accountability ask the run exists to answer.
    // A role run that produces the deliverable but records nothing leaves its slot
    // in `in_progress` forever — the state whose only exit is this tool call.
    {
      kind: 'directive', subject: `role:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.role,
      trustTier: 'tenant', pinned: true,
      body: roleInstruction ? `## Your role on this ticket — RECORD YOUR VERDICT\n\n${roleInstruction}` : '',
    },
    {
      kind: 'directive', subject: `review:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.review,
      trustTier: 'tenant', pinned: true,
      body: isReviewRun
        ? `## Acceptance review (do NOT edit code)\n\nThis is a VALIDATOR REVIEW of already-Done work — verify the ticket was genuinely completed against its PRD/requirements and the repository. Read the branch/PR and the relevant code with search_code / read_file, judge whether the deliverable is complete and correct, then call the \`builtin_reviews_record\` tool with your verdict ('complete' or 'gaps'), a short assessment, and any concrete gaps (each becomes a GAP ticket).\n\n**Anchor every gap you can to the code.** When a gap is about a specific line you read, pass \`path\` (repo-relative, exactly as it appears in the change) and \`line\` on that gap — it is then posted as an inline comment on the pull request, on that line, where a human reviewer will actually see it. Only anchor to files this change actually touched. Leave \`path\`/\`line\` unset for gaps about work that is MISSING (no tests, an unimplemented requirement) — those have nowhere to point and go in the review summary, which is equally visible. Do NOT invent a location to satisfy the field.\n\nDo NOT write_file / delete_file or change the ticket's status — you are reviewing, not implementing.`
        : '',
    },
    {
      kind: 'directive', subject: `incident:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.incident,
      trustTier: 'tenant', pinned: true,
      body: isIncidentRun
        ? `## Incident triage (do NOT edit code)\n\nYou are the INCIDENT MANAGER working an OPEN incident${incidentRunId ? ` (incident \`${incidentRunId}\`)` : ''} — help-desk triage and response, NOT a code change. Steps:\n1. Read the incident with \`builtin_incidents_get\`; read the source ticket in the task description.\n2. **Search the knowledge base FIRST** with \`builtin_knowledge_search\` for prior similar incidents, RCAs, or known-errors — if this has happened before, reuse the documented workaround/resolution instead of starting from scratch.\n3. Work out WHICH SYSTEM the issue pertains to and record it with \`builtin_incidents_classify\`.\n4. Set an accurate severity with \`builtin_incidents_update\` (sev1 = full outage / broad impact … sev4 = minor).\n5. Page whoever is on call with \`builtin_oncall_page\` (check \`builtin_oncall_list\` first). Escalation to later tiers happens automatically on a timer until someone acknowledges.\n6. Post what you find and do to the war-room feed with \`builtin_incidents_add_note\`.\n7. When the incident is resolved, set its status to resolved with \`builtin_incidents_update\`, then **publish a post-mortem** with \`builtin_incidents_postmortem\` (root cause, contributing factors, resolution, what went well/wrong, and concrete action items) — it becomes a searchable Knowledge RCA, files the action items as remediation tasks, and teaches the workforce not to repeat the cause.\nDo NOT write_file / delete_file — you are triaging, not implementing.`
        : '',
    },
    {
      kind: 'directive', subject: `remediation:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.remediation,
      trustTier: 'tenant', pinned: true,
      body: remediation
        ? `## Build failure to fix (attempt ${remediation.attempt}/${remediation.maxAttempts})\n\n${
            remediation.phase === 'pre_merge'
              ? 'The CI build on this task’s pull-request branch FAILED — it must be green before the PR can merge. Fix the cause below — do not re-do unrelated work.'
              : 'A previous change for this task was merged but the build then FAILED. Fix the cause below — do not re-do unrelated work.'
          }\n\n${remediation.buildError}${remediation.runUrl ? `\n\nCI run: ${remediation.runUrl}` : ''}`
        : '',
    },
    {
      kind: 'directive', subject: `follow-up:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.followUp,
      trustTier: 'tenant', pinned: true,
      body: followUp
        ? `## Follow-up directive (act on this first)\n\nThe user reviewed the previous run${followUp.priorExecutionId != null ? ` (execution #${followUp.priorExecutionId})` : ''} and sent this new direction. Treat it as the primary goal for THIS run, building on the work already committed to the task's branch (see the prior-files list below) rather than starting over:\n\n${followUp.directive}`
        : '',
    },
    {
      kind: 'workspace', subject: `workspace:${taskRow.id}`, channel: 'user', order: RUN_CONTEXT_ORDER.workspace,
      trustTier: 'repository', sourceRef: repoLabel ?? 'unbound workspace',
      body: `${trustNotice('repository', repoLabel ?? 'unbound workspace')}\n\n${workspaceBlock}`,
    },
    {
      kind: 'prior_changes', subject: `prior-changes:${taskRow.id}`, channel: 'user', order: RUN_CONTEXT_ORDER.priorChanges,
      trustTier: 'repository', ...(repoLabel ? { sourceRef: repoLabel } : {}),
      body: priorChangesBlock ?? '',
    },
    // ── system channel ──────────────────────────────────────────────────────
    {
      kind: 'tooling', subject: `executor:${opts?.shell ? 'container' : 'durable'}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.coreTooling, trustTier: 'operator', pinned: true,
      // The executor's tooling prompt (shell vs CI verification) with the D5 diff-edit
      // and D8 parallel-read wording when their levers are on.
      body: workModeToolingPrompt({
        shell: opts?.shell, diffEdits: isCostLeverOn(env, 'd5_output_caps', tenantId), parallelReads: isCostLeverOn(env, 'd8_parallel_tool_calls', tenantId),
      }),
    },
    {
      // Platform (project-management) tools — advertised alongside the repo tools on
      // every cloud surface (durable + container). This is what lets a run manage the
      // project as it works instead of silently dropping out-of-scope findings.
      kind: 'tooling', subject: 'platform-tools', channel: 'system',
      order: RUN_CONTEXT_ORDER.platformTooling, trustTier: 'operator', pinned: true,
      body: 'You ALSO have PLATFORM tools (prefixed `builtin_`) to manage the project as you work — they act on the SAME project boards the humans use, not the repo. '
        + 'Use `builtin_tasks_list` / `builtin_tasks_get` to see what is already tracked; '
        + '`builtin_tasks_create` to file a NEW task for any gap, bug, or follow-up work you find that is OUT OF SCOPE for THIS task — do NOT silently drop it, capture it as a task so it is not lost; '
        + '`builtin_tasks_update` to reflect progress; and `builtin_objectives_update` / `builtin_key_results_update` to update the OKR/objective progress your work advances. '
        + "They default to THIS run's project; pass an explicit projectId only to target another. "
        + 'When you finish, base any "what remains" statement on real state — the tasks you actually created plus `builtin_tasks_list` — never a guess.',
    },
    {
      kind: 'capabilities', subject: `capabilities:${executionId}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.capabilities, trustTier: 'tenant', pinned: true,
      body: capabilities.promptBlock || '',
    },
    {
      // Reflection: a run that reaches a verified result may distil what it did into
      // a skill DRAFT for review. Prompt-side because only the agent knows which of
      // the things it did were the repeatable ones, and it knows that at the end.
      kind: 'directive', subject: `reflection:${executionId}`, channel: 'user',
      order: RUN_CONTEXT_ORDER.followUp, trustTier: 'operator', pinned: true,
      body: skillReflectionDirective(repoLabel != null && surfaceCaps.has('skill.author')),
    },
    {
      // The workspace's OWN approved skills — procedures earlier runs worked out and
      // a human signed off. Same trust tier as assigned capabilities: a person
      // approved them, and an unapproved draft can never appear here.
      //
      // An Agent Skills CATALOG (name + description each), not the bodies: the run
      // loads a skill's instructions — and any file bundled with it — through the
      // platform `skills.read` tool when its task matches, which is the spec's
      // progressive disclosure and costs one line per skill instead of the whole text.
      kind: 'capabilities', subject: `workspace-skills:${executionId}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.capabilities, trustTier: 'tenant', pinned: true,
      // E1: only the approved skills relevant to this task (top 5), not all 50.
      body: renderSkillCatalogBlock(workspaceSkillSummaries(isCostLeverOn(env, 'e1_skill_ranking', tenantId) ? rankSkillsForTask(workspaceSkills, `${taskRow.title} ${taskRow.description ?? ''}`) : workspaceSkills)),
    },
  ];

  // Strategy / PRD / governance / ticket / project memory / Evermind lessons — the
  // blocks EVERY surface now gets, from the ONE assembler. Reconciled through Evermind
  // cognition against `task:<id>`, so a PRD or a rule that CHANGED since a prior pass on
  // this ticket arrives marked as a change rather than as a second competing statement.
  // `elideUnchanged` stays off: this prompt is built fresh per run, so an elided block is
  // one the model can no longer see.
  const runContext = await buildRunContext(env, db, {
    tenantId,
    projectId,
    taskId: taskRow.id,
    scope: `task:${taskRow.id}`,
    query: `${taskRow.title} ${taskRow.description ?? ''}`.trim(),
    ...(cloudAgentRef ? { agentRef: cloudAgentRef } : {}),
    task: taskRow,
    prd,
    extraBlocks: surfaceBlocks,
    elideUnchanged: false,
  });
  const { systemPrompt, userContent } = renderRunContext(runContext.envelope);

  // Recorded HERE rather than before the assembly so the Observability timeline names the
  // blocks this run actually received — the question "was the agent even told the rules?"
  // used to be unanswerable from the timeline, which is how a whole surface went years
  // without strategic context and nothing showed it.
  await recordCloudToolEvent(db, {
    tenantId, cloudAgentRef, executionId,
    toolName: 'context.prepare', category: 'planning',
    detail: {
      blocks: runContext.full.blocks.map((b) => b.kind),
      unchanged: runContext.unchanged,
      repo: repoLabel,
      fileCount: workspace.fileCount,
      priorFiles: priorChanges.length,
    },
    result: `${summarizeBlocks(runContext.envelope.blocks)}`
      + ` · ${repoLabel ? `workspace ${repoLabel} (${workspace.fileCount}${workspace.truncated ? '+' : ''} file(s))` : `no repo bound${workspace.reason ? ` (${workspace.reason})` : ''}`}`
      + ` · ${priorChanges.length ? `${priorChanges.length} prior file(s) on branch` : 'clean branch'}`,
    durationMs: Date.now() - tPrep0,
  });

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
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "markCloudExecutionRunning", level: 'warning', context: { logMessage: '[cloud-run] running transition rejected', details: { executionId, error } } });
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

