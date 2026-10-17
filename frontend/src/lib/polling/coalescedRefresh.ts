/**
 * Many "changed" frames, one fetch.
 *
 * A relay pushes a `changed` frame per mutation, and a burst (a Brain turn writing
 * a dozen timeline rows, a collaborator dragging a card) used to cost one API
 * round-trip PER FRAME — each of which reaches the database. This merges them:
 *
 *   • the first frame opens a short window; frames inside it ride along, so a burst
 *     costs one fetch and the latency is bounded by the window (a steady stream
 *     cannot starve it the way a resetting debounce would);
 *   • at most one fetch is in flight; frames that land during it earn exactly ONE
 *     follow-up, and none at all if nothing arrived.
 *
 * `run` may be async; a rejection is reported, never thrown (the caller's poll is the
 * backstop that catches the view up).
 */
import { reportBackgroundFailure } from '../reportError';

/** Long enough to merge a burst, short enough to still read as live. */
export const COALESCE_WINDOW_MS = 400;

export interface CoalescedRefresh {
  /** A frame arrived: make sure one fetch covers it. */
  trigger(): void;
  /** Stop: drop the pending window and any follow-up. */
  cancel(): void;
}

export function createCoalescedRefresh(run: () => unknown, windowMs: number = COALESCE_WINDOW_MS): CoalescedRefresh {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let dirty = false;
  let cancelled = false;

  const arm = () => {
    if (timer || cancelled) return;
    timer = setTimeout(() => { timer = null; void fire(); }, windowMs);
  };

  const fire = async () => {
    if (cancelled) return;
    inFlight = true;
    dirty = false;
    try {
      await run();
    } catch (cause) {
      // Best-effort: the next frame or the poll catches up — but the failure is recorded.
      void reportBackgroundFailure({ message: `coalesced refresh failed: ${String(cause)}`, level: 'warning' });
    } finally {
      inFlight = false;
    }
    if (dirty) arm();
  };

  return {
    trigger() {
      if (cancelled) return;
      if (inFlight) { dirty = true; return; }
      arm();
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
