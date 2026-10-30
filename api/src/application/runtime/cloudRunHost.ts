/**
 * cloudRunHost — everything the cloud resolves ONCE for a run before the one agent starts
 * (PRD 35 WS3): the ticket's repo, the tenant's plan routing and connected accounts, the
 * run's model pick, its identity and delegated credentials, its declared limits, the
 * capability provider and the cost session. The result is the {@link CloudRunHost} the
 * adapter turns into ports. Nothing here runs a turn or decides what a turn means.
 *
 * Moved out of `cloudAgentEngine.ts` (`runCloudToolLoop`'s setup half): the model-pick seed
 * (learned routing, Evermind, BYO precedence) stays HOST work — what is available to this
 * tenant is a fact about the surface — while the hand-off that follows the pick is the
 * agent's (`policy/model`).
 */
import { and, eq } from 'drizzle-orm';
import type { ModelFallbackSurface } from '@builderforce/agent-stall';
import type { ToolSchema, CapabilityProvider } from '@builderforce/agent-tools';
import type { DifficultyFeatures } from '@builderforce/difficulty-router';
import type { TierLadder } from '@builderforce/run-policy';
import type { ActionType } from '@builderforce/learned-routing';
import { executionLimits, executions } from '../../infrastructure/database/schema';
import { getLatestBlueprint } from '../blueprint/blueprintDetection';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { resolveTicketRepoContext, type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { resolveRepoRefSha } from '../repos/commitFileToRepo';
import { ensureAgentRunIdentity, delegateCredential } from '../agentIdentity/agentRunIdentity';
import { codingFallbackSurface } from '../llm/codingFallbackSurface';
import { pricesForCall } from '../llm/catalogView';
import { cloudAgentPlatformToolSchemas } from '../llm/builtinMcpService';
import { byoVendorIdsFromCredentials, resolveTenantLlmCredentials } from '../llm/tenantProviderKeyService';
import { strictWhenConnected } from '../llm/fundingOrder';
import { byoRoutingOptions } from '../llm/tenantProxy';
import { resolveEvermindCodingRoute } from '../llm/evermindCodingEvalStore';
import { modelSupportsTools } from '../llm/vendors';
import { resolveTenantModel } from '../llm/tenantModelService';
import {
  CODING_BACKSTOP_MODELS, estimateRequestTokens, llmProxyForPlan, pickCloudModel, type LlmProxyService,
} from '../llm/LlmProxyService';
import { buildLiveOrchestration } from './cloudLiveOrchestration';
import { resolveAgentPersonaBrief } from '../agent/agentPersonaBrief';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { AGENT_DEFAULT_MODEL_SENTINEL } from './cloudAgent/agent';
import {
  emitModelSelection, hasVendorKeys, refuseCloudRunWithoutByo, requestedModelForRole, resolveCloudRouting,
  resolveLearnedRoutingInputs, cloudRunRoleForModelPin, type CloudRouting,
} from './cloudAgent/routing';
import { cloudRunRole } from './cloudAgent/cloudRunModelPolicy';
import { composeRunProvider } from './cloudAgent/runProvider';
import { seedWrittenHashes, type WrittenFileHashes } from './cloudAgent/writtenFileHashes';
import { heartbeatExecution } from './cloudAgent/runContext';
import { durableRunCaps } from './cloudAgent/runSurfaceCaps';
import { cloudAgentToolsFor } from './cloudAgentTools';
import { startCancelWatcher, type CooperativeCancel } from './cloudLoopControl';
import { recordCloudToolEvent } from './cloudToolEvents';
import { buildCloudProvider } from './cloudProvider';
import { meterExecutionIdOf } from './cloudRunDelegation';
import { openCostLoopSession, type CostLoopSession } from './costLoop/costLoopSession';
import { cloudRoutingExploration } from './costLoop/runLevers';
import { cloudTierLadder } from './costLoop/cloudTierLadder';
import type { RunSandbox } from './sandbox/runSandbox';
import type { VerifyShell } from '@builderforce/agent-run';
import type { CloudEngineContext } from './cloudAgentEngine';
import type { CloudLoopOpts, CloudLoopResult } from './cloudRunOpts';
import type { CloudLoopState } from './cloudRunState';
import type { CloudRunRefs } from './cloudAdapterPorts';

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

/** What the adapter needs to run the cloud through the one agent. */
export interface CloudRunHost {
  env: Env;
  db: Db;
  refs: CloudRunRefs;
  taskRow: { id: number; title: string; description: string | null };
  /** Where this run's tokens bill — a child's are its parent's. */
  meterExecutionId: number;
  systemPrompt: string;
  userContent: string;
  opts: CloudLoopOpts;
  repoCtx: TicketRepoContext | null;
  repoMiss: string;
  routing: CloudRouting;
  /** The live set of paths the run has written (the provider and the finish gates share it). */
  writtenPaths: Set<string>;
  /** The content hash of each written file as the run left it; persisted so run-end facts stay anchored across ticks. */
  writtenHashes: WrittenFileHashes;
  provider: CapabilityProvider;
  /** The sandbox and its shell, when the run has one. */
  verify?: { sandbox: RunSandbox; shell: VerifyShell };
  cost: CostLoopSession;
  declaredLimits: { maxFiles: number | null; maxRepositories: number | null; maxSpendMillicents: number | null } | undefined;
  proxy: LlmProxyService;
  /** The run-start pick: a hard pin when `strict`, else the plan's soft seed. */
  pick: { model: string; strict: boolean };
  runRole: string;
  verifyPin: string | undefined;
  fallbackSurface: ModelFallbackSurface | null;
  ladder: TierLadder;
  features: (turnIndex: number, messages?: readonly unknown[]) => DifficultyFeatures;
  genParams: { temperature?: number; topP?: number; maxTokens?: number };
  cancel: CooperativeCancel;
}

export type OpenedCloudRun = { host: CloudRunHost } | { stopped: CloudLoopResult };

/**
 * Resolve everything the run needs. A run the platform halted, or one whose workspace
 * connected accounts none of which resolved, stops here with the named reason — never
 * composes a chain that would spend from the operator pool.
 */
export async function openCloudRunHost(
  rc: CloudEngineContext,
  input: { model: string | undefined; systemPrompt: string; userContent: string },
  opts: CloudLoopOpts,
): Promise<OpenedCloudRun> {
  const { env, db, executionId, tenantId, taskRow, cloudAgentRef, agentLabel, projectId } = rc;
  if (env.AGENT_EXECUTION_ENABLED?.trim().toLowerCase() === 'false') {
    return { stopped: { ok: false, output: 'Agent execution is halted by the platform operator.', cancelled: true, finished: true } };
  }
  const resume: CloudLoopState | undefined = opts.resume;
  // Resolve the ticket repo ONCE per run. On the durable surface the first tick resolves it and every
  // later tick reuses the persisted context — so the finalize tick can always open the PR for files
  // earlier ticks committed, and the git credential is not re-decrypted on every alarm tick.
  let repoCtx: TicketRepoContext | null;
  let repoMiss: string;
  if (resume && 'repoCtx' in resume) {
    repoCtx = resume.repoCtx ?? null;
    repoMiss = resume.repoMiss ?? '';
  } else {
    const repoResolved = await resolveTicketRepoContext(db, integrationCredentialSecret(env), tenantId, taskRow.id);
    repoCtx = repoResolved.ok ? repoResolved.ctx : null;
    repoMiss = repoResolved.ok ? '' : repoResolved.reason;
  }
  const writtenPaths = new Set<string>(resume?.run?.writtenPaths ?? resume?.writtenPaths ?? []);
  const writtenHashes = seedWrittenHashes(resume?.writtenHashes);
  if (repoCtx && !resume) await stampExecutionSourceRef(db, tenantId, executionId, repoCtx);

  // Tenant "LLM" (migration 0211): a `tenant_model:<slug>` ref expands to its configured base model + system
  // directives so THIS run honours the tenant's model config on every surface. Its sampling params fill what
  // the caller did not set, exactly as the gateway route does.
  const tenantModel = await resolveTenantModel(env, db, tenantId, input.model);
  let effectiveModel = tenantModel ? (tenantModel.baseModel ?? undefined) : input.model;
  const genParams: { temperature?: number; topP?: number; maxTokens?: number } = {
    ...(typeof tenantModel?.params.temperature === 'number' ? { temperature: tenantModel.params.temperature } : {}),
    ...(typeof tenantModel?.params.top_p === 'number' ? { topP: tenantModel.params.top_p as number } : {}),
    ...(opts.genParams ?? {}),
  };
  const surfaceCaps = durableRunCaps(env, tenantId, opts.delegation, repoCtx, !!opts.sandbox);
  const meterExecutionId = meterExecutionIdOf(executionId, opts.delegation);
  const runIdentity = await ensureAgentRunIdentity(db, {
    tenantId, executionId, agentRef: cloudAgentRef, issuedBy: `execution:${executionId}`, capabilities: [...surfaceCaps],
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
    maxFiles: executionLimits.maxFiles, maxRepositories: executionLimits.maxRepositories, maxSpendMillicents: executionLimits.maxSpendMillicents,
  }).from(executionLimits).where(and(eq(executionLimits.tenantId, tenantId), eq(executionLimits.executionId, executionId))).limit(1);
  // The core tools the registry derives from the provider's capabilities, plus the curated platform tools.
  const cloudTools: ToolSchema[] = [...cloudAgentToolsFor(surfaceCaps), ...cloudAgentPlatformToolSchemas(opts.originatingChatId)];
  const systemPrompt = tenantModel?.directives ? `${tenantModel.directives}\n\n${input.systemPrompt}` : input.systemPrompt;

  // Project Evermind consumer: a concrete `evermind/<ref>` run model is a direct vendor route that must clear
  // the coding-quality gate and tool-calling before it may hard-pin; otherwise the normal coding selection runs.
  const requestedInferenceModel = typeof effectiveModel === 'string' && effectiveModel.startsWith('evermind/') ? effectiveModel : undefined;
  const evermindCoding = requestedInferenceModel ? await resolveEvermindCodingRoute(env, db, tenantId, requestedInferenceModel) : undefined;
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

  // The tenant's plan routing, resolved once and persisted so DO ticks don't re-query the plan.
  const routing = resume?.routing ?? await resolveCloudRouting(env, tenantId);
  // A connected subscription powers direct-vendor turns; BYO api-keys override the operator keys for their
  // vendors. Re-resolved fresh each tick so a rotated token stays valid.
  const loopCreds = await resolveTenantLlmCredentials(env, tenantId);
  // Fail-closed BYO (GAP-B4): a workspace that CONNECTED providers declared "run on my account".
  const byoBlocked = await refuseCloudRunWithoutByo(db, { tenantId, cloudAgentRef, executionId }, loopCreds);
  if (byoBlocked) return { stopped: { ok: false, output: byoBlocked.message, cancelled: false, finished: true } };
  const { anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, vendorKeys: tenantVendorKeys } = loopCreds;
  const proxy = llmProxyForPlan(env, routing.effectivePlan, routing.premiumOverride, {
    backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true,
    ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}), ...(openaiCodexAuth ? { openaiCodexAuth } : {}), ...(xaiOAuthToken ? { xaiOAuthToken } : {}),
    ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}), ...byoRoutingOptions(loopCreds),
    ...strictWhenConnected(loopCreds.configuredProviders.length > 0),
  });

  // Learned Model Routing (PRD 13): on the FIRST tick resolve the task's action type + the empirically-best models for it.
  const learned = resume ? { actionType: 'other' as ActionType, actionStats: undefined } : await resolveLearnedRoutingInputs(env, db, { tenantId, projectId, taskRow });
  const roleForPin = cloudRunRoleForModelPin({ spawnRole: opts.delegation?.spec?.role, deliveryRole: opts.requiredSignoff?.roleKey });
  const requested = requestedModelForRole(env, roleForPin, effectiveModel);
  const runRole = cloudRunRole(opts.delegation?.spec?.role);
  const opening = [{ role: 'system', content: systemPrompt }, { role: 'user', content: input.userContent }];
  const pick = projectInferenceModel
    ? { model: projectInferenceModel, strict: true as const }
    : pickCloudModel(requested, routing.effectivePlan, routing.premiumOverride, {
      ...(evermindCoding ? { evermindCoding } : {}),
      actionType: learned.actionType,
      actionStats: learned.actionStats,
      bias: opts.routingBias,
      role: runRole,
      arcStage: opts.arcStage,
      prices: await pricesForCall(env, runRole, opts.arcStage), explore: cloudRoutingExploration(env, tenantId),
      estimatedTokens: estimateRequestTokens(opening as never, cloudTools),
      byoVendors: byoVendorIdsFromCredentials(loopCreds),
      byoVendorPriority: loopCreds.vendorPriority,
      byoAlertedVendors: loopCreds.alertedVendors ?? [],
      isSuperadmin: routing.isSuperadmin,
      registeredModels: loopCreds.registeredModels,
      preferredRegisteredModel: loopCreds.preferredOpenRouterModel,
      byoSelectedModels: loopCreds.byoSelectedModels,
      premiumEntitled: routing.premiumEntitled,
    });
  const byoVendors = byoVendorIdsFromCredentials(loopCreds);
  const ladder = cloudTierLadder(byoVendors, routing.effectivePlan, routing.premiumOverride, loopCreds.configuredProviders.length > 0);
  // Make the model choice legible on the timeline — once, at run start. Best-effort.
  if (!resume) {
    await emitModelSelection(db, { tenantId, cloudAgentRef, executionId, requested, pick, plan: routing.effectivePlan, premium: routing.premiumOverride, actionType: learned.actionType });
  }

  const cost = await openCostLoopSession({
    env, db, tenantId, executionId, taskId: taskRow.id, meterExecutionId, plan: routing.effectivePlan, role: runRole,
    ...(resume ? { resume } : {}),
    record: (toolName, category, detail, result) => recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName, category, detail, result }),
  });

  // Hard cancel: a background watcher aborts the in-flight gateway fetch the instant it sees CANCELLED.
  const cancel = startCancelWatcher(rc.isCancelled);
  const blueprint = await getLatestBlueprint(env, projectId).catch((error) => {
    reportCaughtError(error, { source: 'application/runtime/cloudRunHost.ts', operation: 'getLatestBlueprint', context: { logMessage: '[cloud-run] failed to load blueprint', projectId } });
    return null;
  });
  const built = buildCloudProvider({
    env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths, writtenHashes,
    capabilities: surfaceCaps,
    principalId: runIdentity.principalId,
    ...(repositoryDelegationId ? { repositoryDelegationId } : {}),
    ...(opts.frozenReadRef ? { frozenReadRef: opts.frozenReadRef } : {}),
    blueprint,
  });
  // IDE workspace (repo-less project) → sandbox (shell + clone) → rehearsal decoration (`decorateProvider`; a live run passes none).
  const composed = await composeRunProvider({
    env, db, built, repoCtx,
    run: { tenantId, taskId: taskRow.id, executionId, agentLabel, ...(cloudAgentRef ? { cloudAgentRef } : {}), writtenPaths, writtenHashes },
    ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
    signal: cancel.controller.signal,
    heartbeat: () => heartbeatExecution(db, executionId),
    ...(opts.decorateProvider ? { decorate: opts.decorateProvider } : {}),
  });
  // Delegation. A child is its OWN durable run — a run with no place in a tree (a rehearsal) gets no spawner.
  const provider: CapabilityProvider = {
    ...composed.provider,
    ...(opts.delegation ? {
      orchestration: buildLiveOrchestration({
        env, db, runtime: opts.delegation.runtime, parent: opts.delegation.parent,
        // Delegating AS one of the workspace's agents — the ONE persona compiler.
        personaBrief: (agent) => resolveAgentPersonaBrief(env, tenantId, agent),
        heartbeat: () => heartbeatExecution(db, executionId),
      }),
    } : {}),
  };

  const refs: CloudRunRefs = { tenantId, projectId, taskId: taskRow.id, executionId, ...(cloudAgentRef ? { cloudAgentRef } : {}), agentLabel };
  const promptTokens = estimateRequestTokens(opening as never, cloudTools);
  return {
    host: {
      env, db, refs, taskRow, meterExecutionId,
      systemPrompt, userContent: input.userContent, opts,
      repoCtx, repoMiss, routing, writtenPaths, writtenHashes, provider,
      ...(composed.verify ? { verify: composed.verify } : {}),
      cost, declaredLimits, proxy,
      pick: { model: pick.model, strict: pick.strict === true },
      runRole,
      verifyPin: requestedModelForRole(env, 'verify'),
      fallbackSurface: codingFallbackSurface(byoVendors, routing.effectivePlan, routing.premiumOverride),
      ladder,
      features: (turnIndex, messages) => ({ actionType: learned.actionType, role: runRole, promptTokens: messages && messages.length > 0 ? estimateRequestTokens(messages as never, cloudTools) : promptTokens, toolCount: cloudTools.length, turnIndex }),
      genParams, cancel,
    },
  };
}

