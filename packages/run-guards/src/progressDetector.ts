/**
 * THE progress detector (cost PRD A3): the guards above, composed into one per-run
 * judgement — is this run still converging, and if not, what happens next?
 *
 * It watches five shapes of a stuck run, strongest first:
 *  - `edit_revert` — a change that puts a file back the way it was ({@link EditRevertTracker});
 *  - `repeated_failure` — the identical call failing {@link FAILURE_HARD_AT} times ({@link FailureTally});
 *  - `circling_read` — one target read {@link REVISIT_HARD_AT} times with nothing changing it ({@link VisitTally});
 *  - `unkept_ready` — {@link UNKEPT_READY_AT} turns that said the run had what it needed, then only read ({@link UnkeptClaimTracker});
 *  - `read_only_streak` — {@link READ_ONLY_STREAK_TURNS} all-read-only turns (or {@link READ_ONLY_STREAK_CALLS} read-only calls) in a row, new files or not ({@link ReadOnlyStreak});
 *  - `no_progress` — {@link NO_PROGRESS_TURNS} turns with no new file, no change the run had not already made, and no test change ({@link NoProgressTracker}).
 *
 * A turn that showed any of them is a TRIP, and trips escalate: the first is a steer
 * (a note the host shows the model on its next turn), the second asks the host to move
 * the run up one model tier, the third (and any later) ENDS the run autonomously — a
 * `finish` whose next turn offers no tools and tells the model to write its final report:
 * what it changed, how it was verified, what is NOT done and the one concrete blocker for
 * each open item ({@link progressStalledFinishNote}). The ladder never asks the human
 * whether to continue: `ask_user` is for business questions the model itself chooses to
 * ask, never a guard's "should I go on?" (VS Code chat #157440). After a trip the windows
 * start over, so one stuck stretch is one trip, not one per turn.
 * {@link LADDER_RESET_TURNS} ground-progress turns (new files, test or check movement; churn alone does not count) in a row clear the ladder, so unrelated
 * stretches far apart each start from a steer instead of adding up to a finish.
 *
 * A FINISHED run is not a stuck one. Once the run has VERIFIED work — a successful write
 * and a passing check after its last write ({@link VerifiedWork}; a background check counts
 * when its poll reports the job exited 0) — a trip on an idle-shaped signal
 * ({@link FINISHABLE_SIGNALS}: `no_progress`, `reverifying`, `read_only_streak`,
 * `unkept_ready`) is likely its wrap-up. The FIRST such trip is a steer that says so ("if
 * the request is fully done, report now; otherwise make the next change") — a verified first
 * part of a multi-part task must not end the task. From the second trip on the action is
 * `finish` instead of the ladder's rung: the host's next turn is the final report, with no
 * tools — never a forced edit, never a question for the human (VS Code chat #146477: a
 * finished, type-checked change was escalated, forced to invent an edit, then paused).
 * The early (second-trip) finish is offered once per write: a run that goes idle AGAIN after
 * one, with no new write, climbs the normal ladder (escalate, then the third-rung finish).
 * `edit_revert`, `repeated_failure` and `circling_read` keep the ladder. A `finish` is still
 * a trip (counted in `trips` and `tripsBySignal`). A check passes only when its runner is
 * the command's executable (`checkCommand.ts`), and VCS bookkeeping
 * (`git add/commit/status/diff/log/push`) is not a write.
 *
 * Every write is read through {@link changedPathsOf}, so a batched `edit_file({ edits })`
 * call counts as a write of each file it changes — for visits, read-backs, edit reverts
 * and the no-progress window alike. A DELEGATION's writes are read from its result
 * (`delegatedChanges.ts`): the files `wait_agents` / `spawn_agent(s)` / `hand_off` report
 * their children changed count as the run's own writes, and a returned child report is
 * progress — so a pure orchestrator whose sub-agents did the writing can earn verified
 * work with its own passing check (VS Code chat #157440). A report the host injects as a
 * message instead reaches it through {@link ProgressDetector.observeChildReport}. A wait on
 * children or a background job that are STILL RUNNING is neither idle nor a read.
 *
 * Pure and host-agnostic: the host says which calls only read and which mutate
 * unscoped. Its state is plain JSON, so the cloud durable loop — one model turn per
 * tick — carries it in its loop state and every tick judges the whole run.
 */
import { FAILURE_HARD_AT, FailureTally, failureReason, type FailureTallyState } from "./failureTally.js";
import { EditRevertTracker, type EditRevertState } from "./editRevert.js";
import { NO_PROGRESS_TURNS, NoProgressTracker, type NoProgressPorts, type NoProgressState } from "./noProgress.js";
import { REVISIT_HARD_AT, VisitTally, type VisitTallyState } from "./visitTally.js";
import { pathArgOf } from "./fingerprint.js";
import { changedPathsOf } from "./callChanges.js";
import { childReportProgressOf, delegatedChangedPathsOf, delegationReportedOf, waitDigestOf } from "./delegatedChanges.js";
import type { ChildReportLike } from "@builderforce/agent-tools";
import { isReadOnlyShellCall } from "./readOnlyShell.js";
import { isVcsBookkeeping, shellCommandOf } from "./checkCommand.js";
import { VerifiedWork, type VerifiedWorkState } from "./verifiedWork.js";
import { UNKEPT_READY_AT, UnkeptClaimTracker, type UnkeptClaimState } from "./readinessClaim.js";
import { ReadinessAdvisory, type ReadinessAdvisoryState } from "./readinessAdvisory.js";
import { BatchingNudge, type BatchingNudgeState, turnCallsOf } from "./batchingNudge.js";
import { ReverifyTracker, type ReverifyState } from "./reverifyTracker.js";
import { SuiteRepeat, type SuiteRepeatState } from "./suiteRepeat.js";
import { READ_ONLY_STREAK_CALLS, READ_ONLY_STREAK_TURNS, ReadOnlyStreak, type ReadOnlyStreakState } from "./readOnlyStreak.js";

/** Ground-progress, signal-free turns in a row that clear the trip ladder: trips far apart are
 *  separate stuck stretches, and only back-to-back ones should end the run. */
export const LADDER_RESET_TURNS = 8;

export type ProgressSignalKind = "edit_revert" | "repeated_failure" | "circling_read" | "reverifying" | "unkept_ready" | "read_only_streak" | "no_progress";

/** The idle-shaped signals a run with VERIFIED work trips by wrapping up: it is told to
 *  finish instead of climbing the ladder. `edit_revert`, `repeated_failure` and
 *  `circling_read` name a concrete fault and keep the ladder. */
export const FINISHABLE_SIGNALS: ReadonlySet<ProgressSignalKind> = new Set<ProgressSignalKind>(["no_progress", "reverifying", "read_only_streak", "unkept_ready"]);

/** Strongest first — a turn reports only its strongest signal. */
const SIGNAL_RANK: Readonly<Record<ProgressSignalKind, number>> = {
  edit_revert: 0,
  repeated_failure: 1,
  circling_read: 2,
  reverifying: 3,
  unkept_ready: 4,
  read_only_streak: 5,
  no_progress: 6,
};

export interface ProgressSignal {
  kind: ProgressSignalKind;
  tool?: string;
  target?: string;
  count?: number;
  reason?: string;
}

/** What the host must do about a trip. */
export type ProgressAction =
  | { kind: "steer"; trip: number; signal: ProgressSignal; note: string }
  | { kind: "escalate"; trip: number; signal: ProgressSignal; note: string }
  /** The run ends on its own report: the host's next turn offers NO tools and carries the
   *  note — never a forced edit, never a question for the human. `verified`: the change is
   *  made and a check passed after it, so an idle-shaped trip is wrap-up ({@link FINISHABLE_SIGNALS},
   *  {@link progressFinishNote}); otherwise it is the ladder's third rung, an honest report
   *  of what is done and what blocks the rest ({@link progressStalledFinishNote}). */
  | { kind: "finish"; trip: number; signal: ProgressSignal; note: string; verified: boolean }
  /** B1: a one-off note on the next turn — the FIRST unkept readiness claim. Never a
   *  trip: it does not touch the ladder, the trip count or `tripsBySignal`. */
  | { kind: "advisory"; note: string };

/** `writtenPaths` / `readBackSinceWrite` are the `reverifying` tracker's ({@link ReverifyState}). */
export interface ProgressDetectorState extends ReverifyState {
  visits?: VisitTallyState;
  failures?: FailureTallyState;
  edits?: EditRevertState;
  progress?: NoProgressState;
  claims?: UnkeptClaimState;
  /** The current all-read-only streak. Omitted when zero. */
  readOnlyStreak?: ReadOnlyStreakState;
  /** Trips so far this run. */
  trips?: number;
  /** Trips so far this run, by the signal that caused each (run telemetry, PRD 35 §8.2). */
  tripsBySignal?: Partial<Record<ProgressSignalKind, number>>;
  /** Turns this run that claimed readiness and then only read — every one, never reset
   *  by a trip (the claim tracker's own count is the CURRENT streak). */
  unkeptTurns?: number;
  /** Consecutive signal-free ground-progress turns, toward {@link LADDER_RESET_TURNS}. Omitted when 0. */
  quietTurns?: number;
  /** The steer the NEXT turn shows the model, until that turn ends. */
  steer?: string;
  /** B1: the one-off readiness advisory awaiting its one turn ("" when none). */
  advisory?: ReadinessAdvisoryState;
  /** B4: the batching nudge's plain-JSON state (streak + one-shot fired flag). */
  batching?: BatchingNudgeState;
  /** Whether the run wrote, and a check passed after its last write ({@link VerifiedWork}). Omitted when empty. */
  work?: VerifiedWorkState;
  suites?: SuiteRepeatState; // the repeated-full-suite advisory (`suiteRepeat.ts`); omitted when empty
}

export interface ProgressDetectorPorts extends NoProgressPorts {
  /** A call that only reads (counted as a visit). Default: none — circling is not judged. */
  isReadOnly?(tool: string, args: unknown): boolean;
  /** A call that may have changed ANY file, unnamed. Default: `run_command`. */
  isUnscopedMutation?(tool: string, args: unknown): boolean;
  /** A file deletion. Default: `delete_file`. */
  isDelete?(tool: string): boolean;
  /** The run was asked for a CHANGE. Only then is a read-only streak a stall — a review
   *  or analysis run legitimately reads many files and answers. Default: none — the
   *  `read_only_streak` signal is off. */
  expectsChange?(): boolean;
  isBookkeeping?(tool: string): boolean;
}

/** A dispatched call's result, as the detector reads it. */
export interface ObservedResult {
  data: unknown;
  isError?: boolean;
}

function succeeded(result: ObservedResult): boolean {
  if (result.isError) return false;
  const d = result.data;
  return !(d && typeof d === "object" && (d as { ok?: unknown }).ok === false);
}

/** The target a read visited: its path, else the question it asked. */
function visitTargetOf(args: unknown): string | null {
  const path = pathArgOf(args);
  if (!args || typeof args !== "object") return path;
  const a = args as Record<string, unknown>;
  const question = [a.query, a.pattern, a.symbol, a.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (path && question) return `${path} ∋ ${question.trim()}`;
  return path ?? question?.trim() ?? null;
}

export class ProgressDetector {
  private readonly visits: VisitTally;
  private readonly failures: FailureTally;
  private readonly edits: EditRevertTracker;
  private readonly progress: NoProgressTracker;
  private readonly claims: UnkeptClaimTracker;
  private readonly readOnlyStreak: ReadOnlyStreak;
  private trips: number;
  private tripsBySignal: Partial<Record<ProgressSignalKind, number>>;
  private unkeptTurns: number;
  private quietTurns: number;
  private steer: string | undefined;
  /** B1: the readiness advisory — one note at the FIRST unkept claim, never a trip. */
  private readonly readiness: ReadinessAdvisory;
  /** B4: the batching nudge — one note after SERIAL_SINGLE_CALLS_AT single-readonly
   *  turns, never a trip and never touching UNKEPT_READY_AT or any other signal. */
  private readonly batching: BatchingNudge;
  private turnSignal: ProgressSignal | null = null;
  /** `reverifying`: written paths and their read-backs (persisted, bounded). */
  private readonly reverify: ReverifyTracker;
  /** Every call of the current turn, for the B4 batching nudge's read-only count. */
  private turnCalls: Array<{ tool: string; args: unknown; result: ObservedResult }>;
  /** Made a change and saw a check pass after it — turns an idle-shaped trip into `finish`. */
  private readonly work: VerifiedWork;
  private readonly suites: SuiteRepeat; // a repeated full-suite sweep (`suiteRepeat.ts`)

  constructor(state: ProgressDetectorState = {}, private readonly ports: ProgressDetectorPorts = {}) {
    this.visits = new VisitTally(state.visits);
    this.failures = new FailureTally(state.failures);
    this.edits = new EditRevertTracker(state.edits);
    this.progress = new NoProgressTracker(state.progress, ports);
    this.claims = new UnkeptClaimTracker(state.claims);
    this.readOnlyStreak = new ReadOnlyStreak(state.readOnlyStreak);
    this.trips = state.trips ?? 0;
    this.tripsBySignal = { ...(state.tripsBySignal ?? {}) };
    this.unkeptTurns = state.unkeptTurns ?? 0;
    this.quietTurns = state.quietTurns ?? 0;
    this.steer = state.steer;
    this.readiness = new ReadinessAdvisory(state.advisory);
    this.batching = new BatchingNudge(state.batching);
    this.reverify = new ReverifyTracker(state);
    this.turnCalls = [];
    this.work = new VerifiedWork(state.work);
    this.suites = new SuiteRepeat(state.suites);
  }

  private raise(signal: ProgressSignal): void {
    if (!this.turnSignal || SIGNAL_RANK[signal.kind] < SIGNAL_RANK[this.turnSignal.kind]) this.turnSignal = signal;
  }

  /** The current turn's own text — what it said before its calls (a readiness claim?). */
  noteTurnText(text: string): void {
    this.claims.noteText(text);
  }

  /** One call of the current turn ran. */
  observe(tool: string, args: unknown, result: ObservedResult): void {
    if (this.ports.isBookkeeping?.(tool)) {
      this.readOnlyStreak.observeNeutral();
      return;
    }
    this.turnCalls.push({ tool, args, result });
    const ok = succeeded(result);
    // A wait on children or a background job still running (chat #157440) is NEUTRAL for the claim and the streak:
    // neither a read nor an act. The no-progress window judges it (with its ceiling, `waitCeiling.ts`).
    const waitDigest = ok ? waitDigestOf(tool, result.data) : null;
    if (waitDigest === null) {
      // Kept or not is about what the model CHOSE to do: a failed edit still acted.
      // Without an `isReadOnly` port nothing is judged read-only, so no claim goes unkept.
      const readOnly = this.ports.isReadOnly?.(tool, args) === true;
      this.claims.observe(readOnly);
      // Same rule for the streak: without the port no call is read-only, so it never fills.
      this.readOnlyStreak.observe(readOnly);
    } else this.readOnlyStreak.observeNeutral();
    const unscoped = (this.ports.isUnscopedMutation ?? ((t) => t === "run_command"))(tool, args);
    if (tool === "run_command") this.suites.ranCommand(shellCommandOf(args));
    // Every file the call changes — one, or several in a batched `edits: [...]` call.
    const changed = changedPathsOf(args);
    const wrote = ok && (changed.length > 0 || (unscoped && this.ports.isReadOnly?.(tool, args) !== true));
    const isDelete = (this.ports.isDelete ?? ((t) => t === "delete_file"))(tool);
    if (unscoped) {
      this.visits.markAllMayHaveChanged();
      this.edits.reset();
      // Any file may now differ, so no read-back is a look at unchanged bytes.
      if (wrote) this.reverify.wroteAnything();
    } else if (isDelete) {
      this.edits.record(tool, args, { ok, deleted: ok });
      this.forgetVisitsOf(pathArgOf(args));
    } else if (changed.length > 0) {
      const revert = this.edits.record(tool, args, { ok });
      if (revert) this.raise({ kind: "edit_revert", tool, target: revert.path });
      if (ok) {
        for (const path of changed) {
          this.forgetVisitsOf(path);
          this.reverify.wrote(path);
        }
      }
    } else if (ok && this.ports.isReadOnly?.(tool, args)) {
      const target = visitTargetOf(args);
      if (target) {
        this.reverify.read(target);
        const visit = this.visits.record(`${tool}:${target}`, args);
        if (visit.count >= REVISIT_HARD_AT && !visit.mayHaveChanged) this.raise({ kind: "circling_read", tool, target, count: visit.count });
      }
    }

    // A delegation's children wrote these files, and its RESULT names them (chat #157440):
    // the run wrote them, for visits, read-backs, the no-progress window and verified work.
    const delegated = ok ? delegatedChangedPathsOf(tool, result.data) : [];
    this.creditDelegatedWrites(delegated);
    const reported = ok && delegationReportedOf(tool, result.data);
    const { checkChanged, check } = this.progress.observe(tool, args, {
      ok,
      wrote,
      result: result.data,
      ...(delegated.length > 0 ? { delegatedPaths: delegated } : {}),
      ...(reported ? { delegationReported: true } : {}),
      ...(waitDigest !== null ? { waitingOn: waitDigest } : {}),
    });
    // Verified work: a write (a check command is not one, though the shell may run it as
    // an unscoped mutation, and neither is a shell command that provably only reads — a
    // host whose `isReadOnly` port knows only tool names still runs `git status` that way),
    // then a check that answered after it.
    // VCS bookkeeping (`git add/commit/status/diff/log/push`) records the work; it changes nothing the check judged.
    const bookkeeping = tool === "run_command" && isVcsBookkeeping(shellCommandOf(args));
    const workWrite = (wrote && !isReadOnlyShellCall(tool, args) && !bookkeeping) || (ok && isDelete);
    if (workWrite && check === undefined) this.work.noteWrite();
    if (check === "passed" || check === "failed") this.work.noteCheck(check === "passed");
    // A failing check whose answer changed is the run fixing things, not a repeat.
    if (ok || checkChanged) this.failures.clear(tool, args);
    else {
      const attempts = this.failures.record(tool, args);
      const reason = failureReason(result.data);
      if (attempts >= FAILURE_HARD_AT) this.raise({ kind: "repeated_failure", tool, count: attempts, ...(reason ? { reason } : {}) });
    }
  }

  /** Files a delegation's children changed are the run's own writes: visits, read-backs and verified work alike. */
  private creditDelegatedWrites(paths: readonly string[]): void {
    for (const path of paths) {
      this.forgetVisitsOf(path);
      this.reverify.wrote(path);
    }
    if (paths.length > 0) this.work.noteWrite();
  }

  /**
   * A child's report that reached the run OUTSIDE a call — the host injected it as a message
   * (`childReportText`), the default path. Read like a `wait_agents` result: its files are the
   * run's writes, and a finished report is progress (chat #157440).
   */
  observeChildReport(report: Pick<ChildReportLike, "state" | "changedFiles">): void {
    const { changedPaths, moved } = childReportProgressOf(report);
    this.creditDelegatedWrites(changedPaths);
    this.progress.noteChildReport(changedPaths, moved);
  }

  private forgetVisitsOf(path: string | null): void {
    if (!path) return;
    this.visits.forget((key) => {
      const target = key.slice(key.indexOf(":") + 1);
      return target === path || target.startsWith(`${path} ∋ `);
    });
  }

  /** Every call of the turn ran. The trip this turn caused, if any — or, earlier and
   *  cheaper (B1), the readiness advisory on the FIRST unkept claim (never a trip). */
  endTurn(): ProgressAction | null {
    // B4: judge the batching streak on EVERY turn (a write or a busy turn resets it,
    // whatever else the turn did); the note itself surfaces only on a signal-free turn.
    const turnCalls = this.turnCalls;
    this.turnCalls = [];
    const batchNote = this.batching.observe(turnCallsOf(turnCalls, this.ports.isReadOnly));
    // The previous trip's steer has now been shown for one turn.
    this.steer = undefined;
    const idle = this.progress.endTurn();
    // A turn whose only read activity is files the run itself already wrote AND already
    // read back since that write — no new path, no change, no test movement — is
    // re-verifying already-shipped ground. It is the exact loop that evades no_progress
    // (constant new-target ground) and circling_read (reset by every successful write):
    // re-running a filtered type-check, or re-reading a file the run committed, to
    // convince itself the work landed. The FIRST read-back after a write is not part of
    // it: that inspects the edit, which may have half-applied (chat #70776). A turn that
    // also breaks new ground or writes is real work, not re-verification.
    const rereads = this.reverify.endTurn();
    if (!this.turnSignal && rereads > 0 && !this.progress.lastTurnGround && idle > 0) {
      this.raise({ kind: "reverifying", count: rereads });
    }
    // New files do not excuse it: the run said it had what it needed.
    const unkeptBefore = this.claims.snapshot().unkept;
    const unkept = this.claims.endTurn();
    if (unkept > unkeptBefore) this.unkeptTurns += 1;
    if (unkept >= UNKEPT_READY_AT) this.raise({ kind: "unkept_ready", count: unkept });
    // New files do not excuse this one either: turn after turn of reads and nothing done
    // (chat #132309 run #3 — 14 turns, 46 reads of new files, 0 changes).
    const streak = this.readOnlyStreak.endTurn();
    if (this.ports.expectsChange?.() === true && (streak.turns >= READ_ONLY_STREAK_TURNS || streak.calls >= READ_ONLY_STREAK_CALLS)) {
      this.raise({ kind: "read_only_streak", count: streak.calls });
    }
    if (!this.turnSignal && idle >= NO_PROGRESS_TURNS) this.raise({ kind: "no_progress", count: idle });
    const signal = this.turnSignal;
    this.turnSignal = null;
    if (!signal) {
      // B1: judge the advisory AFTER the trip logic, on the trip-invariant total: a trip
      // resets the streak but the run has still shown the habit, so the note fires (once)
      // either way. The pending note from a previous turn rode exactly one turn — consume
      // it first; `ReadinessAdvisory.observe` fires at most once per run (`fired` persists
      // in the JSON snapshot), so a non-empty return here is always a fresh, one-off fire.
      this.readiness.endTurn();
      const advisoryNote = this.readiness.observe(this.unkeptTurns);
      if (advisoryNote) return { kind: "advisory", note: advisoryNote };
      // A repeated full-suite sweep (chat #275): taken (marked shown) only here, where it is the note returned.
      const suiteNote = this.suites.take();
      if (suiteNote) return { kind: "advisory", note: suiteNote };
      // B4: the batching nudge, on the turn after SERIAL_SINGLE_CALLS_AT consecutive
      // single-readonly turns. Advisory only — the ladder, UNKEPT_READY_AT and every other
      // signal are untouched, and it sits inside `if (!signal)` so it never masks a trip.
      // It surfaces only on a PURE-IDLE turn — `lastTurnIdle` is true exactly when the turn
      // made no ground AND no churn — because a turn that reached a fresh path, moved a
      // test, or changed a check result did real work, not serial re-reading. A churn turn
      // (a distinct edit) is likewise not a serial-read turn. Firing here would mask the
      // productive-turn signals (no_progress, readiness) these tests pin.
      if (batchNote && this.progress.lastTurnIdle) return { kind: "advisory", note: batchNote };
      // Sustained GROUND progress ends the stuck stretch the ladder was counting. A churn
      // turn neither adds to the streak nor breaks it; an idle turn resets it.
      if (this.progress.lastTurnGround) this.quietTurns += 1;
      else if (idle > 0) this.quietTurns = 0;
      if (this.quietTurns >= LADDER_RESET_TURNS) {
        this.trips = 0;
        this.quietTurns = 0;
      }
      return null;
    }
    this.quietTurns = 0;
    this.trips += 1;
    this.tripsBySignal[signal.kind] = (this.tripsBySignal[signal.kind] ?? 0) + 1;
    // One stuck stretch is one trip: start every window over.
    this.progress.reset();
    this.claims.reset();
    this.readOnlyStreak.reset();
    this.visits.forget(() => true);
    this.failures.reset();
    // Verified work that went idle is wrap-up — or the pause between two parts of a larger task.
    if (this.work.isVerified && FINISHABLE_SIGNALS.has(signal.kind)) {
      // The first trip only asks: a multi-part task's next part is not ended by a verified first part.
      if (this.trips === 1) {
        const note = progressVerifiedSteerNote(signal);
        this.steer = note;
        return { kind: "steer", trip: this.trips, signal, note };
      }
      // From the second on: end with the report, never force more — once per write. A run told to finish
      // that goes idle again is not finishing, and the ladder below takes over.
      if (!this.work.finishOffered) {
        this.work.noteFinishOffered();
        const note = progressFinishNote(signal);
        this.steer = note;
        return { kind: "finish", trip: this.trips, signal, note, verified: true };
      }
    }
    if (this.trips <= 2) {
      const note = progressSteerNote(signal, this.trips);
      this.steer = note;
      return { kind: this.trips === 1 ? "steer" : "escalate", trip: this.trips, signal, note };
    }
    // The third trip ends the run on its own report — never a question for the human
    // (VS Code chat #157440). Verified idle wrap-up says the work is done; anything else
    // reports honestly what is done, what is not, and what blocks it.
    const verified = this.work.isVerified && FINISHABLE_SIGNALS.has(signal.kind);
    const note = verified ? progressFinishNote(signal) : progressStalledFinishNote(signal);
    this.steer = note;
    return { kind: "finish", trip: this.trips, signal, note, verified };
  }

  /** A host that could not escalate shows the steer instead (or clears it once a finish brief carries it). */
  setSteer(note: string | undefined): void {
    this.steer = note;
  }

  /** The note the current turn's request carries ("" when none). */
  steerNote(): string {
    return this.steer ?? "";
  }

  get tripCount(): number {
    return this.trips;
  }

  snapshot(): ProgressDetectorState {
    return {
      visits: this.visits.snapshot(),
      failures: this.failures.snapshot(),
      edits: this.edits.snapshot(),
      progress: this.progress.snapshot(),
      ...(this.claims.snapshot().unkept ? { claims: this.claims.snapshot() } : {}),
      ...(this.readOnlyStreak.snapshot().turns ? { readOnlyStreak: this.readOnlyStreak.snapshot() } : {}),
      ...(this.trips ? { trips: this.trips } : {}),
      ...(Object.keys(this.tripsBySignal).length ? { tripsBySignal: { ...this.tripsBySignal } } : {}),
      ...(this.unkeptTurns ? { unkeptTurns: this.unkeptTurns } : {}),
      ...(this.quietTurns ? { quietTurns: this.quietTurns } : {}),
      ...(this.steer ? { steer: this.steer } : {}),
      // `fired` persists on its own: a consumed one-off advisory must not re-fire on resume.
      ...((): Record<string, unknown> => {
        const a = this.readiness.snapshot();
        return a.note || a.fired ? { advisory: a } : {};
      })(),
      ...((): Record<string, unknown> => {
        const b = this.batching.snapshot();
        return b.streak || b.fired ? { batching: b } : {};
      })(),
      ...this.reverify.snapshot(),
      ...((): Record<string, unknown> => {
        const w = this.work.snapshot();
        return w.wrote ? { work: w } : {};
      })(),
      ...this.suites.snapshotField(),
    };
  }

  /** The run's change is made and a check passed after its last write. */
  get workVerified(): boolean {
    return this.work.isVerified;
  }
}

/** The FIRST trip of a run with verified work: finish if the request is done, else take its next part. */
export function progressVerifiedSteerNote(signal: ProgressSignal): string {
  return `Progress check (first warning): your last change is made and a check passed after it, but ${signal.kind === "no_progress" ? `the last ${signal.count ?? NO_PROGRESS_TURNS} turns changed nothing` : "the last turns changed nothing"}. If the request is fully done, write the final report now — what you changed, how it was verified, anything left open — and make no more tool calls. Otherwise make the next change the request still needs.`;
}

/** What a run with verified work is told when it trips an idle-shaped signal again. */
export function progressFinishNote(signal: ProgressSignal): string {
  const what = signal.kind === "no_progress"
    ? `the last ${signal.count ?? NO_PROGRESS_TURNS} turns changed nothing`
    : signal.kind === "reverifying"
      ? "this turn only re-checked work you already verified"
      : "the last turns only looked around";
  return `Progress check: your change is made and a check passed after your last edit — ${what}. The work is done. Write the final report NOW: what you changed (files), how it was verified, what is NOT done, and the single concrete blocker for each open item. Make no more tool calls, and do not ask the user whether to continue.`;
}

/** What the stalled finish names: a concrete fault keeps its full advice (the report should name it);
 *  an idle stall is stated as a fact, without "make the edit now" moves a no-tools turn cannot take. */
function stalledDiagnosis(signal: ProgressSignal): string {
  switch (signal.kind) {
    case "edit_revert":
    case "repeated_failure":
    case "circling_read":
      return progressAdvice(signal);
    case "reverifying":
      return "the last turns only re-checked files you already wrote instead of reporting.";
    case "unkept_ready":
      return `you said ${signal.count} times that you had what you needed, then only read.`;
    case "read_only_streak":
      return `you made ${signal.count} read-only calls in a row without changing anything.`;
    case "no_progress":
      return `the last ${signal.count ?? NO_PROGRESS_TURNS} turns touched no new file and changed nothing about the tests.`;
  }
}

/** What the run is told on a trip: the diagnosis, the evidence, the moves that remain. `movedUp` = false for a
 *  host whose second trip found no stronger model, so the note does not claim one. */
export function progressSteerNote(signal: ProgressSignal, trip: number, movedUp = true): string {
  const head = `Progress check (${trip === 1 ? "first warning" : movedUp ? "second warning — the run has been moved to a stronger model" : "second warning"}): `;
  return `${head}${progressAdvice(signal)}`;
}

/** A trip's diagnosis and the moves that remain, without the warning's heading — for a
 *  host whose second step is not a stronger model (the editor forces a change turn). */
export function progressAdvice(signal: ProgressSignal): string {
  switch (signal.kind) {
    case "edit_revert":
      return `your last change to ${signal.target} put the file back the way it was earlier in this run. You are oscillating between two versions instead of converging. Decide which version is right from the requirement and the evidence you already have, make that change once, and move on.`;
    case "repeated_failure":
      return `\`${signal.tool}\` has failed ${signal.count} times with identical arguments${signal.reason ? ` ("${signal.reason}")` : ""}. Change the argument the error names, use a different tool, or finish and state what is blocking you.`;
    case "circling_read":
      return `you have read ${signal.target} ${signal.count} times and nothing changed it in between. Everything you read is still above you. Act on it — make the edit — or page forward to lines you have not seen.`;
    case "reverifying":
      return `this turn only re-checked ${signal.count === 1 ? "a file" : `${signal.count} files`} you already wrote and verified. Re-running the same type-check, build or read on ground you shipped does not make it more correct — it burns budget. The work is done: report the result and stop, or move on to the next task. Only re-verify when something actually changed the code.`;
    case "unkept_ready":
      return `you have said ${signal.count} times that you have what you need — or that you are about to write — and then only read. Act on it now: make the change, spawn or hand off the work, or ask about what genuinely blocks you. Reading more is not the next step.`;
    case "read_only_streak":
      return `you have made ${signal.count} read-only calls in a row without changing anything. Everything you read is still in your context. If the task is a change, make the first concrete edit NOW with what you already have — do not read another file first. If it is analysis only, write the answer now.`;
    case "no_progress":
      return `the last ${signal.count} turns touched no new file and changed nothing about the tests. Re-read the task, pick the next concrete step that changes code or runs a check, and do it now — or finish and explain what is blocking you.`;
  }
}

/** What a run WITHOUT verified work is told on its third trip: end now, on an honest report.
 *  It must not claim the work is done or verified, and must not ask whether to continue. */
export function progressStalledFinishNote(signal: ProgressSignal): string {
  return `Progress check (final): ${stalledDiagnosis(signal)} This is the third warning, so the run ends now. Write the final report NOW and make no more tool calls: what you changed (files), how it was verified (or that it was not), what is NOT done, and the single concrete blocker for each open item. Do not claim unverified work is done, and do not ask the user whether to continue.`;
}
