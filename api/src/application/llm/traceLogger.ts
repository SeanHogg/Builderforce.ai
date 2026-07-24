/**
 * LLM diagnostic trace logger.
 *
 * Persists one fully-detailed row per LLM call to `llm_traces` — who called,
 * how long it ran, every model attempt (with per-attempt error text + timing),
 * the candidate chain, and the full request/response bodies.
 *
 * Two hard rules:
 *   1. This data is builder-side ONLY. The trace id is the single piece echoed
 *      to the caller (so a customer can quote it); everything captured here is
 *      for superadmin diagnostics and must never be serialized back.
 *   2. Tracing must never fail or slow a request — every insert is
 *      fire-and-forget via `ctx.waitUntil` and swallows its own errors.
 *
 * The trace id itself is minted by `newTraceId()` in LlmProxyService (so the
 * proxy can stamp it onto `ProxyResult` even for internal callers that don't
 * pre-generate one); routes pass that same id here.
 */
import { eq } from 'drizzle-orm';
import { buildTransactionalDatabase } from '../../infrastructure/database/connection';
import { llmTraces } from '../../infrastructure/database/schema';
import { redactSecrets } from '../../infrastructure/security/redactSecrets';
import type { ProxyResult } from './LlmProxyService';
import type { HonoEnv } from '../../env';

type Env = HonoEnv['Bindings'];

/** Per-body cap. Full bodies are wanted for diagnostics, but a runaway payload
 *  shouldn't bloat a single row unbounded — truncate with a visible marker. */
const BODY_CAP = 100_000;

function cap(s: string): string {
  return s.length > BODY_CAP ? `${s.slice(0, BODY_CAP)}\n…[truncated ${s.length - BODY_CAP} chars]` : s;
}

function jsonOrNull(v: unknown): string | null {
  if (v == null) return null;
  try {
    return cap(typeof v === 'string' ? v : JSON.stringify(v));
  } catch {
    return null;
  }
}

/**
 * Like {@link jsonOrNull} but scrubs secret-shaped substrings (API keys, bearer
 * tokens, private keys) before persisting. Used for the free-form request/response
 * bodies, which can echo a caller's auth headers or a key pasted into a prompt.
 * Redaction runs on the full serialized text BEFORE the 100KB cap so a secret near
 * the tail is still masked when the row is truncated.
 */
function redactedJsonOrNull(v: unknown): string | null {
  if (v == null) return null;
  try {
    return cap(redactSecrets(typeof v === 'string' ? v : JSON.stringify(v)));
  } catch {
    return null;
  }
}

/** Compact request-shape summary — the routing-relevant flags a superadmin uses
 *  to reason about why the cascade behaved the way it did. No model lists. */
function requestShapeOf(body: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!body) return null;
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  const rf = body.response_format as { type?: string } | undefined;
  const hasVision = messages.some((m) => {
    const content = (m as { content?: unknown })?.content;
    return Array.isArray(content) && content.some((p) => (p as { type?: string })?.type === 'image_url');
  });
  return {
    messageCount: messages.length,
    hasTools: Array.isArray(body.tools) && (body.tools as unknown[]).length > 0,
    hasStructuredOutput: rf?.type === 'json_object' || rf?.type === 'json_schema',
    hasVision,
    modelHint: typeof body.model === 'string' ? body.model : null,
    modelStrict: body.modelStrict === true,
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.max_tokens != null ? { maxTokens: body.max_tokens } : {}),
    ...(typeof body.useCase === 'string' ? { useCase: body.useCase } : {}),
  };
}

export interface TraceInput {
  traceId: string;
  /** chat | image | ide-chat | brain | dataset-gen | agent */
  surface: string;
  tenantId?: number | null;
  userId?: string | null;
  agentHostId?: number | null;
  tenantApiKeyId?: string | null;
  llmProduct?: string | null;
  effectivePlan?: string | null;
  premiumOverride?: boolean;
  /** The dispatched result — source of resolvedModel/vendor, status, outcome,
   *  classification, durationMs, retries, schemaRetries, attempts, chain. */
  result: ProxyResult;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  streamed?: boolean;
  useCase?: string | null;
  idempotencyKey?: string | null;
  /** Caller's own x-request-id / x-correlation-id for cross-referencing. */
  consumerRequestId?: string | null;
  requestIp?: string | null;
  origin?: string | null;
  userAgent?: string | null;
  /** Full request body (messages, tools, response_format, …). */
  requestBody?: Record<string, unknown>;
  callerMetadata?: Record<string, unknown> | null;
  /** Parsed final response or error envelope. */
  responseBody?: unknown;
  errorMessage?: string | null;
}

/**
 * Write one full diagnostic trace, fire-and-forget. Safe to call on every LLM
 * request (success or failure, streaming or not). Builder-side only.
 */
export function logTrace(env: Env, ctx: ExecutionContext, input: TraceInput): void {
  const r = input.result;
  const status = r.status ?? r.response.status;
  const success = status < 400;
  const row = {
    traceId:           input.traceId,
    tenantId:          input.tenantId ?? null,
    userId:            input.userId ?? null,
    agentHostId:            input.agentHostId ?? null,
    tenantApiKeyId:    input.tenantApiKeyId ?? null,
    llmProduct:        input.llmProduct ?? null,
    surface:           input.surface,
    effectivePlan:     input.effectivePlan ?? null,
    premiumOverride:   input.premiumOverride ?? false,
    resolvedModel:     r.resolvedModel ?? null,
    resolvedVendor:    r.resolvedVendor ?? null,
    status,
    success,
    outcome:           r.outcome ?? (success ? 'success' : 'cascade_exhausted'),
    classification:    r.classification ?? null,
    attemptCount:      r.attempts?.length ?? r.retries ?? 0,
    retries:           r.retries ?? 0,
    schemaRetries:     r.schemaRetries ?? 0,
    durationMs:        r.durationMs ?? 0,
    promptTokens:      input.usage?.promptTokens ?? 0,
    completionTokens:  input.usage?.completionTokens ?? 0,
    totalTokens:       input.usage?.totalTokens ?? 0,
    useCase:           input.useCase ?? null,
    idempotencyKey:    input.idempotencyKey ?? null,
    consumerRequestId: input.consumerRequestId ?? null,
    requestIp:         input.requestIp ?? null,
    origin:            input.origin ?? null,
    userAgent:         input.userAgent ?? null,
    streamed:          input.streamed ?? false,
    errorMessage:      input.errorMessage ?? null,
    requestShape:      jsonOrNull(requestShapeOf(input.requestBody)),
    candidateChain:    jsonOrNull(r.candidateChain ?? null),
    attempts:          jsonOrNull(r.attempts ?? []),
    // Redacted: these bodies can carry a caller's Authorization header or a key
    // pasted into a prompt. Retention/TTL is enforced separately — `llm_traces`
    // is purged after 30 days by runRetentionPurge() (maintenance/retentionPurge.ts).
    requestBody:       redactedJsonOrNull(input.requestBody?.messages ?? input.requestBody ?? null),
    responseBody:      redactedJsonOrNull(input.responseBody ?? null),
    callerMetadata:    jsonOrNull(input.callerMetadata ?? null),
  };
  ctx.waitUntil(
    buildTransactionalDatabase(env)
      .insert(llmTraces)
      .values(row)
      .catch(() => { /* tracing must never fail the request */ }),
  );
}

/**
 * Back-fill token usage onto an already-written streaming trace [1298].
 *
 * For `stream: true` calls the trace row is inserted up-front (identity, timing,
 * chain) with zero tokens, because usage is only known from the final SSE chunk.
 * The stream's usage callback calls this to UPDATE the matching row by trace id,
 * so streamed traces show real token counts instead of 0. Fire-and-forget; never
 * fails the request. (The completion `response_body` for streams is still not
 * captured — that needs buffering the stream; tokens are the higher-value half.)
 */
export function backfillTraceUsage(
  env: Env,
  ctx: ExecutionContext,
  traceId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
): void {
  ctx.waitUntil(
    buildTransactionalDatabase(env)
      .update(llmTraces)
      .set({
        promptTokens:     usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens:      usage.totalTokens ?? 0,
      })
      .where(eq(llmTraces.traceId, traceId))
      .catch(() => { /* tracing must never fail the request */ }),
  );
}
