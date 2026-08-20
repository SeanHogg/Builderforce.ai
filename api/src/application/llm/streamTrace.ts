import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * streamTrace — the ONE stream tee for SSE completions.
 *
 * A streamed completion is handed straight to the client, so everything a trace
 * or a usage row wants to know about it has to be read IN PASSING. Three surfaces
 * needed exactly that and only one of them had it: the gateway chat route wrapped
 * its stream to scrape token usage, the guest chat path wrapped it to bill tokens,
 * and the IDE assistant (`ideAiRoutes`) wrapped nothing at all — its traces were
 * written with 0 tokens and stayed that way. None of the three captured the
 * completion BODY, so a streamed `llm_traces` row never held the model's answer.
 *
 * This module replaces the route-local `wrapStreamForUsage` with one tee that
 * reports BOTH halves:
 *   • `onUsage`    — normalised token counts from the final usage-bearing frame.
 *   • `onComplete` — the reassembled completion (content, tool calls, finish
 *                    reason, resolved model) once the stream ends.
 *
 * Hard rule inherited from the trace logger: this must never be able to break the
 * stream. Every callback is invoked inside a try/catch that reports and swallows,
 * chunks are enqueued before any parsing, and a malformed frame is skipped.
 */
import { parseSseDataLine } from './sseFrames';
import { pickUsage } from './vendors';
import type { LlmUsage } from './LlmProxyService';

/** The reassembled completion an SSE stream carried, as a trace can store it. */
export interface StreamedCompletion {
  /** Concatenated `choices[0].delta.content` across every frame. */
  content: string;
  /** Terminal `finish_reason`, when the stream reported one. */
  finishReason: string | null;
  /** `model` as echoed by the upstream frames (vendor's own id). */
  model: string | null;
  /** Tool calls assembled from `delta.tool_calls` (name + accumulated arguments). */
  toolCalls: Array<{ id: string | null; name: string; arguments: string }>;
  /** Token usage, when the stream reported it (same object handed to `onUsage`). */
  usage: LlmUsage | null;
}

interface StreamTraceHandlers {
  /** Called at most once, with the last usage-bearing frame's normalised counts. */
  onUsage?: (usage: LlmUsage) => void;
  /** Called exactly once when the stream ends (or errors), with what it carried. */
  onComplete?: (completion: StreamedCompletion) => void;
}

/** Run a tee callback without ever letting it reach the stream. */
function safely(operation: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/streamTrace.ts', operation });
  }
}

/** Normalise any vendor's raw usage object onto the ledger's shape. */
function normalizeUsage(raw: unknown): LlmUsage {
  const u = pickUsage(raw);
  return {
    promptTokens:     u.prompt_tokens     ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens:      u.total_tokens      ?? 0,
    ...(u.cache_read_tokens     != null ? { cacheReadTokens:     u.cache_read_tokens     } : {}),
    ...(u.cache_creation_tokens != null ? { cacheCreationTokens: u.cache_creation_tokens } : {}),
  };
}

/**
 * Wrap an SSE `ReadableStream` so it can be traced as it is delivered.
 *
 * Returns a stream that emits byte-for-byte what `source` emitted. Lines are
 * reassembled across chunk boundaries (an SSE frame is not guaranteed to arrive
 * whole), which the previous per-chunk `split('\n')` scrape could silently get
 * wrong on a large frame.
 */
export function wrapStreamForTrace(
  source: ReadableStream<Uint8Array>,
  handlers: StreamTraceHandlers,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let pending = '';
  let usage: LlmUsage | null = null;
  let content = '';
  let finishReason: string | null = null;
  let model: string | null = null;
  const toolCalls = new Map<number, { id: string | null; name: string; arguments: string }>();
  let finished = false;

  const readFrame = (line: string): void => {
    const frame = parseSseDataLine(line);
    if (frame == null || typeof frame !== 'object') return;
    const f = frame as Record<string, unknown>;
    if (typeof f.model === 'string' && f.model) model = f.model;
    if (f.usage) usage = normalizeUsage(f.usage);
    const choice = Array.isArray(f.choices) ? (f.choices[0] as Record<string, unknown> | undefined) : undefined;
    if (!choice) return;
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
    const delta = (choice.delta ?? choice.message) as Record<string, unknown> | undefined;
    if (!delta) return;
    if (typeof delta.content === 'string') content += delta.content;
    const deltaCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const raw of deltaCalls) {
      const tc = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
      const index = typeof tc.index === 'number' ? tc.index : toolCalls.size;
      const acc = toolCalls.get(index) ?? { id: null, name: '', arguments: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') acc.arguments += tc.function.arguments;
      toolCalls.set(index, acc);
    }
  };

  /** Emit both callbacks exactly once, whatever ended the stream. */
  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (usage && handlers.onUsage) {
      const settled = usage;
      safely('wrapStreamForTrace.onUsage', () => handlers.onUsage!(settled));
    }
    if (handlers.onComplete) {
      safely('wrapStreamForTrace.onComplete', () => handlers.onComplete!({
        content,
        finishReason,
        model,
        toolCalls: [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
        usage,
      }));
    }
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Deliver FIRST — parsing must never sit between the vendor and the client.
      controller.enqueue(chunk);
      safely('wrapStreamForTrace.transform', () => {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) readFrame(line);
      });
    },
    flush() {
      safely('wrapStreamForTrace.flush', () => {
        const tail = pending + decoder.decode();
        if (tail) readFrame(tail);
        pending = '';
      });
      finish();
    },
  });

  source.pipeTo(writable).catch((error) => { /* stream may be cancelled by client */
    // A cancelled stream still carries whatever arrived before the cancel — report
    // it rather than losing the tokens the caller was already charged for.
    finish();
    reportCaughtError(error, { source: 'application/llm/streamTrace.ts', operation: 'wrapStreamForTrace' });
  });
  return readable;
}
