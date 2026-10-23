/**
 * The gateway's deterministic step (cost lever D7): answer a tool-free chat request
 * WITHOUT a model when a registered handler is sure of the answer.
 *
 * `completeChat` tries it before the caches. Eligibility is narrow on purpose — the
 * request must be one a plain-text answer satisfies:
 *   • no tools, tool_choice or legacy functions (an agent turn expects tool calls);
 *   • no response_format (a JSON caller would get prose);
 *   • one choice (n absent or 1);
 *   • the LAST message is a plain-text user message, and no tool result is in play.
 *
 * The answer is an OpenAI-shaped completion (or a one-chunk SSE stream when the
 * caller streamed) with NO `usage`, and the result's outcome is `deterministic`:
 * nothing was dispatched, so nothing is metered as spend ({@link isUndispatchedOutcome}).
 */

import { pseudoStreamFromCall } from '../vendors/pseudoStream';
import type { VendorCallParams, VendorId } from '../vendors';
import type { ChatCompletionRequest, ProxyResult } from '../proxyTypes';
import { answerDeterministically } from './registry';
import type { DeterministicAnswer } from './types';

/** The result outcome of a deterministic answer. */
export const DETERMINISTIC_OUTCOME = 'deterministic';

/** Outcomes that dispatched no model call — never metered as spend. THE predicate
 *  every meter should read, so a new undispatched outcome is added in one place. */
export function isUndispatchedOutcome(outcome: string | undefined): boolean {
  return outcome === 'response_cache_hit' || outcome === DETERMINISTIC_OUTCOME;
}

/** No vendor served the answer. A label-only member of the vendor union (no module is
 *  registered for it, so nothing may dispatch to it). */
const DETERMINISTIC_VENDOR: VendorId = 'builderforce';

/** The question a deterministic handler may answer, or null when the request is not eligible. */
export function deterministicQuestion(body: ChatCompletionRequest): string | null {
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.tools) ? b.tools.length > 0 : b.tools != null) return null;
  if (b.tool_choice != null || b.functions != null || b.function_call != null) return null;
  if (b.response_format != null) return null;
  if (b.n != null && b.n !== 1) return null;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.some((m) => m?.role === 'tool')) return null;
  const last = messages.at(-1) as { role?: unknown; content?: unknown } | undefined;
  if (!last || last.role !== 'user' || typeof last.content !== 'string') return null;
  return last.content;
}

/** The un-finalized result carrying a handler's answer. */
export function deterministicResult(answer: DeterministicAnswer, body: ChatCompletionRequest, now: Date): ProxyResult {
  const model = `deterministic/${answer.handler}`;
  const completion = {
    id: `chatcmpl-det-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(now.getTime() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: answer.content }, finish_reason: 'stop' }],
    _builderforce: { outcome: DETERMINISTIC_OUTCOME, handler: answer.handler },
  };
  const headers = { 'x-builderforce-outcome': DETERMINISTIC_OUTCOME, 'x-builderforce-deterministic': answer.handler };
  let response: Response;
  if (body.stream === true) {
    const stream = pseudoStreamFromCall({ raw: completion, content: answer.content }, { apiKey: '', model, messages: [] } as VendorCallParams).response;
    const streamHeaders = new Headers(stream.headers);
    for (const [k, v] of Object.entries(headers)) streamHeaders.set(k, v);
    response = new Response(stream.body, { status: 200, headers: streamHeaders });
  } else {
    response = new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  }
  return {
    response,
    resolvedModel: model,
    resolvedVendor: DETERMINISTIC_VENDOR,
    retries: 0,
    failovers: [],
    outcome: DETERMINISTIC_OUTCOME,
    attempts: [],
    byoFunded: false,
    platformSurcharge: false,
  };
}

/** The whole step: an eligible request a handler is sure of → its result, else null. */
export function tryDeterministicCompletion(body: ChatCompletionRequest, now: Date = new Date()): ProxyResult | null {
  const question = deterministicQuestion(body);
  if (question === null) return null;
  const answer = answerDeterministically(question, now);
  return answer ? deterministicResult(answer, body, now) : null;
}
