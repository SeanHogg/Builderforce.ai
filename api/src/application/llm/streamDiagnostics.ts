/**
 * Streaming diagnostics — the two things a streamed completion could not tell you.
 *
 * A non-streaming completion returns a JSON envelope, so the gateway can attach the
 * cascade's `failovers[]` to it and the caller sees exactly which models were tried
 * before one answered. A STREAM has no envelope: the response is returned the moment
 * headers arrive, long before the proxy knows anything else, and the only diagnostic
 * channel was a handful of `x-builderforce-*` headers that most SSE clients never
 * surface. Two consequences, both closed here:
 *
 *   1. FAILOVERS WERE INVISIBLE ON STREAMS. A run that burned four models before
 *      succeeding looked identical to one that answered first try. This appends ONE
 *      terminal SSE frame carrying them, immediately before `[DONE]`.
 *
 *   2. AN EMPTY-BUT-200 STREAM WAS UNDETECTABLE. The non-streaming path has caught
 *      this since `isEmptyChatResponse`: some free-tier upstreams accept a request,
 *      burn 10–20s, and return 200 with no content. Streaming could not — the
 *      dispatcher's `validate` hook runs before any bytes exist, and headers are
 *      already sent. So the model was never cooled, and the very next request picked
 *      it again. Here the emptiness is observed at the END of the stream and reported
 *      through a callback the proxy turns into a post-stream cooldown.
 *
 * SHAPE OF THE TERMINAL FRAME. It is a VALID OpenAI chunk (`object`, `id`, `model`,
 * and an empty `choices` array) that additionally carries `_builderforce`. This is
 * the same convention vendors use for their terminal usage frame, and it matters: a
 * bare `{"_builderforce":…}` payload would make a strict client throw on a field it
 * cannot map, whereas an empty-`choices` chunk is something every SSE client already
 * has to tolerate. Clients that do not know the field ignore it.
 */

import { parseSseDataLine } from './sseFrames';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** What the terminal frame carries. Mirrors the non-streaming envelope's fields so a
 *  consumer reads the same names on both surfaces. */
export interface StreamDiagnosticsPayload {
  /** Every model attempted before the one that answered, in order. */
  failovers: ReadonlyArray<{ model: string; vendor: string; code: number; kind?: string }>;
  /** The model that actually served the stream. */
  resolvedModel: string;
  resolvedVendor: string;
  /** Gateway trace id — the same value as the `x-builderforce-trace-id` header, so a
   *  caller can quote it back without having read the headers. */
  traceId?: string;
}

export interface StreamDiagnosticsOptions {
  payload: StreamDiagnosticsPayload;
  /**
   * Called once, after the stream closes, IF it produced no assistant content and no
   * tool call. The proxy uses it to write the cooldown the dispatcher could not.
   * Never called for a stream that produced anything, and never called twice.
   */
  onEmptyStream?: () => void;
}

/** Did this SSE chunk carry any assistant output? Content delta, tool-call delta, or
 *  a non-streaming-shaped `message` all count. Deliberately generous: a false
 *  "non-empty" costs nothing, whereas a false "empty" would cool a working model. */
function chunkHasOutput(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return false;
  for (const choice of choices) {
    const c = choice as { delta?: Record<string, unknown>; message?: Record<string, unknown> };
    const part = c?.delta ?? c?.message;
    if (!part) continue;
    if (typeof part.content === 'string' && part.content.length > 0) return true;
    if (Array.isArray(part.content) && part.content.length > 0) return true;
    if (Array.isArray(part.tool_calls) && part.tool_calls.length > 0) return true;
    // Anthropic-shaped bridges surface reasoning as its own field; a stream that
    // produced only reasoning is still a stream that produced something.
    if (typeof part.reasoning === 'string' && part.reasoning.length > 0) return true;
  }
  return false;
}

/**
 * Wrap an SSE stream to (a) append the terminal diagnostics frame just before
 * `[DONE]` and (b) detect an empty-but-200 stream.
 *
 * Line-buffered across chunk boundaries, because an SSE `data:` line can be split
 * across two network chunks — the same reason `restoreStreamToolNames` buffers. Pure
 * pass-through for every byte it does not add: lines are re-emitted verbatim rather
 * than re-serialized, so this cannot perturb a payload it failed to understand.
 */
export function instrumentStream(
  source: ReadableStream<Uint8Array>,
  opts: StreamDiagnosticsOptions,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let sawOutput = false;
  let emittedDiagnostics = false;

  const diagnosticsFrame = (): string => {
    const chunk = {
      id: opts.payload.traceId ?? 'builderforce-diagnostics',
      object: 'chat.completion.chunk',
      model: opts.payload.resolvedModel,
      choices: [] as unknown[],
      _builderforce: {
        failovers: opts.payload.failovers,
        resolvedModel: opts.payload.resolvedModel,
        resolvedVendor: opts.payload.resolvedVendor,
        ...(opts.payload.traceId ? { traceId: opts.payload.traceId } : {}),
      },
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  };

  /** Re-emit one complete line, inserting the diagnostics frame immediately BEFORE
   *  `[DONE]`. Returns what should be written in place of the line. */
  const rewriteLine = (line: string): string => {
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (bare.trim() === 'data: [DONE]' || bare.trim() === 'data:[DONE]') {
      // BEFORE `[DONE]`: a client that stops reading at the documented terminator —
      // which is what most SDKs do — would never see a frame appended after it.
      if (emittedDiagnostics) return line;
      emittedDiagnostics = true;
      return `${diagnosticsFrame()}${line}`;
    }
    const parsed = parseSseDataLine(bare);
    if (parsed !== undefined && !sawOutput) sawOutput = chunkHasOutput(parsed);
    return line;
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      // Emit only COMPLETE lines; a trailing partial line stays buffered, because an
      // SSE `data:` line can be split across two network chunks.
      const nl = pending.lastIndexOf('\n');
      if (nl === -1) return;
      const ready = pending.slice(0, nl + 1);
      pending = pending.slice(nl + 1);
      controller.enqueue(encoder.encode(ready.split('\n').map(rewriteLine).join('\n')));
    },
    flush(controller) {
      const rest = pending + decoder.decode();
      if (rest.length > 0) controller.enqueue(encoder.encode(rewriteLine(rest)));
      // A vendor that closed without `[DONE]` still gets the frame — appended at the
      // end rather than dropped, since there is no terminator left to precede.
      if (!emittedDiagnostics) {
        emittedDiagnostics = true;
        controller.enqueue(encoder.encode(diagnosticsFrame()));
      }
      if (!sawOutput) opts.onEmptyStream?.();
    },
  });

  source.pipeTo(writable).catch((error) => { /* client may cancel mid-stream */
    reportCaughtError(error, { source: 'application/llm/streamDiagnostics.ts', operation: 'instrumentStream' });
  });
  return readable;
}
