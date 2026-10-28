/**
 * Label LOG-PROBABILITIES from a warm on-device model — the PreFetch gate's tier 3
 * (`@builderforce/prefetch`, docs/design/deterministic-prefetch.md).
 *
 * One forward pass: the labels are given single-letter codes, the model is asked for the
 * code with `max_tokens: 1`, and the first token's `top_logprobs` are read back per code.
 * Every engine speaks the OpenAI chat route, so the request and the reading are shared;
 * an engine only supplies `complete` (one non-streaming call) and `warm` (a model is
 * ALREADY resident — the port never loads one to answer).
 *
 * Which engines can: WebLLM (`logprobs` + `top_logprobs` ≤ 5 on a non-streaming call) and
 * Ollama (`/v1/chat/completions` returns `logprobs` since 0.12). Synapse / `bfi` is first
 * in {@link LOGPROB_ENGINE_ORDER} but has no adapter: the bfi engine's chat contract
 * returns no logprobs today, so it is not in the chain until it does.
 *
 * `createLogprobPort` structurally implements `@builderforce/prefetch`'s `LogprobPort`
 * (kept structural so this package does not depend on the gate's).
 */

import { fetchLocal, localAuthHeaders, localChatCompletionsUrl } from './endpoint.js';
import type { FetchLike } from './probe.js';
import type { LocalEndpoint, LocalRuntimeId } from './runtimes.js';

/** Tier 3's engine preference — our engines first, a third-party server last. */
export const LOGPROB_ENGINE_ORDER: readonly LocalRuntimeId[] = ['synapse', 'webllm', 'ollama'];

const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface LogprobEngine {
  runtime: LocalRuntimeId;
  /** A model is resident right now. Must not load one. */
  warm(): boolean;
  /** The most alternatives per token the engine returns (WebLLM: 5; Ollama: 20). */
  maxTopLogprobs: number;
  /** One non-streaming OpenAI chat completion on the resident model; the parsed body. */
  complete(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

/** The structural twin of `@builderforce/prefetch`'s `LogprobPort`. */
export interface LabelLogprobPort {
  warm(): boolean;
  logprobs(prompt: string, labels: string[], signal?: AbortSignal): Promise<Record<string, number>>;
}

/** The single-token classification request: the prompt plus the label → code table. */
export function labelLogprobsRequest(prompt: string, labels: readonly string[], maxTopLogprobs: number): Record<string, unknown> {
  const coded = labels.slice(0, CODES.length);
  const table = coded.map((label, i) => `${CODES[i]} = ${label}`).join('\n');
  return {
    messages: [
      { role: 'system', content: 'You are a classifier. Reply with one capital letter and nothing else.' },
      { role: 'user', content: `${prompt}\n\nCodes:\n${table}\n\nReply with the code of the one label that fits.` },
    ],
    max_tokens: 1,
    temperature: 0,
    stream: false,
    logprobs: true,
    top_logprobs: Math.max(1, Math.min(maxTopLogprobs, coded.length)),
  };
}

/** Per-label log-probabilities from a completion body; a label whose code was not among the alternatives is absent. */
export function readLabelLogprobs(body: unknown, labels: readonly string[]): Record<string, number> {
  const first = (body as { choices?: Array<{ logprobs?: { content?: Array<{ top_logprobs?: unknown }> } }> } | undefined)
    ?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs;
  const out: Record<string, number> = {};
  if (!Array.isArray(first)) return out;
  for (const alt of first) {
    const { token, logprob } = (alt ?? {}) as { token?: unknown; logprob?: unknown };
    if (typeof token !== 'string' || typeof logprob !== 'number' || !Number.isFinite(logprob)) continue;
    const code = token.trim().toUpperCase();
    const i = code.length === 1 ? CODES.indexOf(code) : -1;
    const label = i >= 0 ? labels[i] : undefined;
    if (label !== undefined && (out[label] === undefined || logprob > out[label]!)) out[label] = logprob;
  }
  return out;
}

/** An OpenAI-route runtime on this machine (Ollama), warm while `model()` names a resident model. */
export function httpLogprobEngine(
  runtime: LocalRuntimeId,
  endpoint: LocalEndpoint,
  options: { fetch: FetchLike; model: () => string | undefined; maxTopLogprobs?: number },
): LogprobEngine {
  return {
    runtime,
    warm: () => !!options.model(),
    maxTopLogprobs: options.maxTopLogprobs ?? 20,
    async complete(body, signal) {
      const model = options.model();
      if (!model) return undefined;
      const res = await fetchLocal(endpoint, options.fetch, localChatCompletionsUrl(endpoint.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...localAuthHeaders(endpoint) },
        body: JSON.stringify({ ...body, model }),
        ...(signal ? { signal } : {}),
      });
      return res.ok ? res.json() : undefined;
    },
  };
}

/**
 * The ONE tier-3 port: warm engines in {@link LOGPROB_ENGINE_ORDER}; the first whose
 * answer carries label logprobs wins. `warm()` is true only while some engine already
 * has a model resident. Never throws: a failing engine hands over to the next, and none
 * answering is `{}` (the gate then keeps its tier-2 reading).
 */
export function createLogprobPort(engines: readonly LogprobEngine[]): LabelLogprobPort {
  const rank = (e: LogprobEngine) => {
    const i = LOGPROB_ENGINE_ORDER.indexOf(e.runtime);
    return i < 0 ? LOGPROB_ENGINE_ORDER.length : i;
  };
  const ordered = [...engines].sort((a, b) => rank(a) - rank(b));
  return {
    warm: () => ordered.some((e) => e.warm()),
    async logprobs(prompt, labels, signal) {
      for (const engine of ordered) {
        if (signal?.aborted) break;
        if (!engine.warm()) continue;
        try {
          const body = await engine.complete(labelLogprobsRequest(prompt, labels, engine.maxTopLogprobs), signal);
          const scored = readLabelLogprobs(body, labels);
          if (Object.keys(scored).length > 0) return scored;
        } catch {
          // This engine could not answer; the next one may.
        }
      }
      return {};
    },
  };
}

/**
 * A resident-model reading refreshed in the background — what an HTTP engine's `warm()`
 * reads synchronously. `read` asks the runtime (Ollama: `ollamaResidentModels`); a stale
 * reading starts one refresh and answers with what it last knew. Never loads a model.
 */
export function residentModelTracker<T = string>(read: () => Promise<T | undefined>, ttlMs = 15_000, now: () => number = Date.now): () => T | undefined {
  let current: T | undefined;
  let at = Number.NEGATIVE_INFINITY;
  let inFlight = false;
  return () => {
    if (!inFlight && now() - at >= ttlMs) {
      inFlight = true;
      at = now();
      read().then((model) => { current = model; }, () => { current = undefined; }).finally(() => { inFlight = false; });
    }
    return current;
  };
}
