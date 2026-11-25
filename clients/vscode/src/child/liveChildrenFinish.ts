/**
 * The run's LIVE-CHILDREN finish hold (`BrainRunRequest.liveChildren`, bound in `brainRunHost.ts` through
 * `ownerFinishHold`): what an owner run is told when it tries to end - in prose or through `finish` - while sub-agents it
 * started are still working.
 *
 * Without it the owner ended, and each report that came in afterwards woke it into a new run with no ask of its own
 * (chats #60338 and #61651: wake runs with an empty ask spent 16 and more model turns).
 *
 * The hold has an exit, so it can never burn the owner's turns to the budget:
 *   - a child the owner (or the person) already asked to stop is unwinding, not working: it does not hold the finish, and
 *     its late report does not wake the owner (`childRunSpawner.ts`);
 *   - a child that makes NO progress across {@link MAX_STALLED_HOLDS} holds in a row is hung: the hold stops it and lets
 *     the owner finish, with a note naming who was stopped. Any progress of any held child starts the count again.
 *
 * Pure: the host passes the ports (`ChildRuns.liveOf`, `stopRequested`, a progress token per child, the stop).
 */

import { SUBAGENT_CONTROL_TOOL_NAMES } from "@builderforce/agent-tools";

/** Holds in a row with no progress from any held child before the hold stops them and lets the owner finish. */
export const MAX_STALLED_HOLDS = 3;

/** A live child as the hold sees it. */
export interface HeldChild {
  key: number;
  handle: string;
}

export interface LiveChildrenHoldPorts {
  /** The owner's children still running (stop-requested ones included — the hold leaves those out itself). */
  live(): ReadonlyArray<HeldChild>;
  /** Whether a stop was already asked for this child. */
  stopRequested(key: number): boolean;
  /** A token that changes whenever the child does something (a trace step, streamed text). */
  progress(key: number): string;
  /** Stop these children (they are hung). */
  stop(children: ReadonlyArray<HeldChild>): void;
  /** Record why the hold let the owner finish anyway. Best-effort. */
  released?(children: ReadonlyArray<HeldChild>, holds: number): void;
}

/** The block reason, or null when no child of this owner is live. */
export function liveChildrenBlock(live: ReadonlyArray<{ handle: string }>): string | null {
  if (live.length === 0) return null;
  const handles = live.map((child) => child.handle).join(", ");
  const { wait, stop } = SUBAGENT_CONTROL_TOOL_NAMES;
  return (
    `Do not finish yet: ${live.length} sub-agent${live.length === 1 ? " you started is" : "s you started are"} still working (${handles}). `
    + `Call ${wait} for their reports, or ${stop} for any you no longer need, then finish with what they found.`
  );
}

/** What the owner is told when the hold gave up on hung children. */
export function hungChildrenNote(children: ReadonlyArray<{ handle: string }>, holds: number): string {
  return `Stopped ${children.map((c) => c.handle).join(", ")}: no progress across ${holds} finish holds. The run finished without their reports.`;
}

/**
 * One owner run's finish hold: the `liveChildren` port. State is per run (the stalled-hold count), so the host builds one
 * per run it starts.
 */
export function createLiveChildrenHold(ports: LiveChildrenHoldPorts, maxStalled = MAX_STALLED_HOLDS): () => Promise<string | null> {
  let last: string | null = null;
  let stalled = 0;
  return async () => {
    const held = ports.live().filter((child) => !ports.stopRequested(child.key));
    if (held.length === 0) {
      last = null;
      stalled = 0;
      return null;
    }
    const fingerprint = held.map((child) => `${child.key}=${ports.progress(child.key)}`).join("|");
    if (fingerprint !== last) {
      last = fingerprint;
      stalled = 1;
      return liveChildrenBlock(held);
    }
    if (stalled < maxStalled) {
      stalled += 1;
      return liveChildrenBlock(held);
    }
    // Hung: stopped, and the owner finishes - with a note, never silently.
    ports.stop(held);
    ports.released?.(held, stalled);
    last = null;
    stalled = 0;
    return null;
  };
}
