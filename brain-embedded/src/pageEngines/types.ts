/**
 * THE contract every engine that runs INSIDE the page implements (PRD 34 §3.4) — Chrome's
 * built-in model (Prompt API), WebLLM and our WebGPU `bfi`.
 *
 * An engine answers two questions and nothing else: what it can serve right now (a probe
 * shaped exactly like an HTTP runtime's, so the shared plan reads it unchanged) and a
 * chat completion as OpenAI chunks. Turning that into the `fetch` the shared streamer
 * drives — SSE framing, failover statuses, the non-streaming answer — is the ONE shim's
 * (`pageEnginesFetch`), never an engine's.
 */

import type { LocalRuntimeId, LocalRuntimeProbe } from '@builderforce/local-inference';

/** The request as the streamer sends it: OpenAI `chat.completions` JSON. Gateway-only
 *  fields ride along; an engine reads what it needs and ignores the rest. */
export interface ChatCompletionsRequest {
  model?: unknown;
  messages?: unknown;
  tools?: unknown;
  stream?: unknown;
  [field: string]: unknown;
}

/** One OpenAI `chat.completion.chunk` — the shape every engine yields. */
export interface ChatCompletionChunk {
  id?: string;
  model?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: Record<string, unknown> | null;
}

export interface PageEngine {
  runtime: LocalRuntimeId;
  /** The non-routable root its chat route is answered at (`http://<runtime>.local`). */
  baseUrl: string;
  /** What it can serve right now, or null when nothing is ready. NEVER downloads, never
   *  throws; memoized, so asking per turn is free while nothing moved. */
  probe(options?: { fresh?: boolean }): Promise<LocalRuntimeProbe | null>;
  /** Drop the memoized probe — a model was downloaded or removed. */
  invalidate(): void;
  /**
   * The completion as OpenAI chunks. Anything that stops it from STARTING — a refusal,
   * a model not downloaded, an oversized prompt — is thrown before the iterable is
   * returned (or by its first pull) as a {@link PageEngineError}, so the shim answers a
   * non-2xx and the failover moves on before the user saw anything.
   */
  chatCompletions(body: ChatCompletionsRequest, signal?: AbortSignal): Promise<AsyncIterable<ChatCompletionChunk>>;
}

/** A refusal with the HTTP status the shim answers it with. */
export class PageEngineError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string = code) {
    super(message);
    this.name = 'PageEngineError';
    this.status = status;
    this.code = code;
  }
}

/** What an aborted request rejects with — re-thrown, never answered with a status. */
export const abortReason = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('Aborted', 'AbortError');

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A request's `tools` carries at least one tool. */
export const hasTools = (body: ChatCompletionsRequest): boolean => Array.isArray(body.tools) && body.tools.length > 0;

/**
 * A memoizing probe — the shape every engine's probe wants. Concurrent callers share one
 * in-flight answer; `fresh` forces a re-probe (a picker being opened); a throwing probe
 * reads as null, because "no engine here" is the normal case on most browsers.
 */
export function memoizedProbe(
  run: () => Promise<LocalRuntimeProbe | null>,
  config: { ttlMs?: number; now?: () => number } = {},
): Pick<PageEngine, 'probe' | 'invalidate'> {
  const ttlMs = config.ttlMs ?? PAGE_ENGINE_PROBE_TTL_MS;
  const now = config.now ?? (() => Date.now());
  let memo: { at: number; value: Promise<LocalRuntimeProbe | null> } | undefined;
  return {
    probe(options = {}) {
      const at = now();
      if (!options.fresh && memo && at - memo.at < ttlMs) return memo.value;
      const value = run().catch(() => null);
      memo = { at, value };
      return value;
    },
    invalidate() {
      memo = undefined;
    },
  };
}

/** How long a page engine's answer is trusted. It changes only when a download finishes,
 *  a model is removed or a policy flips — asking per turn would be pure overhead. */
export const PAGE_ENGINE_PROBE_TTL_MS = 30_000;
