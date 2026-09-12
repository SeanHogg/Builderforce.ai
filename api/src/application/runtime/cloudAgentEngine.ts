import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { splitVendorReasoning, type ChoiceMessageLike } from '@builderforce/agent-loop';
import { reportCaughtError } from '../observability/caughtErrorReporter';
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
} from './cloudAgent/routing';
export type { CloudRouting, LearnedRoutingInputs } from './cloudAgent/routing';
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
import { and, eq, sql } from 'drizzle-orm';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { buildMemoryCapability } from '../memory/memoryService';
import { approvedSkillsForRun, buildSkillAuthoringCapability, renderSkillBlock } from '../skills/tenantSkillService';
import { runEarnedReflection, skillReflectionDirective } from '../skills/skillReflection';
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
import { createPullRequest } from '../repos/createPullRequest';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from '../repos/mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from '../repos/recordPullRequestRow';
import { publishAgentRunVerdict } from '../checks/publishTaskVerdict';
import { postRepoPrComment } from '../repos/postPrComment';
import { claimTaskPrOpen, releaseTaskPrClaim, openTaskRepoSetPullRequests } from '../repos/openTaskPullRequest';
import { readRepoFile, listRepoFiles, searchRepoCode, listBranchDiff } from '../repos/readRepoContents';
import { verifyWrittenFiles } from '../repos/verifyWrittenFiles';
import { scanWrittenForPlaceholders } from '../repos/scanForPlaceholders';
import { CODING_BACKSTOP_MODELS, RECOGNIZED_CODER_MODELS, codingModelsForPlan, estimateRequestTokens, isPremiumModelSelection, llmProxyForPlan, pickCloudModel, type ChatMessage, type EffectivePlan } from '../llm/LlmProxyService';
import { evaluatePremiumModelAccess } from '../../domain/tenant/planFeatures';
import { TenantPlan } from '../../domain/shared/types';
import { compactMessages, buildGatewaySummarizer, CLOUD_COMPACT_DEFAULTS } from '../llm/compactMessages';
import { resolveTenantLlmCredentials, byoVendorIdsFromCredentials, type TenantVendorKeys } from '../llm/tenantProviderKeyService';
import { assertCloudRunByo, type CloudByoFailure } from '../llm/cloudByoPolicy';
import { cloudAgentPlatformToolSchemas, resolveCloudAgentPlatformTool, callBuiltinTool } from '../llm/builtinMcpService';
import { TenantRole } from '../../domain/shared/types';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { recordUsageRow, clampTokenCount, normalizeByoProvider } from '../llm/usageLedger';
import { logTrace } from '../llm/traceLogger';
import { ensureTaskPrdRecord, appendTaskPrdRevision, editTaskPrdSection, findTaskPrimarySpec } from '../prd/taskPrd';
import { loadCapabilityContext, loadPersonaSetpoints } from '../artifact/capabilityContext';
import { recordPersonalityEvent, compilePersonalityApplication } from '../persona/recordPersonalityEvent';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { applyPendingSteering, startCancelWatcher, CLOUD_RUN_CANCELLED_REASON } from './cloudLoopControl';
import { notifyExecutionSubscribers } from './executionEvents';
import { coercePausedLoopState, pauseExecutionForQuestion, withPausedToolResults, PAUSED_TOOL_RESULT_NOTE } from './executionPause';
import {
  CONTAINER_AGENT_TOOLS, CONTAINER_SURFACE_CAPS, CLOUD_AGENT_TOOLS, CLOUD_SURFACE_CAPS, cloudToolRegistry,
  MAX_PLACEHOLDER_FINISH_BLOCKS,
  assertsUnrunVerification, hasNoCodeDeliverable, policyGateCallKey, type RawToolCall,
} from './cloudAgentTools';
import {
  CURRENT_ENGINE_ID, evaluatePolicyGate, filterByGlob, applyStringEdit,
  appraiseTask, buildLimbicBlock, compileLimbicState, neutralState,
  applyDelta, appraiseAmygdala, homeostasis,
  type AgentEngine, type AgentRunInput, type AgentRunResult, type CapabilityProvider, type ToolContext, type LimbicState, type LimbicEvent, type PolicyGate, type AgentExecParams, type Capability,
  type PrdWriteCapability, type PrdUpdateResult, type ToolSchema,
} from '@builderforce/agent-tools';
import { runAgentLoop, openAiChatCodec, readOpenAiToolCalls, type LoopHooks, type LoopPorts, type LoopResult } from '@builderforce/agent-loop';
import { buildOrchestrationCapability, imageHostedChildCeiling } from './cloudSubagent';
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
import { recordCodeCompletionClaim, recordTypedExecutionClaim } from '../provenance/finishClaimService';
import { authorizeCredentialDelegation, delegateCredential, ensureAgentRunIdentity, revokeRunPrincipal } from '../agentIdentity/agentRunIdentity';
import { checkRunLimits } from '../../domain/containment/runLimits';
import { isHumanOrExternalOutputTool, trustNotice } from '../../domain/trust/contentTrust';
import { inspectOutboundContent, recordContextContribution } from '../trust/trustService';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { boards, executionLimits, executions, llmUsageLog, tasks, toolAuditEvents, usageSnapshots, ideAgents, taskFileChanges } from '../../infrastructure/database/schema';
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
    platformSurcharge?: boolean;
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
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "recordCloudUsage", context: { logMessage: '[cloud-usage] execution usage snapshot failed', details: {
      tenantId: args.tenantId,
      executionId: args.executionId,
      model: args.model,
      error,
    } } });
  }
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
    premiumSurcharge: args.platformSurcharge === true || (args.effectivePlan
      ? isPremiumModelSelection(args.model, args.effectivePlan, args.premiumOverride ?? false)
      : false),
  });
}

/** Parse the assistant turn (content + reasoning + tool calls) off a gateway
 *  chat-completion response body. One reader for both the in-Worker loop and the
 *  container `llm` op. Reasoning comes through {@link splitVendorReasoning} so every
 *  vendor shape (Anthropic thinking, `reasoning_content`, OpenRouter `reasoning`,
 *  inline `<think>`) lands on the same `thinking` timeline row. */
export function parseLlmChoice(json: unknown): { content: string; reasoning: string; toolCalls: RawToolCall[] } {
  const j = json as { choices?: Array<{ message?: ChoiceMessageLike & { tool_calls?: unknown } }> } | null;
  const choice = j?.choices?.[0]?.message;
  const { content, reasoning } = splitVendorReasoning(choice);
  const toolCalls = Array.isArray(choice?.tool_calls) ? (choice!.tool_calls as RawToolCall[]) : [];
  return { content, reasoning, toolCalls };
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
  /**
   * The run's OWN `llm_traces` row (0949).
   *
   * The `llm.complete` timeline event below has always carried `result.traceId` —
   * and it resolved to nothing, because trace rows were written only by the gateway
   * ROUTES and a cloud run calls `complete()` in-process. Writing it here is what
   * turns that id into a link, and stamping `executionId` on it is what lets the run
   * detail read its own turns' model + token facts as columns instead of parsing
   * them back out of a JSON `args` blob.
   *
   * No `ExecutionContext` exists inside the engine (a run is driven from a DO alarm
   * or a container callback, not a request), so this is a best-effort floating write
   * — the trace logger's documented fallback. It can never fail the turn.
   */
  const writeCloudTrace = (responseBody: unknown, errorMessage: string | null): void => {
    if (!result.traceId) return;
    logTrace(rc.env, undefined, {
      traceId: result.traceId,
      surface: 'cloud',
      tenantId: rc.tenantId,
      executionId: rc.executionId,
      result,
      usage: result.usage ?? null,
      streamed: false,
      useCase: 'task_execution',
      callerMetadata: {
        taskId: rc.taskId,
        ...(rc.projectId != null ? { projectId: rc.projectId } : {}),
        ...(rc.cloudAgentRef ? { cloudAgentRef: rc.cloudAgentRef } : {}),
        ...(opts.step != null ? { step: opts.step } : {}),
      },
      responseBody,
      errorMessage,
    });
  };
  if (result.usage) {
    await recordCloudUsage(rc.env, rc.db, {
      ...evtBase, taskId: rc.taskId, projectId: rc.projectId, model: resolvedModel,
      ...(rc.effectivePlan ? { effectivePlan: rc.effectivePlan, premiumOverride: rc.premiumOverride ?? false } : {}),
      inputTokens: result.usage.promptTokens ?? 0, outputTokens: result.usage.completionTokens ?? 0,
      byo: result.byoFunded ?? false,
      byoProvider: result.byoFunded ? normalizeByoProvider(result.resolvedVendor) : null,
      platformSurcharge: result.platformSurcharge,
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
    // 600, not 300: a fail-closed BYO 503 spends its body naming the providers that
    // were connected, which of them resolved, and every model the chain walked. At 300
    // that list was cut off mid-sentence and the lifecycle report showed only the
    // generic headline — the exact reason "no configured provider is usable" read as a
    // lie next to four connected accounts.
    writeCloudTrace(text || null, `gateway ${result.response.status} on '${resolvedModel}' (${result.outcome ?? 'error'})`);
    return { ok: false, error: `Gateway ${result.response.status} on model '${resolvedModel}'${chain}: ${text.slice(0, 600)}`, resolvedModel };
  }
  const upstream = await result.response.json().catch(() => null);
  writeCloudTrace(upstream, null);
  const { content, reasoning, toolCalls } = parseLlmChoice(upstream);
  await recordCloudToolEvent(rc.db, {
    ...evtBase, toolName: 'llm.complete', category: 'llm',
    detail: { model: resolvedModel, provider: result.resolvedVendor, byo: result.byoFunded ?? false, keySource: result.byoFunded ? 'byo' : 'builderforce-managed', traceId: result.traceId ?? null, step: opts.step, toolCalls: toolCalls.length, reasoningChars: reasoning.length },
    result: `${toolCalls.length} tool call(s)${content ? ` · ${content.length} chars` : ''}`, durationMs,
  });
  await emitCodingModelDegraded(rc.db, { ...evtBase, resolvedModel, requestedModel: rc.requestedModel ?? '' });
  if (reasoning) {
    // The reasoning path, as its own timeline row — the `thinking` category the
    // schema documented and no writer emitted. The Observability timeline renders it
    // as a thought track ahead of the message/tool calls; the run drawer's Tools tab
    // excludes it from the tool count. It spans the turn's generation time: without
    // a duration the timeline drew it zero-width, i.e. invisible.
    await recordCloudToolEvent(rc.db, {
      ...evtBase, toolName: 'agent.thinking', category: 'thinking',
      detail: { step: opts.step, model: resolvedModel, content: reasoning }, result: reasoning.slice(0, 280),
      durationMs,
    });
  }
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
 * ONE metered model turn on behalf of an IMAGE-run surface (the Cloudflare Container
 * or the GitHub Actions runner).
 *
 * Both places an image causes a completion go through here: the `llm` op that advances
 * its own loop, and the `spawn` op's CHILD loop. That is the point — a sub-agent
 * commissioned from a container used to be the easiest place for routing to drift
 * (a child funded from the wrong pool, or billed to nobody, is invisible until the
 * invoice), and sharing the primitive makes the two impossible to tell apart in the
 * ledger.
 *
 * Everything genuinely per-caller stays outside: the parent's steering drain and
 * history compaction belong to the `llm` op, and the child's transcript is its own.
 */
async function imageRunTurn(
  run: {
    env: Env;
    db: Db;
    ctx: ContainerRunContext;
    executionId: number;
    tenantId: number;
    projectId: number;
    taskId: number;
    cloudAgentRef: string | undefined;
    /** The run's explicit model pin, if it has one. */
    model: string | undefined;
  },
  args: {
    messages: Array<Record<string, unknown>>;
    tools: ToolSchema[];
    /** Surface the assistant message to subscribers. TRUE for the parent's own turn
     *  (an image has no separate output stream); FALSE for a child's, whose turns are
     *  an implementation detail of one parent tool call. */
    notify: boolean;
    tGen0?: number;
    signal?: AbortSignal;
  },
): Promise<{ ok: true; content: string; toolCalls: unknown[] } | { ok: false; error: string; code?: string }> {
  const { env, db, ctx, executionId, tenantId, projectId, taskId, cloudAgentRef, model } = run;
  const tGen0 = args.tGen0 ?? Date.now();
  // A connected Claude subscription powers a direct-Claude turn; BYO OpenAI/Google/
  // Anthropic api-keys override the operator keys for their vendors (tenant-funded →
  // byo). One round-trip (parallel reads); empty (operator-key floor) when the tenant
  // has connected nothing. Resolved BEFORE the model pick so a free tenant may pin a
  // BYO model (byoVendors lifts the free-plan choice gate).
  const creds = await resolveTenantLlmCredentials(env, tenantId);
  // Same fail-closed BYO rule as the in-Worker loop (GAP-B4) — an image is a cloud
  // execution surface too, so it must not degrade onto the platform key.
  const byoBlocked = await refuseCloudRunWithoutByo(db, { tenantId, cloudAgentRef, executionId }, creds);
  if (byoBlocked) return { ok: false, error: byoBlocked.message, code: byoBlocked.code };
  const { anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, vendorKeys: tenantVendorKeys } = creds;
  const pick = pickCloudModel(model, ctx.effectivePlan, ctx.premiumOverride, {
    // Context-aware seed: a small-window model isn't picked for a big turn.
    estimatedTokens: estimateRequestTokens(args.messages, args.tools),
    byoVendors: byoVendorIdsFromCredentials(creds),
    // Tenant BYO precedence — lead with the owner's chosen account (e.g. Meta first).
    byoVendorPriority: creds.vendorPriority,
    byoAlertedVendors: creds.alertedVendors ?? [],
    isSuperadmin: ctx.isSuperadmin,
    registeredOpenRouterModels: creds.registeredOpenRouterModels,
    preferredRegisteredModel: creds.preferredOpenRouterModel,
    // Parity with the durable loop: a PREMIUM pin needs a validated billing card.
    premiumEntitled: ctx.premiumEntitled,
  });
  const result = await llmProxyForPlan(env, ctx.effectivePlan, ctx.premiumOverride, {
    backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true,
    ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}),
    ...(openaiCodexAuth ? { openaiCodexAuth } : {}),
    ...(xaiOAuthToken ? { xaiOAuthToken } : {}),
    ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}),
    ...(creds.vendorPriority.length ? { byoVendorPriority: creds.vendorPriority } : {}),
    ...(creds.alertedVendors?.length ? { byoAlertedVendors: creds.alertedVendors } : {}),
    ...(creds.providerPriorities?.length ? { byoProviderPriorities: creds.providerPriorities } : {}),
    ...(creds.openRouterConnections?.length ? { openRouterConnections: creds.openRouterConnections } : {}),
    ...(creds.openRouterModelKeys && Object.keys(creds.openRouterModelKeys).length ? { openRouterModelKeys: creds.openRouterModelKeys } : {}),
    ...(creds.configuredProviders.length ? { byoRequired: true } : {}),
  }).complete({
    messages: args.messages as unknown as ChatMessage[], tools: args.tools, tool_choice: 'auto',
    ...(pick.model ? { model: pick.model, ...(pick.strict ? { modelStrict: true } : {}) } : {}),
    // Personality temperature — parity with the Worker/DO loop.
    ...(ctx.execParams.temperature != null ? { temperature: ctx.execParams.temperature } : {}),
    // Personality reasoning levers (thinkLevel/reasoningLevel) → the CORRECT vendor
    // param for THIS model family (Anthropic `thinking` / OpenAI `reasoning_effort`),
    // or nothing for a model that doesn't support one (reasoningCapability drops it).
    // Only on a STRICT pin: an unpinned model may cascade to a different vendor that
    // would reject the param, so we attach it solely when the resolved model is fixed.
    // First-turn detection: no assistant turn yet in this slice.
    ...(pick.strict
      ? reasoningParamsForModel(pick.model, ctx.execParams, {
          isFirstTurn: !args.messages.some((m) => (m as { role?: string }).role === 'assistant'),
        }) ?? {}
      : {}),
    useCase: 'task_execution',
  }, undefined, undefined, args.signal);
  // Shared post-`complete` processing (metering + telemetry) — identical to the
  // in-Worker loop, so a child's tokens are the tenant's tokens and a delegation that
  // quietly billed to nobody cannot happen.
  const turn = await recordCloudLlmTurn(result, {
    env, db, tenantId, cloudAgentRef, executionId, taskId, projectId,
    requestedModel: pick.model ?? model, fallbackModel: pick.model,
    effectivePlan: ctx.effectivePlan, premiumOverride: ctx.premiumOverride,
  }, { tGen0, notify: args.notify });
  if (!turn.ok) return { ok: false, error: turn.error };
  return { ok: true, content: turn.content, toolCalls: turn.toolCalls };
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
    engine: { imageRunTurn, runCloudToolLoop, finalizeCloudRun, buildCloudProvider },
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

export type RequiredReviewSignoff = { roleKey: string; laneKey?: string };

/** Accept evidence only for the exact accountability slot that caused this run. */
export function matchesRequiredReviewSignoff(
  required: RequiredReviewSignoff | undefined,
  toolName: string,
  args: Record<string, unknown>,
  succeeded: boolean,
): boolean {
  if (!required || !succeeded || toolName !== 'builtin_kanban_signoff') return false;
  const roleKey = typeof args.roleKey === 'string' ? args.roleKey.trim() : '';
  const laneKey = typeof args.laneKey === 'string' ? args.laneKey.trim() : undefined;
  return roleKey === required.roleKey && laneKey === required.laneKey;
}

export function missingReviewVerdictMessage(required: RequiredReviewSignoff): string {
  const lane = required.laneKey ? ` and laneKey='${required.laneKey}'` : '';
  return `Cannot finish this reviewer assignment until you call builtin_kanban_signoff with roleKey='${required.roleKey}'${lane} and an explicit approved or changes_requested verdict. A narrative summary is not acceptance evidence.`;
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
  /** Replay: pin repo reads to this ref rather than computing base→branch. */
  frozenReadRef?: string;
  principalId?: string;
  repositoryDelegationId?: string;
}): CapabilityProvider {
  const { env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths } = args;
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
    capabilities: args.capabilities,
    repoRead: {
      async listFiles(sub, glob) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:read'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
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
        if (!(await credentialAllowed('repository:read'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        const rf = await readRepoFile({ ...repoCtx, ref: readRef() }, path);
        if (rf.ok) await recordContextContribution(db, { tenantId, executionId, sourceKind: 'repository_file', sourceRef: `${repoCtx.owner}/${repoCtx.repo}:${path}`, trustTier: 'repository', content: rf.content });
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
        if (!edit.ok || edit.content == null) return { ok: false, error: `cannot edit '${path}': ${edit.error ?? 'old_string not found'}` };
        const updated = edit.content;
        const inspection = await inspectOutboundContent(db, { tenantId, executionId, seam: 'repository_write', target: path, content: updated });
        if (!inspection.ok) return { ok: false, error: `Outbound content blocked: ${inspection.reasons.join(', ')}. Remove credential material; never commit secrets.` };
        const firstWriteThisRun = !writtenPaths.has(path);
        const commit = await commitAgentFile(target, path, updated, agentCommitMessage(firstWriteThisRun ? 'Edit' : 'Update', path, taskRow.id, agentLabel));
        if (!commit.ok) return { ok: false, error: commit.reason };
        writtenPaths.add(path);
        await recordRepoWrite(db, tenantId, taskRow.id, target);
        await recordTaskFileChange(db, tenantId, taskRow.id, executionId, path, 'modified', agentLabel);
        notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change: 'modified', ts: new Date().toISOString() });
        return { ok: true, branch: target.branch, commitUrl: commit.commitUrl, change: 'modified', replaced: edit.replaced };
      },
      async deleteFile(path, reason) {
        if (!repoCtx) return { ok: false, error: noRepo() };
        if (!(await credentialAllowed('repository:write'))) return { ok: false, error: 'repository credential delegation is absent, expired, or revoked' };
        const suffix = reason && reason.trim() ? ` — ${reason.trim()}` : '';
        const target = (await repoFor(path)) ?? repoCtx;
        const del = await deleteAgentFile(target, path, agentCommitMessage('Remove', path, taskRow.id, agentLabel, suffix));
        if (del.ok) {
          writtenPaths.delete(path);
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
        return v.ok
          ? {
              ok: true, ran: true, kind: 'static-validation',
              checked: v.checked, skipped: v.skipped,
              note: `Static source/config validation PASSED for ${v.checked.length} changed file(s)`
                + `${v.skipped.length ? ` (${v.skipped.length} file(s) had no applicable shell-free policy)` : ''}. `
                + 'This executor has NO shell, so it did NOT run the build, project-wide type-check, lint, or tests — CI on the pull request verifies those. Do not claim those passed; ensure your code is correct.',
            }
          : {
              ok: false, ran: true, kind: 'static-validation',
              errors: v.errors,
              note: `Static validation FAILED on ${v.errors.length} file(s) — fix the parse error(s) below with write_file, then call run_checks again.`,
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
    // table is a routing detail of the scope, not a decision made here.
    memory: buildMemoryCapability({ db, env, tenantId, projectId, ticketId: taskRow.id, origin: 'cloud-run', executionId }),
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
  const surfaceCaps = CLOUD_SURFACE_CAPS;
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
  const cloudTools = [...CLOUD_AGENT_TOOLS, ...cloudAgentPlatformToolSchemas(opts?.originatingChatId)];
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
  const projectInferenceModel = requestedInferenceModel && modelSupportsTools(requestedInferenceModel)
    ? requestedInferenceModel
    : undefined;
  if (requestedInferenceModel && !projectInferenceModel) {
    console.warn(
      `[evermind] refusing to pin ${requestedInferenceModel} for a tool-driven agent run (no tool-calling); `
      + 'selecting from the coding pool instead',
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
  const proxy = llmProxyForPlan(env, routing.effectivePlan, routing.premiumOverride, { backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true, ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}), ...(openaiCodexAuth ? { openaiCodexAuth } : {}), ...(xaiOAuthToken ? { xaiOAuthToken } : {}), ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}), ...(loopCreds.vendorPriority.length ? { byoVendorPriority: loopCreds.vendorPriority } : {}), ...(loopCreds.alertedVendors?.length ? { byoAlertedVendors: loopCreds.alertedVendors } : {}), ...(loopCreds.providerPriorities?.length ? { byoProviderPriorities: loopCreds.providerPriorities } : {}), ...(loopCreds.openRouterConnections?.length ? { openRouterConnections: loopCreds.openRouterConnections } : {}), ...(loopCreds.openRouterModelKeys && Object.keys(loopCreds.openRouterModelKeys).length ? { openRouterModelKeys: loopCreds.openRouterModelKeys } : {}), ...(loopCreds.configuredProviders.length ? { byoRequired: true } : {}) });

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
  //
  // STRICT is load-bearing and stays: it bypasses chain composition entirely, which
  // is the only reason a project-Evermind pin survives for a BYO tenant (the composer
  // filters every non-connected vendor out of the chain, and `evermind` is nobody's
  // connected vendor). Now that the head can DECLINE a turn it isn't competent for,
  // the graceful fallback rides the per-turn cascade below instead.
  const pick = projectInferenceModel
    ? { model: projectInferenceModel, strict: true as const }
    : pickCloudModel(effectiveModel, routing.effectivePlan, routing.premiumOverride, {
        actionType: learned.actionType,
        actionStats: learned.actionStats,
        bias: opts?.routingBias,
        // Context-aware seed: don't pick a small-window model for a big first turn.
        estimatedTokens: estimateRequestTokens(messages, cloudTools),
        // A free tenant may pin a model their connected provider (BYO) serves.
        byoVendors: byoVendorIdsFromCredentials(loopCreds),
        // Tenant BYO precedence — lead with the owner's chosen account (e.g. Meta first).
        byoVendorPriority: loopCreds.vendorPriority,
        byoAlertedVendors: loopCreds.alertedVendors ?? [],
        isSuperadmin: routing.isSuperadmin,
        registeredOpenRouterModels: loopCreds.registeredOpenRouterModels,
        preferredRegisteredModel: loopCreds.preferredOpenRouterModel,
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
  const requiredSignoff = opts?.resume?.requiredSignoff ?? opts?.requiredSignoff;
  let reviewVerdictRecorded = opts?.resume?.reviewVerdictRecorded ?? false;

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
  const cancelChannel = startCancelWatcher(isCancelled);
  const abortController = cancelChannel.controller;

  // The surface's capability backing + the tool context handed to every dispatch.
  // The provider closes over the LIVE `writtenPaths` set + `repoCtx`, so write/delete
  // bookkeeping and the base→branch read switch stay correct as the run progresses.
  const builtProvider = buildCloudProvider({
    env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths,
    capabilities: surfaceCaps,
    principalId: runIdentity.principalId,
    ...(repositoryDelegationId ? { repositoryDelegationId } : {}),
    ...(opts?.frozenReadRef ? { frozenReadRef: opts.frozenReadRef } : {}),
  });
  // Rehearsal wraps the provider here (see CloudLoopOpts.decorateProvider). A live run
  // passes nothing and uses the provider as built.
  const decoratedProvider = opts?.decorateProvider ? opts.decorateProvider(builtProvider) : builtProvider;
  // Delegation (`orchestrate`). Attached AFTER decoration and built from the DECORATED
  // provider, so a rehearsal's shadow wrapper covers a child's tool calls too — a
  // sub-agent that wrote straight through the raw backing would be the one hole in a
  // dry run. The child loop itself lives in `cloudSubagent.ts`; all this supplies is
  // the surface's concretions (one metered model turn, the registry, the timeline).
  const provider: CapabilityProvider = {
    ...decoratedProvider,
    orchestration: buildOrchestrationCapability({
      parentCaps: surfaceCaps,
      provider: decoratedProvider,
      registry: cloudToolRegistry,
      signal: abortController.signal,
      complete: async ({ messages: childMessages, tools, step }) => {
        const tGen0 = Date.now();
        // The child rides the model the parent LOCKED onto, with no cascade of its
        // own: a delegation is a bounded side quest, so a model failure inside it ends
        // the child and is reported to the parent as a failed tool call rather than
        // spending the run's one pin-drop on a sub-task.
        const result = await proxy.complete(
          {
            messages: childMessages as unknown as ChatMessage[],
            tools,
            tool_choice: 'auto',
            ...(activeModel ? { model: activeModel } : {}),
            ...(genParams.temperature != null ? { temperature: genParams.temperature } : {}),
            useCase: 'task_execution',
          },
          undefined,
          undefined,
          abortController.signal,
        );
        // Metered and attributed exactly like a parent turn — a sub-agent's tokens are
        // the tenant's tokens, and a delegation that quietly billed to nobody would
        // make the per-execution cost figure wrong.
        const turn = await recordCloudLlmTurn(result, {
          env, db, tenantId, cloudAgentRef, executionId, taskId: taskRow.id, projectId,
          requestedModel: pick.model, fallbackModel: activeModel,
          effectivePlan: routing.effectivePlan, premiumOverride: routing.premiumOverride,
        }, { tGen0, step, notify: false });
        if (!turn.ok) return { failed: turn.error };
        return { content: turn.content, toolCalls: readOpenAiToolCalls({ tool_calls: turn.toolCalls }) };
      },
      record: async (event) => {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef, executionId,
          toolName: 'agent.subagent', category: 'tool', detail: event.detail, result: event.result,
        });
      },
    }),
  };
  const toolCtx: ToolContext = { caps: provider, signal: abortController.signal };

  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton (step budget, cancel poll, argument parsing, the
  // assistant/tool rows, the finish / ask_human control signals) lives ONCE in
  // `@builderforce/agent-loop` and is the same kernel the Brain, the canvas and the
  // on-prem runtime drive. Everything cloud-specific below is a hook or a port that
  // closes over this run's state — nothing here iterates.
  type Row = Record<string, unknown>;
  const codec = openAiChatCodec<Row>();
  const evt = { tenantId, cloudAgentRef, executionId };
  const dataOk = (data: unknown): boolean => !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false);
  // Per-call timer. Calls within a turn are dispatched sequentially, so one slot is exact.
  let tStart = 0;

  const hooks: LoopHooks<Row> = {
    // Between-step guard: stop before issuing the next (paid) call if cancelled.
    isCancelled: () => cancelChannel.check(),

    beforeTurn: async (ctx) => {
      if (declaredLimits) {
        const [spend] = await db.select({ total: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)` })
          .from(llmUsageLog)
          .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.executionId, executionId)));
        const limitReason = checkRunLimits(declaredLimits, {
          files: writtenPaths.size, repositories: repoCtx ? 1 : 0, spendMillicents: Number(spend?.total ?? 0),
        });
        if (limitReason) {
          await recordCloudToolEvent(db, { ...evt, toolName: 'containment.limit', category: 'tool', detail: { step: ctx.step, limits: declaredLimits }, result: limitReason });
          return { action: 'stop', ok: false, output: `Run contained: ${limitReason}.` };
        }
      }

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
      const compaction = await compactMessages(messages, CLOUD_COMPACT_DEFAULTS, buildGatewaySummarizer(env));
      if (compaction.compacted) {
        messages.length = 0;
        messages.push(...compaction.messages);
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'context.compacted', category: 'llm',
          detail: { step: ctx.step, beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens, summarized: compaction.summarized, droppedMessages: compaction.droppedMessages },
          result: `compressed ~${compaction.beforeTokens} → ~${compaction.afterTokens} tokens (${compaction.summarized ? 'builder-memory summary' : 'elided'})`,
        });
      }
      return undefined;
    },

    onNoToolCalls: async (_ctx, turn) => {
      if (requiredSignoff && !reviewVerdictRecorded) {
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
      return { action: 'finish' };
    },

    beforeDispatch: async (call) => {
      tStart = Date.now();
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
      const gate = evaluatePolicyGate(policyGates, name);
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

    onFinish: async (ctx, summary) => {
      // Four finish gates, in order. Either yields a block message that forces the
      // agent to call finish again once it has corrected the run; null = ship.
      // Validation is AUTOMATIC here: `run_checks` remains useful for an early
      // self-check, but forgetting to call it cannot bypass the quality policy.
      const prefinishVerification = repoCtx && writtenPaths.size > 0
        ? await verifyWrittenFiles({ ...repoCtx, ref: repoCtx.branch }, writtenPaths)
        : null;
      let finishBlock: string | null = null;
      if (requiredSignoff && !reviewVerdictRecorded) {
        finishBlock = missingReviewVerdictMessage(requiredSignoff);
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'finish.blocked', category: 'tool',
          detail: { reason: 'review_verdict_missing', ...requiredSignoff },
          result: finishBlock,
        });
      } else if (repoCtx && !noDeliverableBlocked && hasNoCodeDeliverable(writtenPaths)) {
        // (0) Completeness self-review (ROADMAP #38): a code-bound run is finishing
        // with NO code deliverable. Block ONCE and
        // make the agent self-review the requirements — implement what's missing, or
        // explicitly confirm no code change was required — before an empty finish is
        // honored. A legitimate no-op run finishes on the retry.
        noDeliverableBlocked = true;
        finishBlock =
          'Before finishing: you have not committed any code changes for this task — only the PRD (or nothing) is on the branch. Re-read the task requirements and verify EACH is actually implemented. If work remains, use search_code/read_file to find the right place and write_file to implement it, then finish. If — and only if — this task genuinely requires no code change, call finish again and state explicitly why no change was needed.';
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'finish.blocked', category: 'tool',
          detail: { reason: 'no_deliverable' },
          result: 'Blocked finish: no code deliverable — self-review required',
        });
      } else if (prefinishVerification && !prefinishVerification.ok) {
        // (1) Mandatory changed-source/config policy. Unlike the optional tool call,
        // this cannot be skipped by a model that rushes straight to `finish`.
        finishBlock =
          `Cannot finish — changed-file validation found ${prefinishVerification.errors.length} issue(s). `
          + 'Repair every issue, then finish again. This is a shell-free source policy, not a claim that the full project type-check ran.\n'
          + prefinishVerification.errors.map((e) =>
            `- ${e.path}${e.line ? `:${e.line}` : ''}${e.ruleId ? ` [${e.ruleId}]` : ''}: ${e.message}`,
          ).join('\n');
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'finish.blocked', category: 'tool',
          detail: { reason: 'source_quality', errors: prefinishVerification.errors },
          result: `Blocked finish: ${prefinishVerification.errors.length} source/config quality issue(s)`,
        });
      } else if (summary && !finishBlockedOnce && assertsUnrunVerification(summary)) {
        // (2) Honesty: the summary claims a check passed, but nothing was (or
        // could be) run. Block once and force an honest restatement.
        finishBlockedOnce = true;
        finishBlock =
          'You stated that a build/type-check/lint/test passed or is resolved, but this executor cannot run any of those — CI on the pull request verifies them. Call finish again with a summary that does NOT claim a check passed (describe what you changed and that CI will verify), or call run_checks first.';
      } else if (repoCtx && writtenPaths.size > 0 && placeholderBlocks < MAX_PLACEHOLDER_FINISH_BLOCKS) {
        // (3) Anti-stub: refuse to ship placeholder/scaffold code. Read the
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
            ...evt,
            toolName: 'finish.blocked', category: 'tool',
            detail: { reason: 'placeholders', files: scan.flagged },
            result: `Blocked finish: ${scan.flagged.map((f) => f.path).join(', ')}`,
          });
        }
      }
      if (!finishBlock && repoCtx && writtenPaths.size > 0) {
        const claim = await recordCodeCompletionClaim(db, {
          tenantId,
          executionId,
          statement: summary || ctx.output || `Completed changes to ${[...writtenPaths].join(', ')}`,
        });
        if (!claim.ok) {
          finishBlock = `Cannot finish — no structural evidence record supports this completion claim (${claim.error}). Retry the successful write or verification, then finish again.`;
        }
      }
      return finishBlock;
    },

    afterDispatch: async (call, result) => {
      const name = call.name;
      const parsed = call.args;
      const succeeded = dataOk(result.data);
      if (matchesRequiredReviewSignoff(requiredSignoff, name, parsed, succeeded)) {
        reviewVerdictRecorded = true;
      }
      await recordCloudToolEvent(db, {
        ...evt,
        toolName: name, category: 'tool', toolCallId: call.id,
        detail: name === 'write_file' ? { path: parsed.path, summary: parsed.summary } : parsed,
        result: JSON.stringify(result.data).slice(0, 300),
        durationMs: Date.now() - tStart,
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
      // there. Benefits every surface (durable / Worker / container). A fetch the
      // cancel watcher aborted mid-call throws here; the kernel reports it as
      // `cancelled` because the run's signal is the watcher's.
      for (let attempt = 0; ; attempt++) {
        result = await proxy.complete(
          {
            messages: requestMessages as unknown as ChatMessage[],
            tools: cloudTools,
            tool_choice: 'auto',
            ...(activeModel ? { model: activeModel, ...(strictPin ? { modelStrict: true } : {}) } : {}),
            // Sampling. Caller-configured `genParams` OUTRANK the personality-derived
            // temperature: an operator who set a temperature on the published model
            // meant that number, whereas the persona value is a derived default.
            ...(genParams.temperature ?? opts?.execParams?.temperature) != null
              ? { temperature: genParams.temperature ?? opts?.execParams?.temperature }
              : {},
            ...(genParams.topP != null ? { top_p: genParams.topP } : {}),
            ...(genParams.maxTokens != null ? { max_tokens: genParams.maxTokens } : {}),
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
        // Retry a pinned/locked model that the gateway rate-limited (429), that the
        // request overflowed (413 — context window too small), or that the gateway
        // reported unavailable (503 — cooled / provider outage), and only once. All
        // three need it because a pin gets NO in-proxy cascade: dropping the pin lets
        // the proxy walk its chain — to a bigger-window model, or (for a BYO tenant,
        // where the chain stays inside their own accounts) to another connected
        // provider — instead of hard-failing the run on ONE unavailable model.
        const retryStatus = result!.response.status;
        // A project-Evermind pin additionally cascades on 400. That is the status the
        // evermind vendor uses to DECLINE a turn it is not competent for — it ranked
        // its tool choice no better than the alternatives, or its prose failed the
        // coherence bar. Because the pin is strict (no in-proxy cascade), the run would
        // otherwise die on the tenant's own under-trained head; dropping the pin here
        // reproduces the graceful outcome the old blanket tool-capability gate gave by
        // never pinning it at all. Scoped to `evermind/` so a genuine malformed-request
        // 400 on a frontier model still fails fast instead of burning a second attempt.
        const evermindDeclined = retryStatus === 400 && activeModel.startsWith('evermind/');
        const retryable = retryStatus === 429 || retryStatus === 413 || retryStatus === 503 || evermindDeclined;
        if (!retryable || attempt >= 1 || (!strictPin && !activeModel)) break;
        await recordCloudToolEvent(db, {
          ...evt,
          toolName: 'model.cascade', category: 'llm',
          detail: { step: ctx.step, from: activeModel || null, reason: String(retryStatus) },
          result: retryStatus === 413
            ? 'pinned model context window too small — dropping pin, walking the cascade to a bigger-window model'
            : retryStatus === 503
              ? 'pinned model unavailable (cooldown / provider outage) — dropping pin, walking the cascade'
              : evermindDeclined
                ? 'project Evermind declined this turn (low tool-choice confidence or incoherent output) — dropping pin, walking the cascade'
                : 'pinned model rate-limited — dropping pin, walking the cascade',
        });
        // Unlock for this turn AND the rest of the run: don't re-pin after a cascade.
        strictPin = false;
        activeModel = '';
      }
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
      }, { tGen0, step: ctx.step, notify: false });
      if (!turn.ok) return { failed: turn.error };
      return { content: turn.content, toolCalls: readOpenAiToolCalls({ tool_calls: turn.toolCalls }) };
    },

    dispatch: async (call) => {
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
            role: TenantRole.MANAGER,
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

  let loop: LoopResult;
  try {
    loop = await runAgentLoop<Row>({
      messages, codec, ports, hooks,
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
    pinnedModel: activeModel,
    routing,
    repoCtx,
    repoMiss,
    noDeliverableBlocked,
    reviewVerdictRecorded,
    requiredSignoff,
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
  if (requiredSignoff && !reviewVerdictRecorded) {
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

  const fin = await finalizeCloudRun(env, db, {
    tenantId, cloudAgentRef, executionId, taskRow, agentLabel,
    repoCtx, repoMiss, writtenPaths, finalOutput, cancelled,
  });
  return { ok: fin.ok, output: fin.output, cancelled, finished: true };
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
        ...(rc.originatingChatId != null ? { originatingChatId: rc.originatingChatId } : {}),
        ...(rc.requiredSignoff ? { requiredSignoff: rc.requiredSignoff } : {}),
        ...(directive ? { dynamicSystem: directive } : {}),
        ...(input.policy?.gates ? { policyGates: [...input.policy.gates] } : {}),
        ...(rc.execParams ? { execParams: rc.execParams } : {}),
        ...(input.genParams ? { genParams: { ...input.genParams } } : {}),
        ...(input.resume ? { resume: input.resume as CloudLoopState } : {}),
        ...(surface.kind === 'durable' ? { maxSteps: surface.maxSteps, deferFinalize: true } : {}),
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
  // Atomic single-PR claim (0140): take it BEFORE the external create so this inline
  // run-end finalize can't open a duplicate PR alongside a concurrent human Done-drag
  // (which finalizes via openTaskPullRequest, taking the same claim). Lost claim =>
  // another path is opening the PR; skip the create here and treat it as "PR exists".
  const claimedInlinePr = repoCtx && writtenPaths.size > 0 && !cancelled
    ? await claimTaskPrOpen(db, tenantId, taskRow.id).catch(() => false)
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
    if (!pr.ok) {
      noPrReason = pr.reason;
      await releaseTaskPrClaim(db, tenantId, taskRow.id).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] failed PR-claim release failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
    }

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

> ⚠ **Not verified in-agent.** CI on this PR is the source of truth.`,
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
  // see — a silence is otherwise indistinguishable from a run that had nothing to say.
  if (runEarnedReflection({ merged, prOpened, producedChanges: writtenPaths.size > 0 })) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'skill.reflection', category: 'lifecycle',
      detail: { merged, prOpened, producedChanges: writtenPaths.size > 0 },
      result: 'run cleared the reflection bar',
    }).catch((error) => reportCaughtError(error, {
      source: 'application/runtime/cloudAgentEngine.ts',
      operation: 'finalizeCloudRun',
      level: 'warning',
      context: { logMessage: '[cloud-finalize] reflection-bar telemetry failed (the run is unaffected)', details: { tenantId, executionId, error } },
    }));
  }

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
  const surfaceCaps = opts?.shell ? CONTAINER_SURFACE_CAPS : CLOUD_SURFACE_CAPS;
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
    loadCapabilityContext(env, db, artifacts, agentPsychometric),
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

  // The tool loop runs against a real repository. The verification sentence differs
  // by executor: the durable surface has NO shell (CI verifies), the Container
  // surface has a REAL shell (run_command) so the agent verifies before finishing.
  const shellLine = opts?.shell
    ? 'Call git_sync_latest FIRST, before editing: your branch may have been created earlier and fallen behind the base branch, so working without syncing builds on stale code and your PR could revert newer work. ' +
      'You also have git_status / git_diff / git_history to inspect the repo, and git_undo / git_redo to back out or reapply a commit. ' +
      'You HAVE a real shell: use run_command to install dependencies and run the project build, type-check, lint, and tests in the checked-out repo BEFORE you finish. Fix anything that fails. Only claim a check passed if you actually ran it and saw it pass; CI on the PR re-verifies. ' +
      // A human's explicit "merge/push to main" is their call: this surface has the clone
      // and the push credential, so it does exactly that instead of substituting a PR.
      "Your work normally ships as a pull request when you finish. If the human's directive EXPLICITLY asks you to merge into or push to the base branch (main), do exactly that with run_command — `git fetch origin`, merge your branch into the base branch, `git push origin <base>` — and report the resulting commit hash; do not substitute a pull request for an explicit instruction."
    : 'You CANNOT run builds, type-checks, lint, or tests here — this executor has no shell. Those run in CI on the pull request your changes open, and that CI is the source of truth. There is NO run_code/run_command tool; if you want to acknowledge verification, call run_checks. NEVER state that a check passed, succeeded, is clean, or is resolved — you cannot run one. Write correct, complete code and finish with an honest summary. If asked to merge or push to the base branch, say plainly that this executor cannot push it: your work ships as the pull request the human merges.';

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
      body: 'You are a BuilderForce agent executing a project task against a real repository. Follow the PRD, architecture spec, and project rules exactly. ' +
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
        // The PRD is handed to the run as context and is now WRITABLE. Without this line
        // the tool is advertised and never reached: a model told to "follow the PRD"
        // does not infer that it may also correct one.
        'The PRD above is the ticket\'s SHARED spec and you can write to it with `update_prd`: use mode "append" to record a decision you made, a constraint you discovered, or work you deliberately left out of scope, so the next run on this ticket does not re-derive or repeat it; use mode "section" ONLY to correct a section that is genuinely WRONG (it replaces that section\'s whole body). Do not use it to narrate progress — that is what your summary and `builtin_tasks_update` are for. ' +
        'If no repository is bound, return the complete deliverable in your final summary instead. Make explicit, reasonable assumptions where specifics are unknown.',
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
      kind: 'capabilities', subject: `workspace-skills:${executionId}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.capabilities, trustTier: 'tenant', pinned: true,
      body: renderSkillBlock(workspaceSkills),
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

