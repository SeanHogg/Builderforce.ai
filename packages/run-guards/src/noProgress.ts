/**
 * The NO-PROGRESS window: turns in a row that touched no file the run had not already
 * touched, made no change it had not already made, and changed nothing about its tests.
 *
 * Every other guard here watches one call shape (a repeated read, a repeated failure, a
 * repeated write, an edit undone). A run can avoid all of them and still be going
 * nowhere: it rotates between the same three files with slightly different arguments,
 * re-runs a check that keeps answering the same thing, and narrates. What such a run
 * never does is reach NEW ground or move its tests — so that is what this counts.
 *
 * Progress, per turn, is one of three kinds:
 *  - GROUND: a call naming a path the run had not touched before (read or write —
 *    exploring new files IS progress), a write to a test file, a check/test run whose
 *    result differs from the last one, or an external-side-effect call the host counts
 *    as platform progress (a ticket update, a dispatch). Ground always counts and
 *    clears the churn count.
 *  - RE-GROUND: a read of a DISTINCT path the run had already seen but not recently —
 *    spaced revisits across a wide survey are re-engagement, not circling. A run that
 *    revisits an old target is on a new trail; {@link VisitTally} already catches the
 *    true circling case (one target read repeatedly in a tight window).
 *  - CHURN: only a SUCCESSFUL change the run has not made before (a file edit or a
 *    mutating shell command, fingerprinted by tool plus arguments). A distinct edit to a
 *    known file is progress for up to {@link CHURN_TURNS} turns in a row; past that, a
 *    run that only varies its arguments (a one-character drift, `echo $(date)`) is
 *    going nowhere and the turn is idle. Replaying an identical change, or flipping
 *    between two versions, is never progress (`edit_revert` names the oscillation).
 * A turn with none of them is idle; {@link NO_PROGRESS_TURNS} idle turns in a row trip it.
 * Pure; the state is plain JSON.
 */
import { callFingerprint, contentHash, pathArgOf } from "./fingerprint.js";

/** Idle turns in a row that count as no progress (no new path, no change the run had not
 *  already made, no test movement). Four is past an honest "read, think,
 *  re-read, decide" pause and short of a run that has burned its budget circling. */
export const NO_PROGRESS_TURNS = 4;

/** Consecutive churn-only turns allowed before churn stops counting: long enough for a
 *  real multi-edit pass over known files, short of endless argument drift. */
export const CHURN_TURNS = 12;

/** Re-engagement window: reading a path again counts as progress when the read is the
 *  first in this many turns — spaced revisits across a wide survey are re-engagement,
 *  not circling (the true circling case is one target read repeatedly in a tight window,
 *  which {@link VisitTally} already catches). */
export const REGROUND_TURNS = 8;

/** Paths (and, separately, change fingerprints) remembered — enough for a real run, small enough for durable state; beyond it
 *  the oldest are dropped (a path forgotten that long ago is fair to count as new). */
const MAX_SEEN = 500;

const TEST_PATH = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$/i;
const TEST_COMMAND = /\b(test|tests|vitest|jest|pytest|mocha|tsc|tsgo|typecheck|lint|eslint|cargo\s+test|go\s+test)\b/i;

export interface NoProgressState {
  seen: string[];
  idleTurns: number;
  /** The turn index each path was last read on, so a spaced revisit is re-engagement,
   *  not circling ({@link REGROUND_TURNS}). Absent in an older snapshot (no re-engagement). */
  lastSeenAt?: Record<string, number>;
  /** Fingerprints of the successful changes made so far, so a replayed change is not
   *  progress. Absent in an older snapshot. */
  changes?: string[];
  /** Consecutive turns whose only progress was churn; a ground turn clears it, a trip does not. Absent when 0. */
  churnTurns?: number;
  /** The last check/test result digest, so an unchanged re-run is not progress. */
  lastCheck?: string;
}

export interface NoProgressPorts {
  /** The path a call is about. Default: its `path` argument. */
  targetOf?(tool: string, args: unknown): string | null;
  /** A call that runs checks or tests. Default: `run_checks` / `run_tests`, or a shell command that names a test/lint/type-check runner. */
  isCheckCall?(tool: string, args: unknown): boolean;
  /**
   * A non-file call with an external side effect the host counts as progress — a ticket
   * created/updated, a dispatch, a message sent. Default: none. A run reconciling board
   * state, closing tickets or dispatching agents is advancing the work, not spinning;
   * without this, a turn that only moved the platform reads as idle and the no-progress
   * window can fire on a run that is genuinely working (the false "no progress" pause).
   */
  isPlatformProgress?(tool: string, args: unknown): boolean;
}

/** The default check/test classifier. */
export function isCheckCallDefault(tool: string, args: unknown): boolean {
  if (tool === "run_checks" || tool === "run_tests") return true;
  if (tool !== "run_command" || !args || typeof args !== "object") return false;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" && TEST_COMMAND.test(command);
}

/** Whether a path names a test file. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path.split("\\").join("/"));
}

function resultDigest(result: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(result ?? null) ?? "";
  } catch {
    text = String(result);
  }
  return contentHash(text.slice(0, 8_000));
}

export class NoProgressTracker {
  private readonly seen: Set<string>;
  private readonly changes: Set<string>;
  private idleTurns: number;
  private lastCheck: string | undefined;
  private groundThisTurn = false;
  private churnThisTurn = false;
  private churnTurns: number;
  private lastGround = false;
  private lastIdle = false;
  private turn = 0;
  private readonly lastSeenAt: Map<string, number>;
  private readonly targetOf: (tool: string, args: unknown) => string | null;
  private readonly isCheckCall: (tool: string, args: unknown) => boolean;
  private readonly isPlatformProgress?: (tool: string, args: unknown) => boolean;

  constructor(state?: NoProgressState, ports: NoProgressPorts = {}) {
    this.seen = new Set(state?.seen ?? []);
    this.changes = new Set(state?.changes ?? []);
    this.idleTurns = state?.idleTurns ?? 0;
    this.churnTurns = state?.churnTurns ?? 0;
    this.lastCheck = state?.lastCheck;
    this.turn = 0;
    this.lastSeenAt = new Map(Object.entries(state?.lastSeenAt ?? {}));
    this.targetOf = ports.targetOf ?? ((_tool, args) => pathArgOf(args));
    this.isCheckCall = ports.isCheckCall ?? isCheckCallDefault;
    this.isPlatformProgress = ports.isPlatformProgress;
  }

  /**
   * One call of the current turn ran. `wrote` = it changed content (a file edit, or a
   * mutating command that names no file). Returns
   * whether the call was a check whose result CHANGED — a failing check that answers
   * differently each time is the run fixing things, not repeating a failure.
   */
  observe(tool: string, args: unknown, outcome: { ok: boolean; wrote: boolean; result?: unknown }): { checkChanged: boolean } {
    const path = this.targetOf(tool, args);
    if (path) {
      if (!this.seen.has(path)) {
        this.seen.add(path);
        if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value as string);
        this.groundThisTurn = true;
      } else {
        // Spaced revisits across a wide survey are re-engagement, not circling — a run
        // that comes back to an old target after REGROUND_TURNS turns is on a new trail.
        // (The true circling case — one target read repeatedly in a tight window — is
        // caught by VisitTally, which this complements.)
        const last = this.lastSeenAt.get(path);
        if (last === undefined || this.turn - last >= REGROUND_TURNS) this.groundThisTurn = true;
      }
      this.lastSeenAt.set(path, this.turn);
    }
    // An external side effect (a ticket created/updated, a dispatch) advances the work —
    // a turn that only moved the platform is not idle.
    if (outcome.ok && !path && this.isPlatformProgress?.(tool, args)) this.groundThisTurn = true;
    if (outcome.ok && outcome.wrote) {
      if (path && isTestPath(path)) this.groundThisTurn = true;
      const fingerprint = contentHash(callFingerprint(tool, args));
      if (!this.changes.has(fingerprint)) {
        this.changes.add(fingerprint);
        if (this.changes.size > MAX_SEEN) this.changes.delete(this.changes.values().next().value as string);
        this.churnThisTurn = true;
      }
    }
    if (!this.isCheckCall(tool, args)) return { checkChanged: false };
    const digest = resultDigest(outcome.result);
    if (digest === this.lastCheck) return { checkChanged: false };
    // The first check of a run is progress too: it is new evidence.
    this.groundThisTurn = true;
    this.lastCheck = digest;
    return { checkChanged: true };
  }

  /** The turn's calls all ran. Returns the idle-turn streak after it. */
  endTurn(): number {
    let progressed = this.groundThisTurn;
    if (this.groundThisTurn) this.churnTurns = 0;
    else if (this.churnThisTurn) {
      this.churnTurns += 1;
      progressed = this.churnTurns <= CHURN_TURNS;
    }
    this.lastGround = this.groundThisTurn;
    this.lastIdle = !progressed;
    this.idleTurns = progressed ? 0 : this.idleTurns + 1;
    this.groundThisTurn = false;
    this.churnThisTurn = false;
    this.turn += 1;
    return this.idleTurns;
  }

  /** Whether the turn {@link endTurn} last closed made GROUND progress (not churn alone). */
  get lastTurnGround(): boolean {
    return this.lastGround;
  }

  /** Whether the turn {@link endTurn} last closed made NO progress at all (neither
   *  ground nor churn) — the pure-idle turn the B4 batching nudge targets. */
  get lastTurnIdle(): boolean {
    return this.lastIdle;
  }

  /** Start the window over (the run was steered, escalated or resumed by a human). */
  reset(): void {
    this.idleTurns = 0;
    this.groundThisTurn = false;
    this.churnThisTurn = false;
    // churnTurns stays: only real ground ends a drift, so a drifting run keeps tripping.
  }

  snapshot(): NoProgressState {
    return {
      seen: [...this.seen],
      idleTurns: this.idleTurns,
      ...(this.lastSeenAt.size ? { lastSeenAt: Object.fromEntries(this.lastSeenAt) } : {}),
      ...(this.changes.size ? { changes: [...this.changes] } : {}),
      ...(this.churnTurns ? { churnTurns: this.churnTurns } : {}),
      ...(this.lastCheck ? { lastCheck: this.lastCheck } : {}),
    };
  }
}
