/**
 * THE Brain LLM call — proxy selection for background Brain calls, plus dispatch +
 * usage row + diagnostic trace in one place. Split out of `BrainService.ts`.
 */

import { ideProxy, newTraceId, type ChatCompletionRequest, type LlmProxyService, type ProxyResult } from '../llm/LlmProxyService';
import { logTrace } from '../llm/traceLogger';
import { tenantProxyForPlan } from '../llm/tenantProxy';
import { recordProxyUsage } from '../llm/usageLedger';
import { brainUsageEnv } from './brainUsageEnv';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * Per-call context for {@link completeTraced} — the request-scoped
 * facts a Brain LLM call needs in order to be billed AND traced.
 *
 * Deliberately a per-call object rather than constructor state: this service is
 * constructed once per worker with only a `Db`, and its `env` / `ExecutionContext`
 * belong to a REQUEST. `executionCtx` is optional because not every entry point has
 * one (a cron-driven consolidation does not); the trace logger falls back to a
 * floating best-effort write rather than skipping the row.
 */
export interface BrainCallContext {
  env: Env;
  executionCtx?: ExecutionContext;
  /** Operator key used for the usage row's pricing env (see recordUsage). */
  apiKey: string | undefined;
  tenantId: number;
  userId?: string | null;
  /** Ledger + trace `use_case` (brain_agent_reply | brain_summary | brain_project_memory). */
  useCase: string;
  chatId?: number | null;
  projectId?: number | null;
  agentRef?: string | null;
}

// Caller passes the OpenRouter key; `ideProxy` handles pool + productName.
// Cross-vendor fallbacks (Cerebras / Ollama) are not enabled here because
// the BrainService doesn't carry the full env — internal summarization stays
// single-vendor on purpose.
function buildLlmService(apiKey: string) {
  return ideProxy({ OPENROUTER_API_KEY: apiKey });
}

/**
 * Build the LLM proxy for an INTERNAL Brain background call (chat summarize,
 * project-memory consolidate, agentHost-session summarize). When the tenant has
 * connected their OWN account (Claude subscription/OAuth or a provider api-key)
 * that account serves the call — BYO-funded, so it's $0 to the operator and runs
 * on the model the tenant chose — via the shared {@link tenantProxyForPlan} builder
 * (BYO-first, with plan-pool failover if the connected account errors). With NOTHING
 * connected it stays on the operator OpenRouter key exactly as before, so these
 * background summarizations never start spending the owner's frontier quota for
 * tenants who haven't opted in. This is the "$0-token summarization/consolidation for
 * tenants who connected their own account" path.
 */
export async function buildTenantLlmService(env: Env, tenantId: number): Promise<LlmProxyService> {
  const { proxy, hasByo } = await tenantProxyForPlan(env, tenantId).catch(
    () => ({ proxy: null as LlmProxyService | null, hasByo: false }),
  );
  // Any rankable account of the tenant's own — a connected provider OR a registered
  // OpenRouter connection — serves the call on their own model; otherwise keep the
  // unchanged operator-key path. `hasByo` covers both (a connection contributes no
  // BYO vendor id, so a vendor-set check alone would miss a connection-only tenant).
  if (proxy && hasByo) return proxy;
  return buildLlmService(env.OPENROUTER_API_KEY ?? '');
}

/** Record a Brain summarization call in the usage ledger [1310] (best-effort,
 *  fire-and-forget; no-ops without usage). These non-streaming background calls
 *  were previously invisible to billing. The apiKey-only env is enough for the
 *  usage row; pricing lookup is best-effort. `traceId` links the billing row to
 *  the diagnostic trace {@link completeTraced} wrote for the same call. */
function recordUsage(db: Db, call: BrainCallContext, result: Parameters<typeof recordProxyUsage>[2]['result'], traceId?: string): void {
  // The REAL env (see brainUsageEnv): a stub env routed these rows to core.
  void recordProxyUsage(db, brainUsageEnv(call.env, call.apiKey), {
    tenantId: call.tenantId, useCase: call.useCase, result, ...(traceId ? { traceId } : {}),
  });
}

/**
 * THE Brain LLM call. Dispatch + usage row + diagnostic trace, in one place.
 *
 * Every `complete()` in this service used to be a bare proxy call followed by a
 * `recordUsage`, and none of them wrote an `llm_traces` row — so the Brain (agent
 * replies, chat summaries, project-memory consolidation, agentHost-session
 * summaries) was the largest untraced LLM caller in the system. Its calls were
 * billed and invisible: when a reply came back empty there was no row naming the
 * model, the cascade it walked, or the body it returned.
 *
 * The reason it stayed untraced was that `logTrace` needs a request context and
 * this service has none. It is threaded the same way the rest of the service
 * already threads one — a per-call {@link BrainCallContext} carrying `env` and the
 * OPTIONAL `executionCtx` the route holds ({@link agentReply} already took exactly
 * that shape) — not a module global. When no context reaches us the trace still
 * writes, best-effort, via the trace logger's own fallback.
 *
 * Tracing stays off the critical path: the response is CLONED before anyone reads
 * it (so the caller's `readProxyChoice` is untouched), the clone's parse cannot
 * throw, and the insert is fire-and-forget.
 */
export async function completeTraced(
  db: Db,
  service: LlmProxyService,
  request: ChatCompletionRequest,
  call: BrainCallContext,
): Promise<ProxyResult> {
  const traceId = newTraceId();
  const result = await service.complete(request, undefined, traceId);
  // Clone BEFORE the caller reads the body — a Response can only be consumed once.
  const cloned = (() => { try { return result.response.clone(); } catch { return null; } })();
  recordUsage(db, call, result, traceId);
  const responseBody = cloned ? await cloned.json().catch(() => null) : null;
  logTrace(call.env, call.executionCtx, {
    traceId,
    surface: 'brain',
    tenantId: call.tenantId,
    userId: call.userId ?? null,
    result,
    usage: result.usage ?? null,
    streamed: false,
    useCase: call.useCase,
    requestBody: request as unknown as Record<string, unknown>,
    callerMetadata: {
      ...(call.chatId != null ? { chatId: call.chatId } : {}),
      ...(call.projectId != null ? { projectId: call.projectId } : {}),
      ...(call.agentRef ? { agentRef: call.agentRef } : {}),
    },
    responseBody,
    errorMessage: result.response.status >= 400 ? `gateway ${result.response.status}` : null,
  });
  return result;
}
