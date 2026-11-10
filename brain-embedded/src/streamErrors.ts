/**
 * The errors a Brain chat-completion stream fails with once a request is under way — split
 * out of `streamChatCompletion.ts`, which re-exports them, so the client stays the client.
 * A caller that routes around a failing model (`excludeModels` on a retry) tells them apart
 * by class: an interruption after the model committed, a transport failure before any
 * response, a decoding loop cut short.
 */

import type { StreamFailureDetail } from './streamFailureDetail';

/**
 * The stream broke AFTER the gateway committed to a model: an in-band `error` frame, or
 * the connection dropping mid-answer. The gateway can only fail over before it sends
 * headers, so from here the caller is the only one who can route around the model —
 * `model` is what it needs to do that (`excludeModels` on a retry). Before this, both
 * cases ended the stream as a clean, empty `stop`, and the agent run simply ended.
 */
export class StreamInterruptedError extends Error {
  readonly model: string | undefined;
  /** What the failed request looked like (destination, phase, elapsed, size) - for logs and triage. */
  readonly detail?: StreamFailureDetail;
  /**
   * The model was PICKED (named and held strictly) and stayed silent or dropped the connection - the only interruption
   * where "choose another model" is the right offer. Never set for an in-band provider error.
   */
  readonly pinned: boolean;
  constructor(message: string, model: string | undefined, detail?: StreamFailureDetail, options?: { pinned?: boolean }) {
    super(message);
    this.name = 'StreamInterruptedError';
    this.model = model;
    this.pinned = options?.pinned === true;
    if (detail) this.detail = detail;
  }
}

/**
 * A transport-level failure: the fetch itself threw (network error, DNS failure,
 * connection refused, timeout before response). This is distinct from the gateway
 * returning an HTTP error — that reaches us as a non-OK Response and maps through
 * `transport.mapError`. This catches the case where NO response was ever received.
 *
 * The caller retries these the same way as `StreamInterruptedError`: under auto-routing,
 * the turn is retried on another connected model. The model is unknown because the
 * failure happened BEFORE the gateway could commit to one.
 */
export class TransportError extends Error {
  readonly model: string | undefined;
  /**
   * The gateway could not be reached at all, and stayed unreachable through every
   * backoff retry. Another model cannot help — none was ever asked — so the caller
   * reports the outage instead of retrying.
   */
  readonly unreachable: boolean;
  /** As {@link StreamInterruptedError.pinned}. */
  readonly pinned: boolean;
  constructor(message: string, model: string | undefined = undefined, options?: { cause?: unknown; unreachable?: boolean; pinned?: boolean }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'TransportError';
    this.model = model;
    this.unreachable = options?.unreachable === true;
    this.pinned = options?.pinned === true;
  }
}

/** How much of a looped block the error message quotes. */
const LOOP_QUOTE_CHARS = 90;

/**
 * The model fell into a decoding loop — the same block of prose, verbatim, over and over
 * (`repetitionLoop.ts`). The stream is cut the moment it is seen instead of running to the
 * output ceiling while the reader watches one sentence repeat.
 *
 * An interruption like any other: the model is still answering, just uselessly, and only
 * the caller can route around it — so a caller that retries interrupted turns on another
 * model (the Brain run) does so here without knowing the difference. `kept` is what the
 * model said before it looped, for a caller that would rather show that than retry.
 */
export class RepetitionLoopError extends StreamInterruptedError {
  readonly kept: string;
  readonly block: string;
  readonly copies: number;
  // Structural, not `RepetitionLoop` by name: this class is published, and its
  // declaration must not reach into the source-only loop package for a type.
  constructor(loop: { block: string; copies: number; kept: string }, model: string | undefined) {
    const quote = loop.block.trim();
    const shown = quote.length > LOOP_QUOTE_CHARS ? `${quote.slice(0, LOOP_QUOTE_CHARS - 1).trimEnd()}…` : quote;
    super(`the model got stuck repeating itself (${loop.copies}× "${shown}")`, model);
    this.name = 'RepetitionLoopError';
    this.kept = loop.kept;
    this.block = loop.block;
    this.copies = loop.copies;
  }
}
