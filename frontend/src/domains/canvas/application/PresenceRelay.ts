/**
 * PRESENCE RELAY — this client's pointer, viewport, selection and typing state,
 * put on the wire at a rate the wire can carry.
 *
 * ── WHY IT IS ITS OWN USE CASE ───────────────────────────────────────────────
 * PRD 22 §3.4 lists `sendPresence` alongside the sharing callbacks, and it was
 * indeed one more closure inside `CanvasInner`. But it is a DIFFERENT mechanism
 * from `ShareCanvasSession`: that one syncs the BOARD through a guest room for
 * an account-less session, this one syncs EPHEMERAL state through the live relay
 * of a server session. They share no state and no transport, so folding them
 * into one module would be a file named after two things.
 *
 * ── THE RULE THIS FILE EXISTS FOR ────────────────────────────────────────────
 * The throttle COALESCES rather than drops. A pointer move inside the window is
 * remembered and flushed at the end of it. Dropping instead leaves everyone
 * else's cursor stopped wherever the last frame happened to land whenever
 * someone moves fast and then stops — which is precisely when a cursor is being
 * watched. That rule was three `if`s over a mutable ref inside a 13,000-line
 * component; it is now a unit with a clock you can advance by hand.
 *
 * ── THE BUG THE MOVE SURFACED ────────────────────────────────────────────────
 * The window started at `0` and was compared against `Date.now()`, so "have we
 * sent recently" was really "is the epoch more than 50ms old" — always true, and
 * the first frame went out for the right answer by accident. The moment the
 * clock became injectable that accident stopped holding, which is the ordinary
 * way an untestable rule turns out to have been untested rather than correct.
 * The window now starts at `-Infinity`, which is what it always meant.
 *
 * Teardown moved with it. The canvas cleared the pending timer in the socket
 * effect's cleanup, reaching into a ref's internals to do it;
 * {@link PresenceRelay.dispose} is that same teardown as something the relay
 * owns, so a second caller cannot forget the half it does not know about.
 */

import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';

/**
 * Where a presence frame goes.
 *
 * `deliver` returns whether it went. Silence is CORRECT when the channel is not
 * open — the 8-second presence poll is the fallback and carries the cursor on
 * its own — so a closed socket is an ordinary state here, not an error.
 */
export interface PresenceTransport {
  deliver(state: CanvasPresenceState): boolean;
}

/**
 * Time and timers, injected.
 *
 * Not because the browser's are wrong, but because a coalescing throttle is
 * entirely a statement about WHEN, and a test that cannot move time can only
 * assert that something eventually happened.
 */
export interface PresenceClock {
  now(): number;
  schedule(run: () => void, delayMs: number): number;
  cancel(handle: number): void;
}

export const browserPresenceClock: PresenceClock = {
  now: () => Date.now(),
  schedule: (run, delayMs) => window.setTimeout(run, delayMs),
  cancel: (handle) => window.clearTimeout(handle),
};

export interface PresenceRelay {
  /** Publish this state, now or at the end of the current window. */
  send(state: CanvasPresenceState): void;
  /** Drop anything pending. Called when the relay goes down or the board closes. */
  dispose(): void;
}

export function createPresenceRelay(
  transport: PresenceTransport,
  { intervalMs, clock = browserPresenceClock }: { intervalMs: number; clock?: PresenceClock },
): PresenceRelay {
  /**
   * `-Infinity` rather than `0`, so the FIRST frame always goes out whatever
   * epoch the clock counts from. With `Date.now()` a zero start is effectively
   * -infinity and the distinction never showed; with any other clock — a test's,
   * a `performance.now()` — a zero start reads as "just sent" and swallows the
   * first frame of every session.
   */
  let sentAt = -Infinity;
  let pending: CanvasPresenceState | null = null;
  let timer: number | null = null;

  const flush = (state: CanvasPresenceState) => {
    pending = null;
    // A frame the channel refused did not consume the window. Advancing anyway
    // would make the first frame after a reconnect wait out an interval it
    // already spent offline.
    if (transport.deliver(state)) sentAt = clock.now();
  };

  return {
    send(state) {
      const waited = clock.now() - sentAt;
      // Outside the window with nothing queued: this frame goes straight out,
      // which is what makes a slow drag feel immediate rather than sampled.
      if (waited >= intervalMs && timer == null) { flush(state); return; }
      // Inside the window: MERGE, so a cursor move and a typing flag arriving
      // 5ms apart both survive to the flush instead of the later one winning.
      pending = { ...pending, ...state };
      if (timer != null) return;
      timer = clock.schedule(() => {
        timer = null;
        if (pending) flush(pending);
      }, Math.max(0, intervalMs - waited));
    },
    dispose() {
      if (timer != null) clock.cancel(timer);
      timer = null;
      pending = null;
    },
  };
}
