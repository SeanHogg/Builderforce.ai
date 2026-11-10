/**
 * The background indexer's budgets and pause rules (PRD 41 B6, Risks "background indexing slows typing") — pure:
 *
 *   - work runs in slices of at most {@link SLICE_MS}, handing the event loop back between slices;
 *   - a keystroke pauses the queue until the person has stopped typing for {@link TYPING_QUIET_MS};
 *   - the window unfocused for {@link UNFOCUSED_PAUSE_MS} pauses it until focus returns;
 *   - L3 (the analyzers) runs only when idle AND on mains power; with the power source unknown, only after
 *     {@link L3_IDLE_UNKNOWN_MS} of idle; on battery never (§12.3).
 */

import type { PowerState } from "../power/powerSource";
import type { IndexPauseReason } from "./indexLevels";

/** Watcher events settle this long before they are queued (B2 step 5). */
export const COALESCE_MS = 100;
/** One slice of indexing work, at most. */
export const SLICE_MS = 50;
/** Quiet after the last keystroke before the queue resumes. */
export const TYPING_QUIET_MS = 750;
/** Unfocused this long, the indexer pauses until focus returns. */
export const UNFOCUSED_PAUSE_MS = 10 * 60_000;
/** A long pass (the whole-tree L1 map) starts only after this much quiet. */
export const LONG_PASS_IDLE_MS = 2_000;
/** Idle needed before L3 starts on mains power. */
export const L3_IDLE_MAINS_MS = 30_000;
/** Idle needed before L3 starts when the power source is unknown (B6). */
export const L3_IDLE_UNKNOWN_MS = 120_000;
/** Most files one slice takes, whatever the measured speed. */
export const MAX_SLICE_FILES = 64;
/** A watcher batch larger than this (a branch switch, a formatter over the tree) goes to the reconcile + map pass, not the per-file path. */
export const BULK_EDIT_FILES = 100;
/** Reconciles asked for by files the manifest does not know run at most this often. */
export const UNKNOWN_RECONCILE_MS = 30_000;
/**
 * A person's preemption holds background passes off until it is released (their review took its own hold, or ended); one
 * never released expires after this long, so a failed caller cannot stall the indexer for good.
 */
export const PREEMPT_HOLD_MAX_MS = 10 * 60_000;
/** Longest an indexer's first write on a root waits for the live view's own watcher batch still in flight. */
export const LIVE_IDLE_WAIT_MS = 5_000;

/** Whether L3 may start: never on battery; on mains after {@link L3_IDLE_MAINS_MS} idle; unknown after {@link L3_IDLE_UNKNOWN_MS}. */
export function mayRunL3(power: PowerState, idleForMs: number): boolean {
  if (power === "battery") return false;
  return idleForMs >= (power === "mains" ? L3_IDLE_MAINS_MS : L3_IDLE_UNKNOWN_MS);
}

/** Files the next slice takes so it fits in {@link SLICE_MS}, from the measured ms per file (unknown ⇒ one file). */
export function nextSliceSize(msPerFile: number | undefined): number {
  if (msPerFile === undefined || !Number.isFinite(msPerFile)) return 1;
  if (msPerFile <= 0) return MAX_SLICE_FILES;
  return Math.max(1, Math.min(MAX_SLICE_FILES, Math.floor(SLICE_MS / msPerFile)));
}

/** Timers the indexer uses: injected so tests run on fake time. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * What the person is doing, as the pause rules read it. `onChange` is told whenever the pause state may have changed
 * (typing stopped, focus returned), so a waiting queue resumes.
 */
export class ActivityGate {
  private lastActivity: number;
  private typingTimer: unknown;
  private unfocusedTimer: unknown;
  private typing = false;
  private unfocused = false;

  constructor(private readonly clock: Clock, private readonly onChange: () => void) {
    this.lastActivity = clock.now();
  }

  /** A text document changed by the person: the queue yields until typing stops. */
  keystroke(): void {
    this.activity();
    this.typing = true;
    if (this.typingTimer !== undefined) this.clock.clearTimeout(this.typingTimer);
    this.typingTimer = this.clock.setTimeout(() => {
      this.typingTimer = undefined;
      this.typing = false;
      this.onChange();
    }, TYPING_QUIET_MS);
  }

  /** Any other sign of the person (a selection, an editor switch): not idle, but nothing pauses. */
  activity(): void {
    this.lastActivity = this.clock.now();
  }

  focus(focused: boolean): void {
    if (this.unfocusedTimer !== undefined) { this.clock.clearTimeout(this.unfocusedTimer); this.unfocusedTimer = undefined; }
    if (focused) {
      this.activity();
      const was = this.unfocused;
      this.unfocused = false;
      if (was) this.onChange();
      return;
    }
    this.unfocusedTimer = this.clock.setTimeout(() => {
      this.unfocusedTimer = undefined;
      this.unfocused = true;
      this.onChange();
    }, UNFOCUSED_PAUSE_MS);
  }

  pausedBy(): IndexPauseReason | undefined {
    if (this.typing) return "typing";
    if (this.unfocused) return "unfocused";
    return undefined;
  }

  idleForMs(): number {
    return Math.max(0, this.clock.now() - this.lastActivity);
  }

  dispose(): void {
    if (this.typingTimer !== undefined) this.clock.clearTimeout(this.typingTimer);
    if (this.unfocusedTimer !== undefined) this.clock.clearTimeout(this.unfocusedTimer);
    this.typingTimer = this.unfocusedTimer = undefined;
  }
}
