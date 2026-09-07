import { CanvasStreamStalledError } from '@/lib/canvasStreamWatchdog';

/**
 * The two ways a Canvas turn can end WITHOUT being a failure, as types rather
 * than as strings.
 *
 * Split out of `creationCanvasAi.ts` because the surfaces that need to tell these
 * apart are not the surface that runs the loop: `modelComparison.ts` catches
 * `GuestAiUnavailableError` without ever calling the runner, and importing the
 * whole turn engine (its prompt stack, its brain transports, the guest career
 * catalogue) to read one `instanceof` is the coupling that made the module a
 * grab-bag in the first place. One reason to change lives here — what "stopped"
 * and "no guest token" mean — and nothing in this file reaches the network.
 */

/**
 * A guest turn could not start because no guest token could be obtained. Thrown
 * as a TYPE rather than a message so the surface can say it in the visitor's own
 * language — this path is reachable from the public landing canvas, where a raw
 * English string would be the first thing the product ever says to them.
 */
export class GuestAiUnavailableError extends Error {
  readonly code = 'guest-ai-unavailable' as const;
  constructor() {
    super('guest-ai-unavailable');
    this.name = 'GuestAiUnavailableError';
  }
}

/**
 * The user pressed Stop. Thrown (never returned) so a stopped turn can never be
 * mistaken for an answer, and typed so the canvas records "you stopped this"
 * instead of the red failure notice a real error earns.
 */
export class CanvasRunAbortedError extends Error {
  readonly code = 'canvas-run-aborted' as const;
  constructor() {
    super('canvas-run-aborted');
    this.name = 'CanvasRunAbortedError';
  }
}

/**
 * True for every shape a stopped run can arrive in: our own typed error, and the
 * `AbortError` the fetch layer rejects the streaming request with when the signal
 * fires mid-stream. One predicate, so no surface has to know both.
 */
export function isCanvasRunAborted(error: unknown): boolean {
  if (error instanceof CanvasRunAbortedError) return true;
  if (error instanceof CanvasStreamStalledError) return false;
  return error instanceof Error && error.name === 'AbortError';
}
