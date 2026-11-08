/**
 * The host CLAIM WINDOW for a pinned On-Prem dispatch.
 *
 * `dispatchToAgentHost` awaits the host relay's answer with no deadline of its own, so a
 * wedged relay or a half-open host socket would hold the submit request open and the
 * run would never fall back to the cloud executor. This bounds it: the host has
 * {@link HOST_CLAIM_WINDOW_MS} to acknowledge; past that the dispatch counts as NOT
 * delivered and the caller proceeds exactly as it does for an offline host.
 *
 * A host that acks late has already received the frame, so on timeout the run is also
 * withdrawn from it (`onTimeout`, best-effort) - otherwise the same execution could run
 * on the machine AND in the cloud. The withdraw is itself a relay call that can hang, so
 * it never holds the dispatch: it is handed to `waitUntil` when the caller has an
 * execution context, and otherwise raced against {@link WITHDRAW_TIMEOUT_MS}.
 *
 * This bounds the HOST leg only. It is not the dispatch -> CloudRunnerDO start timeout.
 */

/** Milliseconds the pinned host has to acknowledge a dispatch before the cloud executor takes over. */
export const HOST_CLAIM_WINDOW_MS = 10_000;

/** Milliseconds the dispatch will wait for the withdraw when it has no `waitUntil` to hand it to. */
export const WITHDRAW_TIMEOUT_MS = 2_000;

export interface ClaimWindowOptions {
  windowMs?: number;
  /** Called once when the window expires without an ack - withdraw the run from the host. */
  onTimeout?: () => Promise<unknown>;
  /** The request's execution context. When present the withdraw runs past the response. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Bound on the in-line wait for the withdraw when there is no `waitUntil`. */
  withdrawTimeoutMs?: number;
}

/** Start the withdraw and never let it block: background it, or wait at most a short bound. */
async function withdrawWithoutBlocking(opts: ClaimWindowOptions): Promise<void> {
  const withdraw = (async () => opts.onTimeout?.())().catch(() => undefined);
  if (opts.waitUntil) {
    opts.waitUntil(withdraw);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, opts.withdrawTimeoutMs ?? WITHDRAW_TIMEOUT_MS);
  });
  try {
    await Promise.race([withdraw, bound]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Race `deliver()` against the claim window. Resolves `true` only when the host acked in
 * time; `false` on offline, on a delivery error, or on timeout.
 */
export async function deliverWithinClaimWindow(
  deliver: () => Promise<boolean>,
  opts: ClaimWindowOptions = {},
): Promise<boolean> {
  const windowMs = opts.windowMs ?? HOST_CLAIM_WINDOW_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), windowMs);
  });
  try {
    const outcome = await Promise.race([deliver().catch(() => false), timeout]);
    if (outcome === 'timeout') {
      await withdrawWithoutBlocking(opts);
      return false;
    }
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
