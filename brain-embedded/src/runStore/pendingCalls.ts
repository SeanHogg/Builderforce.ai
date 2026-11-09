/**
 * What each in-flight tool call carries from its preflight / dispatch to its post step, keyed by the call's id.
 *
 * The kernel's D8 lever runs every `beforeDispatch` of a read-only batch, dispatches the batch concurrently, then settles each call
 * in order (`@builderforce/agent-loop` `loop.ts`). ONE per-run slot for "the call in flight" cannot survive that: each preflight
 * cleared it and each dispatch overwrote it, so with two parallel reads the trace recorded b.ts's content under `read_file{a.ts}`,
 * the read cache stored b's content under a's key, and a cache-replayed read in the batch lost its record. Every entry here is
 * the call's own: preflight, dispatch and post step for call X touch only X's entry.
 *
 * It also knows which calls are still RUNNING, so the live step falls back to a sibling that is still running when one call ends
 * and reads "between turns" only once the last one has returned.
 */

import type { BrainRunActivity } from '../runActivity';

/** A replayed read waits for its row to be pushed so the cache can anchor to it. */
export interface PendingReplay { name: string; args: unknown; result: unknown; served?: unknown }

/** What dispatch learned about the call it ran — for the durable step + the read cache. `served` is the `read_file` window the
 *  model was handed (before the advisory), which read coverage records instead of the untrimmed `out`. */
export interface PendingRun { out: unknown; toolStart: number; isReadTool: boolean; threw: boolean; bytes?: number; truncated?: boolean; served?: unknown }

export type PendingCall = { kind: 'replay'; replay: PendingReplay } | { kind: 'ran'; ran: PendingRun };

export class PendingCalls {
  private readonly byCall = new Map<string, PendingCall>();
  /** The live step of each call whose tool is running now, in the order they started. */
  private readonly running = new Map<string, BrainRunActivity>();

  /** A call's preflight starts it clean: nothing a former call with the same id left behind can be read as its own. */
  forget(callId: string): void {
    this.byCall.delete(callId);
  }

  replayed(callId: string, replay: PendingReplay): void {
    this.byCall.set(callId, { kind: 'replay', replay });
  }

  ran(callId: string, ran: PendingRun): void {
    this.byCall.set(callId, { kind: 'ran', ran });
  }

  /** The call's entry, removed — read exactly once, by its post step. */
  take(callId: string): PendingCall | undefined {
    const entry = this.byCall.get(callId);
    this.byCall.delete(callId);
    return entry;
  }

  /** The call's tool started running with `activity` as its live step. */
  begin(callId: string, activity: BrainRunActivity): void {
    this.running.delete(callId);
    this.running.set(callId, activity);
  }

  /** The call's tool returned. The live step of the most recently started sibling still running, or undefined when none is. */
  end(callId: string): BrainRunActivity | undefined {
    this.running.delete(callId);
    let latest: BrainRunActivity | undefined;
    for (const activity of this.running.values()) latest = activity;
    return latest;
  }
}
