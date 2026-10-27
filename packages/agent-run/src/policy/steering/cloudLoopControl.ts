/**
 * Cooperative loop control — the two things a bounded, session-less loop must do
 * BETWEEN iterations so a human still has the wheel while it runs.
 *
 * Ported from `api/src/application/runtime/cloudLoopControl.ts` (WS2c, PRD 35 §4 row 2c)
 * with the Db- and subscriber-coupled halves extracted to ports, so the same contract
 * holds on every entry point:
 *
 *   • {@link applyPendingSteering} — drain the execution's pending user steers and
 *     splice them into the live message array as the next user turns, so a follow-up
 *     posted mid-run actually changes course instead of silently no-opping
 *     (GAP-S5). Each steer is recorded exactly once via the {@link SteerSink} port.
 *   • {@link startCancelWatcher} — a background poll of the (cross-isolate) cancel
 *     source that aborts the in-flight provider fetch the instant the run is
 *     cancelled, PLUS the between-iteration {@link CooperativeCancel.check} that
 *     stops the loop before it issues the next paid call (GAP-S6).
 *
 * Everything here is best-effort on telemetry (it can never break a run) but is
 * exact about the two contracts that matter: a steer is delivered exactly once,
 * and a cancelled run does not issue another paid call.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/** One turn of the loop's conversation array (the loose shape both surfaces use). */
export type LoopMessage = Record<string, unknown>;

/** Where a drained steer is recorded — the timeline event / trace the surface writes. */
export interface SteerSink {
  /**
   * Record one applied steer. `detail` carries the loop iteration when the surface
   * names one; `result` is the steer's leading text. Called exactly once per drained
   * steer, including one the caller's array already holds (it WAS applied).
   */
  record(steer: { text: string; detail?: Record<string, unknown>; result: string }): Promise<void> | void;
}

/**
 * Drain this execution's pending user steers and inject them as the next user
 * turns of `messages` (mutated in place — it IS the loop's conversation).
 *
 * Deduped against user turns already in the conversation: the container hands its
 * own loop state back on every op, so a steer it already adopted must not be
 * doubled. Each steer is drained exactly once regardless (the source stamps it
 * consumed), so the dedupe only protects against re-sending a turn the caller
 * already holds.
 *
 * Returns the steers that were drained (in the order the user sent them) — empty
 * when there were none.
 */
export async function applyPendingSteering(
  drain: () => Promise<string[]> | string[],
  sink: SteerSink | undefined,
  args: {
    /** The loop's live conversation. Injected turns are appended here. */
    messages: LoopMessage[];
    /** Loop iteration index, for the timeline event detail. */
    step?: number;
  },
): Promise<string[]> {
  const steers = await drain();
  if (steers.length === 0) return [];

  const present = new Set(
    args.messages
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string),
  );
  for (const steer of steers) {
    if (!present.has(steer)) {
      args.messages.push({ role: "user", content: steer });
      present.add(steer);
    }
    await sink?.record({
      text: steer,
      ...(args.step != null ? { detail: { step: args.step, text: steer } } : { detail: { text: steer } }),
      result: steer.slice(0, 280),
    });
  }
  return steers;
}

/** Default poll interval of the background cancel watcher. */
export const CANCEL_POLL_MS = 2000;

/**
 * A running loop's cancellation channel: an {@link AbortController} wired to a
 * background poll of the authoritative (cross-isolate) execution status, plus the
 * between-iteration check.
 */
export interface CooperativeCancel {
  /** Signal to thread into every provider fetch, so a cancel interrupts mid-call. */
  readonly controller: AbortController;
  /** True once cancellation has been observed by the watcher or by `check()`. */
  cancelled(): boolean;
  /**
   * Between-iteration guard: returns true when the loop must STOP before issuing
   * the next (paid) call. Re-reads the cancel source unless cancellation is already
   * known, and aborts the controller on the first observation.
   */
  check(): Promise<boolean>;
  /** Stop the background watcher. Idempotent; call on every terminal path. */
  stop(): void;
}

/**
 * Start the cooperative cancel channel for one loop.
 *
 * Two layers, both needed: the background poll aborts an in-flight completion the
 * instant the row flips to CANCELLED (so token spend stops mid-call rather than at
 * the end of the current step), and `check()` covers the gap BETWEEN steps (so a
 * cancel that lands while a tool is running never buys another turn). Together they
 * make cancel a true interrupt on a surface that has no live session to interrupt.
 */
export function startCancelWatcher(
  isCancelled: () => Promise<boolean>,
  opts?: { intervalMs?: number; sleep?: (ms: number) => Promise<void> },
): CooperativeCancel {
  const controller = new AbortController();
  const intervalMs = opts?.intervalMs ?? CANCEL_POLL_MS;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let observed = false;
  let stopped = false;

  const observe = (): void => {
    observed = true;
    if (!controller.signal.aborted) controller.abort();
  };

  // Fire-and-forget: the loop never awaits the watcher, it only reads `cancelled()`.
  void (async () => {
    while (!stopped && !observed) {
      await sleep(intervalMs);
      if (stopped || observed) break;
      let hit = false;
      try {
        hit = await isCancelled();
      } catch {
        // A transient read failure must not cancel a healthy run — try again next tick.
        hit = false;
      }
      if (hit) observe();
    }
  })();

  return {
    controller,
    cancelled: () => observed || controller.signal.aborted,
    async check(): Promise<boolean> {
      if (observed || controller.signal.aborted) {
        observe();
        return true;
      }
      let hit = false;
      try {
        hit = await isCancelled();
      } catch {
        hit = false;
      }
      if (hit) observe();
      return hit;
    },
    stop(): void {
      stopped = true;
    },
  };
}

/** The terminal reason a cooperatively-cancelled cloud run is closed out with — one
 *  string so the loop, the finalize and the tests all name it identically. */
export const CLOUD_RUN_CANCELLED_REASON = "Run cancelled before any output was produced.";
