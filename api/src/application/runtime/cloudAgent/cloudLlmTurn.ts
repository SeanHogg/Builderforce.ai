/**
 * ONE metered cloud LLM turn — the half of a cloud run that talks to the gateway and
 * accounts for it, shared by the durable loop (`runCloudToolLoop`) and the image
 * surfaces' `llm` op.
 *
 * Split out of `cloudAgentEngine.ts` (see `agent.ts` for why that file is being broken
 * up) together with the model hand-off policy it now drives (`cloudRunModelPolicy.ts`):
 * metering (`recordCloudUsage`), parsing (`parseLlmChoice`), the post-complete
 * telemetry (`recordCloudLlmTurn`) and the image surfaces' whole turn (`imageRunTurn`).
 * The engine re-exports the public names so every existing importer keeps working.
 */
import { splitVendorReasoning, type ChoiceMessageLike } from '@builderforce/agent-loop';
import type { ModelFallbackSurface } from '@builderforce/agent-stall';
import type { AgentExecParams, ModelRole, ToolSchema } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { pricesForCall } from '../../llm/catalogView';
import { codingFallbackSurface } from '../../llm/codingFallbackSurface';
import { resolveEvermindCodingRoute } from '../../llm/evermindCodingEvalStore';
import {
  CODING_BACKSTOP_MODELS, estimateRequestTokens, isPremiumModelSelection, llmProxyForPlan, pickCloudModel,
  type ChatMessage,
} from '../../llm/LlmProxyService';
import { reasoningParamsForModel } from '../../llm/reasoningCapability';
import { byoRoutingOptions } from '../../llm/tenantProxy';
import { byoVendorIdsFromCredentials, resolveTenantLlmCredentials } from '../../llm/tenantProviderKeyService';
import { logTrace } from '../../llm/traceLogger';
import { clampTokenCount, normalizeByoProvider, recordUsageRow } from '../../llm/usageLedger';
import type { RawToolCall } from '../cloudAgentTools';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { notifyExecutionSubscribers } from '../executionEvents';
import {
  cloudRunRole, completeUnderRunPolicy, initialCloudRunModelState, recordModelCascade, turnRequestFields,
  type CloudRunModelState,
} from './cloudRunModelPolicy';
import { emitCodingModelDegraded, hasVendorKeys, refuseCloudRunWithoutByo, requestedModelForRole } from './routing';
import type { ContainerRunContext } from './runContext';
import { cloudOutputCap, cloudReasoningExecParams, cloudRoutingExploration } from '../costLoop/runLevers';
import { cloudTierLadder } from '../costLoop/verifierCascade';
import type { CascadeVerdict } from '@builderforce/run-policy';
import { ImageCascade, imageTurnFeatures } from './imageCascade';
import { strictWhenConnected } from '../../llm/fundingOrder';
import type { LlmUsage } from '../../llm/proxyTypes';
import {
  CONTEXT_CATEGORIES_KEY, contextCategoryTokens, type ContextCategoryTokens, type TurnInput,
} from '../../costMetrics/contextCategories';

export async function recordCloudUsage(
  env: Env,
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number; taskId: number;
    projectId?: number | null; model: string; inputTokens: number; outputTokens: number;
    /** Provider-reported prompt-cache tiers (subsets of `inputTokens`). Dropping them
     *  priced every cloud turn as fully uncached — the 0.1× read / 1.25× write
     *  multipliers never applied. Absent = the upstream reported no cache split. */
    cacheReadTokens?: number; cacheCreationTokens?: number;
    /** Provider-reported reasoning tokens (subset of `outputTokens`); absent = no split. */
    reasoningTokens?: number;
    /** 1-based turn in the run's loop, and the ESTIMATED tool-schema / per-category
     *  input tokens of that turn (A1 telemetry). */
    turnIndex?: number | null;
    toolSchemaTokens?: number | null;
    context?: ContextCategoryTokens | null;
    byo?: boolean; byoProvider?: string | null;
    /** What kind of call this turn was — the parent loop's own turn is `code`, a
     *  `spawn_agent` child carries its delegation role. Stamped onto the usage row. */
    role?: string | null;
    /** Run phase this turn was billed under — a verify pass is its own ledger line. */
    phase?: string | null;
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
  // billing ledger — same shared clamp recordUsageRow uses. This row is the ONLY per-turn
  // usage write: the run trace (`readCloudRunUsage`) reads it back by execution id, so a
  // second `usage_snapshots` copy of the same tokens would only be 100+ MB of duplicates.
  const inputTokens = clampTokenCount(args.inputTokens);
  const outputTokens = clampTokenCount(args.outputTokens);
  const usage: LlmUsage = {
    promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens,
    ...(args.cacheReadTokens     != null ? { cacheReadTokens:     args.cacheReadTokens }     : {}),
    ...(args.cacheCreationTokens != null ? { cacheCreationTokens: args.cacheCreationTokens } : {}),
    ...(args.reasoningTokens     != null ? { reasoningTokens:     args.reasoningTokens }     : {}),
  };
  await recordUsageRow(db, env, {
    tenantId:   args.tenantId,
    userId:     null,
    llmProduct: 'builderforceLLM',
    model:      args.model,
    usage,
    metadata:   {
      engine: 'cloud', executionId: args.executionId, taskId: args.taskId, projectId: args.projectId ?? null, phase: args.phase ?? null,
      ...(args.context ? { [CONTEXT_CATEGORIES_KEY]: args.context } : {}),
    },
    turnIndex:        args.turnIndex ?? null,
    toolSchemaTokens: args.toolSchemaTokens ?? null,
    useCase:    'task_execution',
    // Attribute the spend to the run's cloud agent + ticket + project so cost
    // rolls up ticket → project → account (0104 / 0103).
    attribution: { cloudAgentRef: args.cloudAgentRef ?? null, executionId: args.executionId, taskId: args.taskId, projectId: args.projectId ?? null, role: args.role ?? null },
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
  /** What kind of call this turn was, for the usage row (see {@link recordCloudUsage}). */
  role?: ModelRole;
  /** Policy phase of this turn, stamped on the usage row so verify is its own line. */
  phase?: string | null;
  /** What this turn SENT (messages + advertised tools), for the A1 per-turn telemetry:
   *  tool-schema tokens and the context-by-category split are estimated from it here,
   *  once, for both loops. Absent ⇒ those fields are recorded as not measured. */
  turnInput?: TurnInput;
  /** The loop's own tool-schema token figure, when it already computed one — wins
   *  over the estimate from `turnInput.tools`. */
  toolSchemaTokens?: number | null;
}

/** The A1 per-turn measurements derived from what a turn sent. */
function turnTelemetry(rc: Pick<CloudLlmTurnCtx, 'turnInput' | 'toolSchemaTokens'>): { toolSchemaTokens: number | null; context: ContextCategoryTokens | null } {
  const context = rc.turnInput ? contextCategoryTokens(rc.turnInput) : null;
  const tools = rc.toolSchemaTokens ?? context?.tools ?? null;
  return { toolSchemaTokens: tools, context: context && tools != null ? { ...context, tools } : context };
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
export async function recordCloudLlmTurn(
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
      ...(rc.role ? { role: rc.role } : {}),
      ...(rc.phase ? { phase: rc.phase } : {}),
      ...(rc.effectivePlan ? { effectivePlan: rc.effectivePlan, premiumOverride: rc.premiumOverride ?? false } : {}),
      inputTokens: result.usage.promptTokens ?? 0, outputTokens: result.usage.completionTokens ?? 0,
      // Provider-reported cache + reasoning tiers ride through untouched (defect 1).
      ...(result.usage.cacheReadTokens     != null ? { cacheReadTokens:     result.usage.cacheReadTokens }     : {}),
      ...(result.usage.cacheCreationTokens != null ? { cacheCreationTokens: result.usage.cacheCreationTokens } : {}),
      ...(result.usage.reasoningTokens     != null ? { reasoningTokens:     result.usage.reasoningTokens }     : {}),
      // The kernel's `step` is 0-based; the ledger column is the 1-based turn number.
      turnIndex: opts.step != null ? opts.step + 1 : null,
      ...turnTelemetry(rc),
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
 * The `llm` op that advances an image's loop goes through here, on the same metering
 * and the same model hand-off policy as the durable loop: the first turn seeds the
 * run's policy from the run-start pick, every later turn asks for what the policy says
 * (the caller carries the state between ops — `containerRunModelStore`). A delegated
 * child is its own durable run, so it never reaches this function.
 *
 * Everything genuinely per-caller stays outside: the steering drain, history
 * compaction and the stall step belong to the `llm` op.
 */
export async function imageRunTurn(
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
    /** What kind of call this turn is — 'code' for the parent's own turn, or a
     *  delegation role. Absent `model` + a non-code role lets the BYO soft seed
     *  re-resolve tier-ranked toward that role's objective. */
    role?: ModelRole;
    /** The run's model hand-off state from its previous turn; absent on the first
     *  turn, when it is seeded from the run-start pick. */
    modelState?: CloudRunModelState;
    /** D1: the image's post-edit verdict on the previous turn (`readImageCheckVerdict`).
     *  Absent ⇒ the image runs no verifier and the cascade stays off for it. */
    checks?: CascadeVerdict | null;
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
): Promise<
  | { ok: true; content: string; toolCalls: unknown[]; resolvedModel: string; modelState: CloudRunModelState; fallbackSurface: ModelFallbackSurface }
  | { ok: false; error: string; code?: string; modelState?: CloudRunModelState }
> {
  const { env, db, ctx, executionId, tenantId, projectId, taskId, cloudAgentRef, model, role } = run;
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
  const byoVendors = byoVendorIdsFromCredentials(creds);
  // D1: the weak-first cascade, when the lever is on and the image has a verifier. A
  // later turn first folds the image's verdict on the previous one (one tier up on a fail).
  const turnRole = cloudRunRole(role);
  const cascade = await ImageCascade.open({
    env, db, tenantId, executionId, cloudAgentRef, role: turnRole,
    ladder: cloudTierLadder(byoVendors, ctx.effectivePlan, ctx.premiumOverride, creds.configuredProviders.length > 0),
    features: imageTurnFeatures(ctx, args.messages, args.tools, turnRole),
  }, run.checks);
  let modelState = run.modelState;
  if (modelState && cascade) modelState = await cascade.fold(modelState);
  // The run-start pick seeds the run's model policy on its FIRST turn only; every later
  // turn asks for what the policy says (the locked model, or the cascade after a
  // release) — the same rules as the durable loop, instead of a fresh soft seed per op.
  if (!modelState) {
    // Evermind coding gate — undefined unless the pin is an `evermind/<ref>` route.
    const evermindCoding = await resolveEvermindCodingRoute(env, db, tenantId, model);
    // Operator ROLE_MODELS pin is the requested model when this turn has no explicit
    // user/agent pin. Undefined pin = existing plan seed / learned ranker.
    const requested = requestedModelForRole(env, role, model);
    const pick = pickCloudModel(requested, ctx.effectivePlan, ctx.premiumOverride, {
      ...(evermindCoding ? { evermindCoding } : {}),
      role: turnRole,
      // A cost-first role (explore / utility / verify) orders by expected cost.
      prices: await pricesForCall(env, turnRole, undefined),
      // D3: Thompson exploration on the soft seed while the lever is on for this tenant.
      explore: cloudRoutingExploration(env, tenantId),
      // Context-aware seed: a small-window model isn't picked for a big turn.
      estimatedTokens: estimateRequestTokens(args.messages, args.tools),
      byoVendors,
      // Tenant BYO precedence — lead with the owner's chosen account (e.g. Meta first).
      byoVendorPriority: creds.vendorPriority,
      byoAlertedVendors: creds.alertedVendors ?? [],
      isSuperadmin: ctx.isSuperadmin,
      registeredModels: creds.registeredModels,
      preferredRegisteredModel: creds.preferredOpenRouterModel,
      byoSelectedModels: creds.byoSelectedModels,
      // Parity with the durable loop: a PREMIUM pin needs a validated billing card.
      premiumEntitled: ctx.premiumEntitled,
    });
    modelState = initialCloudRunModelState(pick, role, { verify: requestedModelForRole(env, 'verify') ?? undefined });
    if (cascade) modelState = await cascade.seed(modelState, pick.strict === true);
  }
  // The cascade's steer (why the run moved tier) rides THIS request only.
  const cascadeSteer = cascade?.steerNote();
  const turnMessages = cascadeSteer ? [...args.messages, { role: 'user', content: cascadeSteer }] : args.messages;
  const requestedModel = modelState.policy.model ?? model;
  const proxy = llmProxyForPlan(env, ctx.effectivePlan, ctx.premiumOverride, {
    backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true,
    ...(anthropicOAuthToken ? { anthropicOAuthToken } : {}),
    ...(openaiCodexAuth ? { openaiCodexAuth } : {}),
    ...(xaiOAuthToken ? { xaiOAuthToken } : {}),
    ...(hasVendorKeys(tenantVendorKeys) ? { tenantVendorKeys } : {}),
    ...byoRoutingOptions(creds),
    ...strictWhenConnected(creds.configuredProviders.length > 0),
  });
  const turnRun = await completeUnderRunPolicy(modelState, (req) => {
    // D5: the per-role reply cap — parity with the durable loop's session cap.
    const maxTokens = cloudOutputCap(env, tenantId, req.role, undefined);
    return proxy.complete({
      messages: turnMessages as unknown as ChatMessage[], tools: args.tools,
      ...turnRequestFields(req),
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
      // Personality temperature — parity with the Worker/DO loop.
      ...(ctx.execParams.temperature != null ? { temperature: ctx.execParams.temperature } : {}),
      // Personality reasoning levers (thinkLevel/reasoningLevel) → the CORRECT vendor
      // param for THIS model family (Anthropic `thinking` / OpenAI `reasoning_effort`),
      // or nothing for a model that doesn't support one (reasoningCapability drops it).
      // Only on a STRICT pin: an unpinned model may cascade to a different vendor that
      // would reject the param, so we attach it solely when the resolved model is fixed.
      // First-turn detection: no assistant turn yet in this slice.
      // D4: with no persona level, the turn role's default effort while the lever is on.
      ...(req.strict
        ? reasoningParamsForModel(req.model, withCascadeReasoning(cascade, cloudReasoningExecParams(env, tenantId, ctx.execParams, req.role), req.role), {
            isFirstTurn: !args.messages.some((m) => (m as { role?: string }).role === 'assistant'),
          }) ?? {}
        : {}),
      useCase: 'task_execution',
      prompt_cache_key: `cloud:${executionId}`,
    }, undefined, undefined, args.signal);
  }, (outcome) => recordModelCascade(db, { tenantId, cloudAgentRef, executionId }, outcome));
  // Shared post-`complete` processing (metering + telemetry) — identical to the
  // in-Worker loop, so a child's tokens are the tenant's tokens and a delegation that
  // quietly billed to nobody cannot happen.
  const turn = await recordCloudLlmTurn(turnRun.result, {
    env, db, tenantId, cloudAgentRef, executionId, taskId, projectId,
    requestedModel, fallbackModel: turnRun.state.policy.model,
    effectivePlan: ctx.effectivePlan, premiumOverride: ctx.premiumOverride,
    role: turnRole,
    phase: turnRun.state.policy.phase,
    turnInput: { messages: turnMessages, tools: args.tools },
  }, { tGen0, notify: args.notify });
  await cascade?.end(turn.ok ? turn.resolvedModel : undefined);
  if (!turn.ok) return { ok: false, error: turn.error, modelState: turnRun.state };
  return {
    ok: true, content: turn.content, toolCalls: turn.toolCalls, resolvedModel: turn.resolvedModel,
    modelState: turnRun.state,
    fallbackSurface: codingFallbackSurface(byoVendors, ctx.effectivePlan, ctx.premiumOverride),
  };
}

/** D1: the persona/role reasoning levers, raised while the cascade has a unit escalated. */
function withCascadeReasoning(cascade: ImageCascade | null, base: AgentExecParams | undefined, role: unknown): AgentExecParams | undefined {
  return cascade ? cascade.reasoning(base, role) : base;
}
