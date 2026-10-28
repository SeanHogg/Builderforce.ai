/**
 * THE progress detector (cost PRD A3): the guards above, composed into one per-run
 * judgement — is this run still converging, and if not, what happens next?
 *
 * It watches five shapes of a stuck run, strongest first:
 *  - `edit_revert` — a change that puts a file back the way it was ({@link EditRevertTracker});
 *  - `repeated_failure` — the identical call failing {@link FAILURE_HARD_AT} times ({@link FailureTally});
 *  - `circling_read` — one target read {@link REVISIT_HARD_AT} times with nothing changing it ({@link VisitTally});
 *  - `unkept_ready` — {@link UNKEPT_READY_AT} turns that said the run had what it needed, then only read ({@link UnkeptClaimTracker});
 *  - `no_progress` — {@link NO_PROGRESS_TURNS} turns with no new file and no test change ({@link NoProgressTracker}).
 *
 * A turn that showed any of them is a TRIP, and trips escalate: the first is a steer
 * (a note the host shows the model on its next turn), the second asks the host to move
 * the run up one model tier, the third asks it to pause the run for a human. After a
 * trip the windows start over, so one stuck stretch is one trip, not one per turn.
 *
 * Pure and host-agnostic: the host says which calls only read and which mutate
 * unscoped. Its state is plain JSON, so the cloud durable loop — one model turn per
 * tick — carries it in its loop state and every tick judges the whole run.
 */
import { FAILURE_HARD_AT, FailureTally, failureReason, type FailureTallyState } from "./failureTally.js";
import { EditRevertTracker, changesContent, type EditRevertState } from "./editRevert.js";
import { NO_PROGRESS_TURNS, NoProgressTracker, type NoProgressPorts, type NoProgressState } from "./noProgress.js";
import { REVISIT_HARD_AT, VisitTally, type VisitTallyState } from "./visitTally.js";
import { pathArgOf } from "./fingerprint.js";
import { UNKEPT_READY_AT, UnkeptClaimTracker, type UnkeptClaimState } from "./readinessClaim.js";

export type ProgressSignalKind = "edit_revert" | "repeated_failure" | "circling_read" | "unkept_ready" | "no_progress";

/** Strongest first — a turn reports only its strongest signal. */
const SIGNAL_RANK: Readonly<Record<ProgressSignalKind, number>> = {
  edit_revert: 0,
  repeated_failure: 1,
  circling_read: 2,
  unkept_ready: 3,
  no_progress: 4,
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
  | { kind: "pause"; trip: number; signal: ProgressSignal; question: string };

export interface ProgressDetectorState {
  visits?: VisitTallyState;
  failures?: FailureTallyState;
  edits?: EditRevertState;
  progress?: NoProgressState;
  claims?: UnkeptClaimState;
  /** Trips so far this run. */
  trips?: number;
  /** The steer the NEXT turn shows the model, until that turn ends. */
  steer?: string;
}

export interface ProgressDetectorPorts extends NoProgressPorts {
  /** A call that only reads (counted as a visit). Default: none — circling is not judged. */
  isReadOnly?(tool: string, args: unknown): boolean;
  /** A call that may have changed ANY file, unnamed. Default: `run_command`. */
  isUnscopedMutation?(tool: string, args: unknown): boolean;
  /** A file deletion. Default: `delete_file`. */
  isDelete?(tool: string): boolean;
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
  private trips: number;
  private steer: string | undefined;
  private turnSignal: ProgressSignal | null = null;

  constructor(state: ProgressDetectorState = {}, private readonly ports: ProgressDetectorPorts = {}) {
    this.visits = new VisitTally(state.visits);
    this.failures = new FailureTally(state.failures);
    this.edits = new EditRevertTracker(state.edits);
    this.progress = new NoProgressTracker(state.progress, ports);
    this.claims = new UnkeptClaimTracker(state.claims);
    this.trips = state.trips ?? 0;
    this.steer = state.steer;
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
    // Kept or not is about what the model CHOSE to do: a failed edit still acted.
    // Without an `isReadOnly` port nothing is judged read-only, so no claim goes unkept.
    this.claims.observe(this.ports.isReadOnly?.(tool, args) === true);
    const ok = succeeded(result);
    const wrote = ok && changesContent(args);
    const unscoped = (this.ports.isUnscopedMutation ?? ((t) => t === "run_command"))(tool, args);
    if (unscoped) {
      this.visits.markAllMayHaveChanged();
      this.edits.reset();
    } else if ((this.ports.isDelete ?? ((t) => t === "delete_file"))(tool)) {
      this.edits.record(tool, args, { ok, deleted: ok });
      this.forgetVisitsOf(pathArgOf(args));
    } else if (changesContent(args)) {
      const revert = this.edits.record(tool, args, { ok });
      if (revert) this.raise({ kind: "edit_revert", tool, target: revert.path });
      if (ok) this.forgetVisitsOf(pathArgOf(args));
    } else if (ok && this.ports.isReadOnly?.(tool, args)) {
      const target = visitTargetOf(args);
      if (target) {
        const visit = this.visits.record(`${tool}:${target}`, args);
        if (visit.count >= REVISIT_HARD_AT && !visit.mayHaveChanged) this.raise({ kind: "circling_read", tool, target, count: visit.count });
      }
    }

    const { checkChanged } = this.progress.observe(tool, args, { ok, wrote, result: result.data });
    // A failing check whose answer changed is the run fixing things, not a repeat.
    if (ok || checkChanged) this.failures.clear(tool, args);
    else {
      const attempts = this.failures.record(tool, args);
      const reason = failureReason(result.data);
      if (attempts >= FAILURE_HARD_AT) this.raise({ kind: "repeated_failure", tool, count: attempts, ...(reason ? { reason } : {}) });
    }
  }

  private forgetVisitsOf(path: string | null): void {
    if (!path) return;
    this.visits.forget((key) => {
      const target = key.slice(key.indexOf(":") + 1);
      return target === path || target.startsWith(`${path} ∋ `);
    });
  }

  /** Every call of the turn ran. The trip this turn caused, if any. */
  endTurn(): ProgressAction | null {
    // The previous trip's steer has now been shown for one turn.
    this.steer = undefined;
    const idle = this.progress.endTurn();
    // New files do not excuse it: the run said it had what it needed.
    const unkept = this.claims.endTurn();
    if (unkept >= UNKEPT_READY_AT) this.raise({ kind: "unkept_ready", count: unkept });
    if (!this.turnSignal && idle >= NO_PROGRESS_TURNS) this.raise({ kind: "no_progress", count: idle });
    const signal = this.turnSignal;
    this.turnSignal = null;
    if (!signal) return null;
    this.trips += 1;
    // One stuck stretch is one trip: start every window over.
    this.progress.reset();
    this.claims.reset();
    this.visits.forget(() => true);
    this.failures.reset();
    const note = progressSteerNote(signal, this.trips);
    if (this.trips === 1) {
      this.steer = note;
      return { kind: "steer", trip: this.trips, signal, note };
    }
    if (this.trips === 2) {
      this.steer = note;
      return { kind: "escalate", trip: this.trips, signal, note };
    }
    return { kind: "pause", trip: this.trips, signal, question: progressPauseQuestion(signal, this.trips) };
  }

  /** A host that could not escalate shows the steer instead (or after pausing, clears it). */
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
      ...(this.trips ? { trips: this.trips } : {}),
      ...(this.steer ? { steer: this.steer } : {}),
    };
  }
}

/** What the run is told on a trip: the diagnosis, the evidence, the moves that remain. */
export function progressSteerNote(signal: ProgressSignal, trip: number): string {
  const head = `Progress check (${trip === 1 ? "first warning" : "second warning — the run has been moved to a stronger model"}): `;
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
    case "unkept_ready":
      return `you have said ${signal.count} times that you have what you need — or that you are about to write — and then only read. Act on it now: make the change, spawn or hand off the work, or ask about what genuinely blocks you. Reading more is not the next step.`;
    case "no_progress":
      return `the last ${signal.count} turns touched no new file and changed nothing about the tests. Re-read the task, pick the next concrete step that changes code or runs a check, and do it now — or finish and explain what is blocking you.`;
  }
}

/** The human question a third trip parks the run on. */
export function progressPauseQuestion(signal: ProgressSignal, trip: number): string {
  const what: Record<ProgressSignalKind, string> = {
    edit_revert: `keeps undoing its own change to ${signal.target ?? "a file"}`,
    repeated_failure: `keeps repeating a failing \`${signal.tool ?? "tool"}\` call`,
    circling_read: `keeps re-reading ${signal.target ?? "the same file"} without acting`,
    unkept_ready: "keeps saying it has everything it needs, then reads more instead of acting",
    no_progress: "has stopped making progress (no new files, no test changes)",
  };
  return `This run ${what[signal.kind]} — progress check ${trip}, after earlier warnings. How should it proceed? Reply with guidance to continue, or stop the run.`;
}
