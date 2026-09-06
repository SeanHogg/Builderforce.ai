/**
 * `completeJson` — ONE structured-output completion.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Eighteen call sites asked a model for JSON and each re-wrote the same dozen
 * lines: build two messages, pick a dispatcher, check `status >= 400` (one
 * site forgot, so a gateway 5xx became "0 security findings"), unwrap the first
 * choice (two sites read `choices[0].message.content` by hand and skipped
 * `readProxyChoice`), strip a code fence (six private, mutually incompatible
 * strippers), `JSON.parse`, and then map the failure onto that site's policy.
 * The body of `systemicDiagnosis.ts` and `businessValueAI.ts` was verbatim
 * identical. The same reply could parse on one surface and fail on another.
 *
 * This module owns the whole middle of that sequence. A site now states WHAT
 * it wants (prompt, schema, budget) and HOW to reach a model ({@link JsonDispatch}),
 * and gets back a {@link CompleteJsonResult} it maps onto its own policy — null,
 * a heuristic fallback, a thrown error, a reason string, a 502. Nothing here
 * throws: a dispatcher that rejects is a `gateway` failure like any other.
 *
 * Parsing goes through {@link extractJsonPayload} (domain/shared/json.ts) — the
 * ONE fence-and-brace reader — and the gateway's own `responseFormat.ts`
 * conformance retry still runs underneath for strict `json_schema` requests.
 */
import { extractJsonPayload } from '../../domain/shared/json';
import type { Env } from '../../env';
import {
  ideProxy,
  readProxyChoice,
  type ChatCompletionRequest,
  type ProxyEnv,
  type ProxyResult,
} from './LlmProxyService';
import { completeForTenant, type CompleteForTenantOptions } from './tenantProxy';

/** The strict `response_format` literal the gateway enforces. */
export interface JsonResponseSchema {
  type: 'json_schema';
  json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
}

/** The loose "any JSON object" format, for prompts whose shape is prose-defined. */
export const JSON_OBJECT_FORMAT = { type: 'json_object' } as const;

/**
 * Build a strict `response_format` from a JSON-schema object. Every site used to
 * hand-write the `{ type, json_schema: { name, strict, schema } }` envelope.
 */
export function jsonSchemaFormat(name: string, schema: Record<string, unknown>): JsonResponseSchema {
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}

/** The minimum a proxy-shaped object must offer. `LlmProxyService` satisfies it. */
export interface JsonProxy {
  complete: (
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    traceId?: string,
    signal?: AbortSignal,
  ) => Promise<ProxyResult>;
}

/**
 * HOW to reach a model. The four shapes that exist in the codebase, named:
 *   - `ide`    — the operator's free pool (`ideProxy(env)`); internal utilities
 *                that must never spend a tenant's quota.
 *   - `tenant` — `completeForTenant`: the tenant's connected BYO account, model
 *                gating and metering, ONE place.
 *   - `proxy`  — an already-built proxy (`tenantProxyForPlan`, `llmProxyForPlan`)
 *                reused across a batch.
 *   - `text`   — an injected `(system, user) => string` (the compile pipeline's
 *                `LlmComplete`), for code that must not know about the gateway.
 */
export type JsonDispatch =
  | { kind: 'ide'; env: ProxyEnv }
  | { kind: 'tenant'; env: Env; tenantId: number; opts?: CompleteForTenantOptions }
  | { kind: 'proxy'; proxy: JsonProxy }
  | { kind: 'text'; llm: (system: string, user: string) => Promise<string> };

/** A multimodal user turn (text + file/image parts), passed through to the vendor as-is. */
export type UserContent = string | ReadonlyArray<Record<string, unknown>>;

export interface CompleteJsonRequest {
  /** System prompt. An empty string sends no system message (a bare multimodal turn). */
  system: string;
  user: UserContent;
  /** Strict schema (see {@link jsonSchemaFormat}) or loose `json_object`. Omit for a
   *  prompt that asks for JSON in prose only — parsing is the same either way. */
  schema?: JsonResponseSchema | { type: 'json_object' };
  /** Defaults to 0: structured extraction wants the mode, not a sample. */
  temperature?: number;
  maxTokens: number;
  /** The gateway's routing/metering slug. */
  useCase: string;
  /** A soft model hint (seeded at the head of the cascade). */
  model?: string;
  /** Gateway trace id, for callers that write their own diagnostic trace of the call. */
  traceId?: string;
  signal?: AbortSignal;
}

export type CompleteJsonFailureReason = 'gateway' | 'empty' | 'unparseable' | 'invalid';

export type CompleteJsonResult<T> =
  | {
      ok: true;
      value: T;
      /** The model that served, `null` for a `text` dispatch. */
      model: string | null;
      /** The gateway envelope, for callers that meter or read token usage. `null` for `text`. */
      result: ProxyResult | null;
    }
  | {
      ok: false;
      reason: CompleteJsonFailureReason;
      /** The gateway's HTTP status, when the failure was one. */
      status?: number;
      detail: string;
      /** The raw assistant text, when there was one — so a site can degrade to prose. */
      content?: string;
      /** The gateway envelope when dispatch produced one (metering still applies). */
      result?: ProxyResult;
    };

function messagesFor(request: CompleteJsonRequest): ChatCompletionRequest['messages'] {
  const user = { role: 'user' as const, content: request.user as never };
  return request.system ? [{ role: 'system', content: request.system }, user] : [user];
}

function bodyFor(request: CompleteJsonRequest): ChatCompletionRequest {
  return {
    ...(request.model ? { model: request.model } : {}),
    messages: messagesFor(request),
    temperature: request.temperature ?? 0,
    max_tokens: request.maxTokens,
    ...(request.schema ? { response_format: request.schema } : {}),
    useCase: request.useCase,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One dispatch through the gateway; the caller reads status + choice. */
async function dispatchProxy(dispatch: Exclude<JsonDispatch, { kind: 'text' }>, request: CompleteJsonRequest): Promise<ProxyResult> {
  const body = bodyFor(request);
  switch (dispatch.kind) {
    case 'ide':
      return ideProxy(dispatch.env).complete(body, undefined, request.traceId, request.signal);
    case 'tenant':
      return completeForTenant(dispatch.env, dispatch.tenantId, body, {
        ...dispatch.opts,
        ...(request.traceId ? { traceId: request.traceId } : {}),
      });
    case 'proxy':
      return dispatch.proxy.complete(body, undefined, request.traceId, request.signal);
  }
}

/**
 * Ask a model for JSON and get a value or a named failure. Never throws.
 *
 * `validate` turns the parsed `unknown` into `T` or returns `null` to refuse it;
 * without one the raw parsed value is returned as `T` (use `unknown`). Every
 * result is one of: `gateway` (dispatch threw, or answered ≥ 400 — `status` set
 * when there was one), `empty` (a 2xx with no assistant text), `unparseable`
 * (text with no JSON in it), `invalid` (JSON the validator refused).
 */
export async function completeJson<T = unknown>(
  dispatch: JsonDispatch,
  request: CompleteJsonRequest,
  validate?: (value: unknown) => T | null,
): Promise<CompleteJsonResult<T>> {
  let content: string;
  let model: string | null = null;
  let result: ProxyResult | null = null;

  if (dispatch.kind === 'text') {
    try {
      const user = typeof request.user === 'string' ? request.user : JSON.stringify(request.user);
      content = (await dispatch.llm(request.system, user)).trim();
    } catch (error) {
      return { ok: false, reason: 'gateway', detail: errorText(error) };
    }
  } else {
    try {
      result = await dispatchProxy(dispatch, request);
    } catch (error) {
      return { ok: false, reason: 'gateway', detail: errorText(error) };
    }
    const status = result.response.status;
    if (status >= 400) {
      return { ok: false, reason: 'gateway', status, detail: `gateway returned ${status}`, result };
    }
    content = (await readProxyChoice(result)).content;
    model = result.resolvedModel || null;
  }

  if (!content) {
    return { ok: false, reason: 'empty', detail: 'the model returned no content', ...(result ? { result } : {}) };
  }
  const parsed = extractJsonPayload(content);
  if (parsed === null) {
    return { ok: false, reason: 'unparseable', detail: 'the model reply contained no JSON', content, ...(result ? { result } : {}) };
  }
  const value = validate ? validate(parsed) : (parsed as T);
  if (value === null) {
    return { ok: false, reason: 'invalid', detail: 'the model reply did not match the expected shape', content, ...(result ? { result } : {}) };
  }
  return { ok: true, value, model, result };
}
