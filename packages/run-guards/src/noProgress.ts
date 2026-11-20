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
 *    as platform progress (a ticket update, a dispatch), or a delegation whose children
 *    reported back or changed files (its result's `reports` / `changedFiles`). Ground
 *    always counts and clears the churn count.
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
 *
 * The paths a call touches are its own target AND every file it changes
 * ({@link changedPathsOf}) — a batched `edit_file({ edits: [...] })` reaches several files
 * none of which is at its top level (chat #146477).
 *
 * A check run in the BACKGROUND answers later: `run_command` returns a job id and the
 * result arrives through a poll (`command_status` / `command_stop`). The start is not
 * judged; its job id is remembered (bounded, in the state) and the poll that reports the
 * job finished is judged as the check — its answer is the check's digest. Every judged
 * check also reports whether it PASSED (ok, exit code 0 when it reports one, and for a
 * poll a job that `exited`), which the progress detector's verified-work tracker reads.
 * Pure; the state is plain JSON.
 */
import { callFingerprint, contentHash, pathArgOf } from "./fingerprint.js";
import { changedPathsOf } from "./callChanges.js";
import { runsCheck, shellCommandOf } from "./checkCommand.js";
import { isReadOnlyShellCall } from "./readOnlyShell.js";
import { WaitCeiling, type WaitCeilingState } from "./waitCeiling.js";

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

export interface NoProgressState extends WaitCeilingState {
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
  /** Job ids of checks started in the background (newest last, bounded), so the poll that
   *  brings a job's answer back is judged as the check. Absent in an older snapshot. */
  checkJobs?: string[];
}

/** What one observed call did, as the window reads it. */
export interface NoProgressOutcome {
  ok: boolean;
  /** It changed content (a file edit, or a mutating command that names no file). */
  wrote: boolean;
  result?: unknown;
  /** Files a delegation's children changed, from its RESULT (`delegatedChanges.ts`): targets the run wrote. */
  delegatedPaths?: readonly string[];
  /** A delegation returned a child report that moved the work (done, or changed files): platform progress even with no files. */
  delegationReported?: boolean;
  /** This call waits on children or a background job that are STILL RUNNING: what it waits on (`delegatedChanges.ts`
   *  `waitDigestOf`, kept for diagnostics). A turn made ONLY of such waits is not idle — for at most `MAX_WAIT_TURNS`
   *  consecutive wait-only turns with no ground progress (`waitCeiling.ts`). */
  waitingOn?: string;
}

/** What one observed call meant for the check window. */
export interface NoProgressObservation {
  /** The call was a check whose answer CHANGED. */
  checkChanged: boolean;
  /** The call was a check (or a poll of a background check): `passed` / `failed` when it
   *  answered, `pending` when the answer is still to come. Absent for any other call. */
  check?: "passed" | "failed" | "pending";
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
  if (tool !== "run_command") return false;
  // The runner must be what the command RUNS: `ls tests/` or `git commit -m "fix tests"` only mention one.
  return runsCheck(shellCommandOf(args));
}

/** Whether a path names a test file. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path.split("\\").join("/"));
}

/** The tools that poll a background shell job by its `id` (`@builderforce/agent-tools`
 *  shell-tools): `command_status` reports it, `command_stop` kills it and reports its end. */
export const JOB_POLL_TOOLS: ReadonlySet<string> = new Set(["command_status", "command_stop"]);

/** Background check jobs remembered — a run rarely has more than a few in flight. */
const MAX_CHECK_JOBS = 16;

function recordOf(result: unknown): Record<string, unknown> | null {
  return result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
}

/** The job id of a command that went to the background (`run_command` `background: true`,
 *  or one that outlived its `yieldMs`): `{ background: true, id, status: "running" }`. */
function startedJobOf(result: unknown): string | null {
  const r = recordOf(result);
  if (!r || r.background !== true || r.status !== "running" || typeof r.id !== "string" || !r.id.trim()) return null;
  return r.id.trim();
}

/** A poll's answer for a job that is no longer running (`exited`, `killed`, `unknown`). */
function finishedJob(result: unknown): boolean {
  const status = recordOf(result)?.status;
  return typeof status === "string" && status !== "running";
}

/**
 * Whether a check's answer is a PASS: the call succeeded, its exit code (when it reports
 * one) is 0, and — for a background job's poll — the job exited on its own.
 */
function checkPassed(ok: boolean, result: unknown, poll: boolean): boolean {
  if (!ok) return false;
  const r = recordOf(result);
  if (typeof r?.exitCode === "number" && r.exitCode !== 0) return false;
  return !poll || r?.status === "exited";
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
  private checkJobs: string[];
  private groundThisTurn = false;
  private churnThisTurn = false;
  /** This turn's calls, and the digests of the still-running waits among them: a turn made ONLY of waits is not idle. */
  private callsThisTurn = 0;
  private waitsThisTurn: string[] = [];
  /** The ceiling on waiting on an unchanged state (`waitCeiling.ts`). */
  private readonly waits: WaitCeiling;
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
    this.checkJobs = (state?.checkJobs ?? []).slice(-MAX_CHECK_JOBS);
    this.turn = 0;
    this.lastSeenAt = new Map(Object.entries(state?.lastSeenAt ?? {}));
    this.targetOf = ports.targetOf ?? ((_tool, args) => pathArgOf(args));
    this.isCheckCall = ports.isCheckCall ?? isCheckCallDefault;
    this.isPlatformProgress = ports.isPlatformProgress;
    this.waits = new WaitCeiling(state);
  }

  /**
   * One call of the current turn ran. `wrote` = it changed content (a file edit, or a
   * mutating command that names no file). Returns
   * whether the call was a check whose result CHANGED — a failing check that answers
   * differently each time is the run fixing things, not repeating a failure.
   */
  observe(tool: string, args: unknown, outcome: NoProgressOutcome): NoProgressObservation {
    const delegated = outcome.delegatedPaths ?? [];
    this.callsThisTurn += 1;
    if (outcome.ok && outcome.waitingOn) this.waitsThisTurn.push(outcome.waitingOn);
    // The call's own target plus every file it changes: one batched `edits: [...]` call
    // reaches several paths, none of them at its top level — and the files a delegation's
    // children changed, which its result reports.
    const targets = [...new Set([this.targetOf(tool, args), ...changedPathsOf(args), ...delegated].filter((p): p is string => !!p))];
    for (const path of targets) {
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
    if (outcome.ok && targets.length === 0 && this.isPlatformProgress?.(tool, args)) this.groundThisTurn = true;
    // A child that answered moved the work, files or not.
    if (outcome.ok && outcome.delegationReported) this.groundThisTurn = true;
    if (outcome.ok && (outcome.wrote || delegated.length > 0)) {
      if (targets.some(isTestPath)) this.groundThisTurn = true;
      const fingerprint = contentHash(callFingerprint(tool, args));
      if (!this.changes.has(fingerprint)) {
        this.changes.add(fingerprint);
        if (this.changes.size > MAX_SEEN) this.changes.delete(this.changes.values().next().value as string);
        this.churnThisTurn = true;
      }
    }
    const poll = this.isCheckJobPoll(tool, args);
    if (!poll && !this.isCheckCall(tool, args)) return { checkChanged: false };
    // A check started in the background has no answer yet: remember its job, and judge
    // the poll that brings the answer back instead.
    const job = startedJobOf(outcome.result);
    if (!poll && job) {
      this.rememberJob(job);
      return { checkChanged: false, check: "pending" };
    }
    // A poll of a job still running is not an answer either.
    if (poll && !finishedJob(outcome.result)) return { checkChanged: false, check: "pending" };
    // A shell call that provably only reads is never a pass, whatever it mentions.
    const check = checkPassed(outcome.ok, outcome.result, poll) && (poll || !isReadOnlyShellCall(tool, args)) ? "passed" : "failed";
    const digest = resultDigest(outcome.result);
    if (digest === this.lastCheck) return { checkChanged: false, check };
    // The first check of a run is progress too: it is new evidence.
    this.groundThisTurn = true;
    this.lastCheck = digest;
    return { checkChanged: true, check };
  }

  /**
   * A child's report that reached the run OUTSIDE a call (injected as a message): the files
   * it changed are paths the run reached, and a report that moved the work is ground — the
   * same reading a `wait_agents` result gets.
   */
  noteChildReport(changedPaths: readonly string[], moved: boolean): void {
    for (const path of changedPaths) {
      if (!this.seen.has(path)) {
        this.seen.add(path);
        if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value as string);
      }
      this.lastSeenAt.set(path, this.turn);
    }
    if (moved || changedPaths.length > 0) this.groundThisTurn = true;
  }

  /** A poll of a background job a check command started ({@link JOB_POLL_TOOLS}). */
  private isCheckJobPoll(tool: string, args: unknown): boolean {
    if (!JOB_POLL_TOOLS.has(tool) || !args || typeof args !== "object") return false;
    const id = (args as { id?: unknown }).id;
    return typeof id === "string" && this.checkJobs.includes(id.trim());
  }

  private rememberJob(id: string): void {
    this.checkJobs = [...this.checkJobs.filter((j) => j !== id), id].slice(-MAX_CHECK_JOBS);
  }

  /** The turn's calls all ran. Returns the idle-turn streak after it. */
  endTurn(): number {
    let progressed = this.groundThisTurn;
    if (this.groundThisTurn) this.churnTurns = 0;
    else if (this.churnThisTurn) {
      this.churnTurns += 1;
      progressed = this.churnTurns <= CHURN_TURNS;
    }
    // A turn made ONLY of waits on work still running elsewhere is not idling (nor ground) — for at most MAX_WAIT_TURNS
    // such turns in a row, whatever they wait on. A mixed turn is judged by its other calls; ground progress or any call
    // that is not a wait starts the ceiling over.
    const allWaiting = this.callsThisTurn > 0 && this.waitsThisTurn.length === this.callsThisTurn;
    if (allWaiting && !this.groundThisTurn) {
      if (this.waits.waited([...this.waitsThisTurn].sort().join("|"))) progressed = true;
    } else if (this.callsThisTurn > 0 || this.groundThisTurn) this.waits.reset();
    this.lastGround = this.groundThisTurn;
    this.lastIdle = !progressed;
    this.idleTurns = progressed ? 0 : this.idleTurns + 1;
    this.groundThisTurn = false;
    this.churnThisTurn = false;
    this.callsThisTurn = 0;
    this.waitsThisTurn = [];
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
    this.callsThisTurn = 0;
    this.waitsThisTurn = [];
    // churnTurns (and the wait ceiling) stays: only real ground ends a drift, so a drifting run keeps tripping.
  }

  snapshot(): NoProgressState {
    return {
      seen: [...this.seen],
      idleTurns: this.idleTurns,
      ...(this.lastSeenAt.size ? { lastSeenAt: Object.fromEntries(this.lastSeenAt) } : {}),
      ...(this.changes.size ? { changes: [...this.changes] } : {}),
      ...(this.churnTurns ? { churnTurns: this.churnTurns } : {}),
      ...(this.lastCheck ? { lastCheck: this.lastCheck } : {}),
      ...(this.checkJobs.length ? { checkJobs: [...this.checkJobs] } : {}),
      ...this.waits.snapshot(),
    };
  }
}
