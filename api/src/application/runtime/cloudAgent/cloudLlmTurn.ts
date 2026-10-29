/**
 * ONE metered cloud LLM turn — the half of a cloud run that talks to the gateway and
 * accounts for it, used by the engine's loop (`runCloudToolLoop`).
 *
 * Split out of `cloudAgentEngine.ts` (see `agent.ts` for why that file is being broken
 * up) together with the model hand-off policy it now drives (`cloudRunModelPolicy.ts`):
 * metering (`recordCloudUsage`), parsing (`parseLlmChoice`), the post-complete
 * telemetry (`recordCloudLlmTurn`).
 * The engine re-exports the public names so every existing importer keeps working.
 */
import { splitVendorReasoning, type ChoiceMessageLike } from '@builderforce/agent-loop';
import type { ModelRole } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { isPremiumModelSelection, llmProxyForPlan } from '../../llm/LlmProxyService';
import { logTrace } from '../../llm/traceLogger';
import { clampTokenCount, normalizeByoProvider, recordUsageRow } from '../../llm/usageLedger';
import type { RawToolCall } from '../cloudAgentTools';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { notifyExecutionSubscribers } from '../executionEvents';
import { emitCodingModelDegraded } from './routing';
import type { LlmUsage } from '../../llm/proxyTypes';
import { CONTEXT_CATEGORIES_KEY, contextCategoryTokens, type ContextCategoryTokens, type TurnInput } from '../../costMetrics/contextCategories';

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
    entryPoint:       'cloud',
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
