/**
 * What a run store OBSERVER reads: the live snapshot of one chat's run ({@link BrainRunSnapshot}), the engine-hosted turn it
 * narrates ({@link RunTurn}) and the cross-chat live indicator ({@link GlobalRunState}). Types only; what a host HANDS a run is in
 * `runTypes.ts`.
 */

import type { BrainMessage } from '../types';
import type { BrainTraceEvent } from '../brainTriage';
import type { ChatErrorAction } from '../chatError';
import type { BrainRunActivity } from '../runActivity';

/** Live, observable snapshot of a chat's run (what the hook renders). */
export interface BrainRunSnapshot {
  running: boolean;
  streamingText: string;
  error: string;
  /**
   * What the user can DO about {@link error}, when the failure was actionable —
   * an expired session (reconnect), a plan that doesn't cover the request
   * (upgrade), or billing that needs a card (validate_card). Derived ONCE here
   * from the thrown error's structured gateway fields via {@link chatErrorAction},
   * so a mounted view renders the right button without re-parsing error prose.
   * Null when nothing but dismissing applies.
   */
  errorAction: ChatErrorAction | null;
  pendingConfirm: { name: string; args: unknown } | null;
  /** Bumped whenever a new assistant message is persisted. */
  messagesEpoch: number;
  /**
   * Every assistant message this run has persisted, in order (narration turns +
   * the final answer). Delivered as a list — not a single "last" value — so a
   * mounted view merges them all by id even when React coalesces the rapid
   * mid-run emits into one render and never sees the intermediate snapshots.
   */
  appended: BrainMessage[];
  hasTrace: boolean;
  /**
   * The live execution trace (LLM turns + tool calls + errors), in order. The
   * same array `getRunTrace` returns — exposed on the snapshot so a mounted view
   * (e.g. the timeline transcript) can render each step AS IT HAPPENS. Each
   * `pushTrace` publishes a NEW array (copy-on-write), so a consumer may key a
   * memo or effect on it. Bounded by {@link MAX_TRACE_EVENTS}.
   */
  trace: BrainTraceEvent[];
  /**
   * What the run is doing RIGHT NOW — the in-flight step, published as it is
   * ENTERED rather than when it settles. The `trace` records a step only once it
   * has completed, which is the wrong moment for a progress indicator: a search
   * that takes a minute emits nothing at all until it is over, so a working agent
   * and a hung one look identical. Null while idle. See `runActivity.ts`.
   */
  activity: BrainRunActivity | null;
  /**
   * Providers the tenant CONNECTED but the gateway could NOT resolve on any turn of
   * this run (from `x-builderforce-byo-unresolved`) — e.g. a connected Claude
   * subscription whose token expired, so the run silently used the shared pool
   * instead of the tenant's own Opus. A mounted view shows a passive "reconnect your
   * account" banner off this, so the degrade is visible WITHOUT copying triage. Empty
   * when everything resolved (or nothing is connected).
   */
  byoUnresolved: string[];
  /**
   * BYO providers whose key hit a usage/capacity cap on any turn of this run
   * (from `x-builderforce-provider-cap`) — e.g. the tenant's Anthropic key hit its
   * monthly spend limit, or Meta MUSE quota was exhausted. A mounted view shows a
   * "manage your API keys" banner so the user knows to top up or switch providers.
   * Accumulated across turns; reset fresh each run. Empty when no cap was hit.
   */
  providerCap: string[];
  /**
   * The engine-hosted turn being narrated ({@link RunTurn}) — null for chat runs, while
   * idle, and from the instant Stop is pressed: a surface stops saying "working" at once
   * while `running` stays true until the aborted loop has actually unwound.
   */
  turn: RunTurn | null;
}

/**
 * An engine-hosted turn as its surfaces narrate it. Held on the CELL rather than by the
 * component that started it, so a remounted surface still has the elapsed clock and
 * Stop still records against the turn.
 */
export interface RunTurn {
  /** The id the host correlates the turn by (`RunEngineControl.correlate`), once known. */
  id: string | null;
  /** Wall-clock start (ms). */
  startedAt: number;
}

/**
 * A snapshot of which CHATS (numeric run keys) are live right now, split by whether they are actively
 * executing (`running`) or paused on a human-in-the-loop confirm (`awaiting` — the
 * actionable one: the loop cannot proceed until the user answers). The two lists
 * are disjoint (an awaiting chat is omitted from `running`).
 */
export interface GlobalRunState {
  running: number[];
  awaiting: number[];
}
