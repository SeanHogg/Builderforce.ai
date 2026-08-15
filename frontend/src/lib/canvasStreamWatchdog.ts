import type { streamChatCompletion } from '@seanhogg/builderforce-brain-embedded';

/**
 * A TIME BOUND FOR ONE MODEL ROUND-TRIP.
 *
 * A canvas turn had none of any kind: the only thing that could end an in-flight
 * request was the user pressing Stop. Measured 2026-08-15 — a provider took 134 seconds
 * to return an empty completion, the loop dutifully asked it again, and the board sat on
 * "Reading" for four minutes behind a spinner with nothing to tell the user was wrong.
 *
 * Kept out of the turn runner because it is a transport concern, not a conversation one,
 * and because the runner is at the file-size ratchet's ceiling.
 */

/**
 * A provider that accepted the request and then went silent.
 *
 * A distinct type because the abort that ends it is OURS, not the user's. Both surface
 * from the fetch layer as an `AbortError`, and reporting a stall as "you pressed Stop"
 * would tell someone they cancelled a turn they were sitting waiting on.
 */
export class CanvasStreamStalledError extends Error {
  readonly code = 'canvas-stream-stalled' as const;
  constructor() {
    super('canvas-stream-stalled');
    this.name = 'CanvasStreamStalledError';
  }
}

/**
 * No token, and no completion, for this long.
 *
 * Generous, because a long authoring response legitimately streams for a while — but a
 * stream that has produced NOTHING for over a minute is not slow, it is gone.
 */
export const CANVAS_STREAM_STALL_MS = 75_000;

type StreamRequest = Parameters<typeof streamChatCompletion>[0];
type StreamResult = Awaited<ReturnType<typeof streamChatCompletion>>;

/**
 * One model round-trip, bounded by INACTIVITY rather than by total duration.
 *
 * The timer is re-armed by every token, so length is never punished — only silence is.
 * The caller's own signal is chained through so Stop keeps working exactly as before,
 * and is re-checked when the request rejects so a user stop is never misreported as a
 * stall.
 */
export async function streamBoundedByActivity(
  stream: typeof streamChatCompletion,
  request: StreamRequest,
  onTextDelta: (delta: string) => void,
  userSignal: AbortSignal | undefined,
): Promise<StreamResult> {
  const controller = new AbortController();
  const stopRun = () => controller.abort();
  userSignal?.addEventListener('abort', stopRun);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(stopRun, CANVAS_STREAM_STALL_MS);
  };
  arm();
  try {
    return await stream({ ...request, signal: controller.signal }, {
      onTextDelta: (delta) => { arm(); onTextDelta(delta); },
    });
  } catch (error) {
    if (userSignal?.aborted) throw error;
    if (controller.signal.aborted) throw new CanvasStreamStalledError();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    userSignal?.removeEventListener('abort', stopRun);
  }
}
