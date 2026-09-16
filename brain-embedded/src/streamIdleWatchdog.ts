/**
 * A dead stream has to END, not hang.
 *
 * `reader.read()` on a stalled upstream never settles: the socket is open, the gateway
 * is waiting on a provider that will never speak again, and the agent loop waits with
 * it — forever, or until the user presses Stop. Chat #113 sat on one turn for 3m 23s
 * (that one was alive, streaming tool arguments), and the same picture with a genuinely
 * dead upstream is indistinguishable from the outside. A turn that stops producing
 * bytes must fail, so the run loop can do what it already knows how to do with an
 * interrupted stream: retry once on another model.
 *
 * This is the whole mechanism: race each read against an idle timer, cancel the reader
 * when the timer wins, and throw. Isolated from `streamChatCompletion.ts` so it can be
 * tested with fake timers instead of a live socket, and so there is exactly ONE idle
 * rule in the package.
 */

/**
 * Silence that ends a stream. Deliberately generous: a reasoning model can think for
 * minutes before its first token, and a false positive costs a wasted turn on another
 * model. Four minutes of ZERO bytes is not thinking, it is a dead connection.
 */
export const STREAM_IDLE_MS = 240_000;

/** The stream produced no bytes for {@link IdleWatchdogOptions.idleMs}. */
export class StreamIdleError extends Error {
  /** The silence that was exceeded, so the caller can say it in its own message. */
  readonly idleMs: number;
  constructor(idleMs: number) {
    super(`the stream produced no bytes for ${Math.round(idleMs / 1000)}s`);
    this.name = 'StreamIdleError';
    this.idleMs = idleMs;
  }
}

/** The slice of `ReadableStreamDefaultReader` this needs — structural, so a test
 *  passes a plain object and a browser passes the real reader. */
export interface IdleWatchdogReader<T> {
  read(): Promise<T>;
  cancel(reason?: unknown): Promise<unknown> | unknown;
}

export interface IdleWatchdogOptions {
  /** Silence before the read is abandoned. Defaults to {@link STREAM_IDLE_MS}. */
  idleMs?: number;
  /** Observer for the idle trip (a trace line, a metric). Never throws the error itself. */
  onIdle?(idleMs: number): void;
}

/**
 * One `reader.read()`, bounded by an idle timer. Resolves with the chunk when the
 * stream speaks; cancels the reader and throws {@link StreamIdleError} when it does not.
 *
 * The losing `read()` promise is left pending on purpose — cancelling the reader is what
 * releases it — with its rejection swallowed so an aborted socket cannot surface as an
 * unhandled rejection after the caller has already been told the stream went silent.
 */
export async function readWithIdleWatchdog<T>(
  reader: IdleWatchdogReader<T>,
  opts: IdleWatchdogOptions = {},
): Promise<T> {
  const idleMs = opts.idleMs ?? STREAM_IDLE_MS;
  const read = reader.read();
  if (!Number.isFinite(idleMs) || idleMs <= 0) return read;
  read.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject BEFORE cancel. A WHATWG reader resolves a pending `read()` as
      // `{ done: true }` when cancelled, and Promise.race would treat that
      // clean EOF as a finished stream if it won the race.
      const error = new StreamIdleError(idleMs);
      opts.onIdle?.(idleMs);
      reject(error);
      try {
        const cancelled = reader.cancel(error);
        if (cancelled && typeof (cancelled as Promise<unknown>).catch === 'function') {
          (cancelled as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        // A reader that refuses to cancel still must not swallow the verdict.
      }
    }, idleMs);
  });

  try {
    return await Promise.race([read, idle]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
