import { reportCaughtError } from '../observability/caughtErrorReporter';
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
import type { ImageProxyResult } from './ImageProxyService';
import type { HonoEnv } from '../../env';

type Env = HonoEnv['Bindings'];

/**
 * The trace-shaped view of a dispatched LLM call.
 *
 * Structural on purpose: `ProxyResult` (chat) satisfies it as-is, and any other
 * dispatcher shape reaches it through ONE adapter rather than a second copy of the
 * row-building code below. {@link imageTraceResult} is that adapter for
 * `ImageProxyService`, whose result is an `ImageProxyResult`, not a `ProxyResult`.
 */
export interface TraceResult {
  response: { status: number };
  resolvedModel?: string;
  resolvedVendor?: string;
  status?: number;
  outcome?: string;
  classification?: string | null;
  attempts?: unknown[];
  retries?: number;
  schemaRetries?: number;
  durationMs?: number;
  candidateChain?: string[] | null;
}

/**
 * The slice of `ExecutionContext` tracing needs.
 *
 * Optional at every call site: tracing must never be on the critical path, and a
 * caller with no request context (the Brain's background summarizations, a cloud
 * run driven from a DO alarm) must still be traceable rather than silently untraced.
 * {@link enqueueTrace} degrades to a swallowed floating promise when there is none.
 */
export type TraceCtx = { waitUntil(promise: Promise<unknown>): void };

/** Hand a best-effort write to `waitUntil` when there is one, else let it float.
 *  Either way the promise's rejection is already caught by the caller. */
function enqueueTrace(ctx: TraceCtx | undefined | null, promise: Promise<unknown>): void {
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(promise);
  else void promise;
}

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
  /** chat | image | ide-chat | brain | dataset-gen | agent | cloud | knowledge-ai | legal-ai */
  surface: string;
  tenantId?: number | null;
  userId?: string | null;
  agentHostId?: number | null;
  tenantApiKeyId?: string | null;
  llmProduct?: string | null;
  effectivePlan?: string | null;
  premiumOverride?: boolean;
  /** The dispatched result — source of resolvedModel/vendor, status, outcome,
   *  classification, durationMs, retries, schemaRetries, attempts, chain.
   *  `ProxyResult` satisfies this structurally; other dispatchers adapt into it
   *  (see {@link imageTraceResult}). */
  result: TraceResult;
  /** The cloud execution this call served, when it served one (0949). This is the
   *  join key that makes a run's LLM turns readable from the run itself — without
   *  it a cloud trace id was recorded on the timeline but resolved to nothing. */
  executionId?: number | null;
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
export function logTrace(env: Env, ctx: TraceCtx | undefined | null, input: TraceInput): void {
  const r = input.result;
  const status = r.status ?? r.response.status;
  const success = status < 400;
  const row = {
    traceId:           input.traceId,
    tenantId:          input.tenantId ?? null,
    userId:            input.userId ?? null,
    executionId:       input.executionId ?? null,
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
  enqueueTrace(
    ctx,
    buildTransactionalDatabase(env)
      .insert(llmTraces)
      .values(row)
      .catch((error) => { /* tracing must never fail the request */ 
        reportCaughtError(error, { source: "application/llm/traceLogger.ts", operation: "logTrace" });
      }),
  );
}

/**
 * Back-fill token usage onto an already-written streaming trace [1298].
 *
 * For `stream: true` calls the trace row is inserted up-front (identity, timing,
 * chain) with zero tokens, because usage is only known from the final SSE chunk.
 * The stream's usage callback calls this to UPDATE the matching row by trace id,
 * so streamed traces show real token counts instead of 0. Fire-and-forget; never
 * fails the request. The completion body is back-filled separately by
 * {@link backfillTraceResponseBody}, which the same stream tee drives.
 */
export function backfillTraceUsage(
  env: Env,
  ctx: TraceCtx | undefined | null,
  traceId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
): void {
  enqueueTrace(
    ctx,
    buildTransactionalDatabase(env)
      .update(llmTraces)
      .set({
        promptTokens:     usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens:      usage.totalTokens ?? 0,
      })
      .where(eq(llmTraces.traceId, traceId))
      .catch((error) => { /* tracing must never fail the request */ 
        reportCaughtError(error, { source: "application/llm/traceLogger.ts", operation: "backfillTraceUsage" });
      }),
  );
}

/**
 * Back-fill the COMPLETION BODY onto an already-written streaming trace.
 *
 * A streamed trace used to capture everything except the one field a reader opens
 * it for: what the model actually said. `response_body` stayed null because the
 * body is only assembled as the SSE frames arrive, long after the row is written.
 * The stream tee ({@link wrapStreamForTrace}) reassembles the completion as it
 * passes through to the client and hands it here, so a streamed trace reads the
 * same as a non-streamed one.
 *
 * Redacted and capped by the same helper the insert path uses — a streamed body is
 * no less likely to echo a pasted key. Fire-and-forget; a failure here can never
 * touch the stream, which has already been delivered.
 */
export function backfillTraceResponseBody(
  env: Env,
  ctx: TraceCtx | undefined | null,
  traceId: string,
  responseBody: unknown,
  errorMessage?: string | null,
): void {
  const body = redactedJsonOrNull(responseBody ?? null);
  if (body == null && !errorMessage) return;
  enqueueTrace(
    ctx,
    buildTransactionalDatabase(env)
      .update(llmTraces)
      .set({
        ...(body != null ? { responseBody: body } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      })
      .where(eq(llmTraces.traceId, traceId))
      .catch((error) => { /* tracing must never fail the request */
        reportCaughtError(error, { source: "application/llm/traceLogger.ts", operation: "backfillTraceResponseBody" });
      }),
  );
}

/**
 * THE image trace-shape adapter.
 *
 * `ImageProxyService.generate()` returns an {@link ImageProxyResult} — no HTTP
 * `Response`, no outcome/classification/duration — so `/v1/images` was the one
 * gateway surface with no `llm_traces` row at all. Rather than duplicate the
 * row-building code for images, this maps the image result onto the SAME
 * {@link TraceResult} shape `logTrace` already consumes, so there is exactly one
 * trace writer for every surface.
 *
 * Mapping notes:
 *   • `data.length === 0` is the image cascade's failure signal and the route turns
 *     it into a 429 — so status/outcome mirror what the caller actually receives.
 *   • image failovers carry `{ model, vendor, code }`; attempts are normalised to
 *     the `{ model, vendor, status }` shape the trace viewer renders for chat.
 */
export function imageTraceResult(
  result: ImageProxyResult,
  opts: { durationMs: number },
): TraceResult {
  const exhausted = result.body.data.length === 0;
  const status = exhausted ? 429 : 200;
  return {
    response: { status },
    resolvedModel:  result.resolvedModel,
    resolvedVendor: result.resolvedVendor,
    status,
    outcome:        exhausted ? 'cascade_exhausted' : 'success',
    classification: exhausted ? 'mixed' : null,
    attempts:       result.failovers.map((f) => ({ model: f.model, vendor: f.vendor, status: f.code })),
    retries:        result.retries,
    schemaRetries:  0,
    durationMs:     opts.durationMs,
    candidateChain: result.failovers.map((f) => f.model),
  };
}
