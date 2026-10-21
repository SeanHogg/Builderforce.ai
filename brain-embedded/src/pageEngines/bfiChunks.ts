/**
 * `BfiEngine.chat`'s callback stream as OpenAI chunks — the `bfi` page engine's output
 * side, split out of `bfiEngine.ts`. The engine runs under its own controller, linked to
 * the request's signal and aborted when the consumer stops early (the shim returns the
 * iterator on a cancelled body), so generation never outlives the turn. A wasm trap
 * reported while it streams (`crashes`) ends it with that error instead of a hang — a
 * trap inside the engine's async work never settles its promise.
 */
import { reportPageEngineFailure } from './engineFailure';
import { abortReason, type ChatCompletionChunk } from './types';
import type { BfiEngineInstance } from './bfiEngine';

/** Where a trap is announced to every stream in flight. */
export type BfiCrashes = Set<(error: unknown) => void>;

/** The completion's closing chunk — its finish reason and usage — so the streamer sees
 *  them even when the engine's own chunks did not carry them. */
function closingChunk(finalJson: string): ChatCompletionChunk | null {
  try {
    const final = JSON.parse(finalJson) as {
      model?: string;
      choices?: Array<{ finish_reason?: string | null }>;
      usage?: Record<string, unknown>;
    };
    const finish = final.choices?.[0]?.finish_reason ?? null;
    if (!finish && !final.usage) return null;
    return {
      ...(final.model ? { model: final.model } : {}),
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      ...(final.usage ? { usage: final.usage } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * `BfiEngine.chat`'s callback stream as an async iterable. The engine runs under its own
 * controller, linked to the request's signal and aborted when the consumer stops early
 * (the shim returns the iterator on a cancelled body), so generation never outlives the
 * turn.
 */
export async function* bfiChunks(
  engine: BfiEngineInstance,
  requestJson: string,
  signal: AbortSignal | undefined,
  mapError: (e: unknown) => unknown,
  crashes: BfiCrashes,
): AsyncGenerator<ChatCompletionChunk> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const queue: ChatCompletionChunk[] = [];
  let wake: (() => void) | undefined;
  // A holder, not a `let`: it is settled inside callbacks, which control-flow narrowing
  // cannot see.
  const state: { outcome?: { ok: true; final: string } | { ok: false; error: unknown } } = {};
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  const onCrash = (error: unknown): void => {
    if (state.outcome) return;
    state.outcome = { ok: false, error };
    notify();
  };
  crashes.add(onCrash);
  engine
    .chat(
      requestJson,
      (json) => {
        try {
          queue.push(JSON.parse(json) as ChatCompletionChunk);
          notify();
        } catch (e) {
          // A malformed chunk is dropped (the closing chunk still carries the outcome),
          // and said so.
          reportPageEngineFailure('bfi', 'chunk', e);
        }
      },
      controller.signal,
    )
    .then(
      (final) => {
        state.outcome = { ok: true, final };
        notify();
      },
      (error: unknown) => {
        state.outcome = { ok: false, error };
        notify();
      },
    );
  try {
    for (;;) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (state.outcome) break;
      await new Promise<void>((resolve) => (wake = resolve));
    }
    const settled = state.outcome!;
    if (!settled.ok) throw signal?.aborted ? abortReason(signal) : mapError(settled.error);
    const closing = closingChunk(settled.final);
    if (closing) yield closing;
  } finally {
    crashes.delete(onCrash);
    signal?.removeEventListener('abort', onAbort);
    if (!state.outcome) controller.abort();
  }
}
