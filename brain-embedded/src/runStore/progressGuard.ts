/**
 * The A3 progress detector, bound to the editor's run (PRD 35 WS8p). The detector is
 * `@builderforce/run-guards`' — the one the cloud's `costLoop/loopGuards.ts` and
 * `agent-run`'s `policy/guards` bind; this file only maps its ladder onto what this run
 * loop already has, and WS4 replaces it with `policy/guards`.
 *
 * Every run gets it — parent and sub-agent, planning and coding, before and after its
 * edits — so a run that says "Now I have everything I need" and keeps reading, circles a
 * file, undoes its own edit or repeats a failing call trips it wherever it is:
 *
 *   • steer — the note rides the next turn's opening (its volatile tail, never the
 *     cached prefix);
 *   • escalate — a forced turn through `progressBudget.ts`: `hand_off` alone while
 *     planning, the change tools alone once coding. A run asked a QUESTION is never
 *     forced to change anything, so it is steered again instead;
 *   • finish — the next turn offers no change, exec or ask tools and carries the detector's
 *     note, so the model writes its final report and the run ends. It offers ONLY the
 *     ticket tools the work-linking directive declares as obligations (`promptTools.obligation`),
 *     for at most FINISH_RECORD_TURNS turns, so what is still open is filed before the report
 *     (VS Code chat #157440); a run with none offers nothing. A verified run's idle-shaped trip
 *     (its wrap-up, VS Code chat #146477), or any run's third trip, whose note asks for an
 *     honest report of what is done and what blocks the rest. Never `ask_user` — the guard
 *     never asks the person whether to continue (VS Code chat #157440). A change request
 *     that has changed nothing still gets ONE more chance to finish the work: its first
 *     unverified finish is deferred for a forced change turn (a planner's analysis ends and
 *     the coding role takes it); the next trip really finishes.
 *
 * Escalation never forces the change tools on a run that already changed code
 * (`forcedProgressTurn` returns null once the run has changed code (`codeChanged`)): its note opens the turn instead.
 *
 * Lever `a3_progress_detector` (on at 100%; `COST_LEVER_A3_PROGRESS_DETECTOR=off` turns it
 * off on this device). Trace: `loop.progress_check`, `loop.progress_advisory` for a B1/B4
 * advisory (not a trip), and `loop.progress_forced` for a forced turn.
 */

import { ProgressDetector, progressAdvice, progressTraceStep, type ProgressAction, type ProgressTraceStep } from '@builderforce/run-guards';
import { isUnscopedMutation } from '../readCoverage';
import { isReadOnlyShellCall } from '../readOnlyShell';
import { isRouterTool } from '../toolRouter';
import type { BrainToolSpec } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import { isDedupableRead, type BrainRunContext } from './brainRunContext';
import { isMutatingPlatformTool } from '../chatWorkLinking';
import { budgeted, endPlanning, forcedProgressTurn, progressed, type ForcedTurn } from './progressBudget';
import { offersHandOff } from '@builderforce/run-policy';
import { deviceLeverOn } from './deviceLevers';

/** A ladder trip (steer / escalate / finish) — everything except the B1 advisory, which
 *  carries no `trip`/`signal` and is consumed inside {@link RunProgressGuard.endTurn}. */
type TripAction = Exclude<ProgressAction, { kind: 'advisory' }>;

/** A call that only reads: a deduplicable read, a read-only shell command, a router lookup. */
export function isReadOnlyCall(tool: string, args: unknown): boolean {
  return isDedupableRead(tool) || isReadOnlyShellCall(tool, args) || isRouterTool(tool);
}

export class RunProgressGuard {
  /** Null when the lever is off: every method is then a no-op. */
  private readonly detector: ProgressDetector | null;
  /** An escalate / finish a later turn's menu acts on — kept until one takes it, so a
   *  budget that forces the next turn first never drops it. */
  private due: TripAction | null = null;
  /** The note the next turn opens with, when the host shows it in place of an escalation. */
  private steer: string | undefined;
  /** The B1 / B4 advisory the last turn produced, waiting to be traced. */
  private advisory: ProgressAction | null = null;
  /** An unverified finish was deferred once for a forced change turn (`progressGuardTurn`). */
  private stalledDeferred = false;
  /**
   * The run is FINISHING with its obligation tools on offer (`progressGuardTurn`): how many more turns may still record work
   * (file / update tickets) before the last one offers nothing. Null while the run is not finishing that way.
   */
  private recordTurnsLeft: number | null = null;
  /** The run entered a finish (a record turn or its final no-tool turn): sticky for the rest of the run. */
  private finished = false;

  /**
   * @param on the A3 lever.
   * @param expectsChange the run was asked for a CHANGE (`asksForChange` over its request).
   *   Only then does a read-only streak trip — a review reads and answers.
   */
  constructor(on = deviceLeverOn('a3_progress_detector'), expectsChange = false) {
    this.detector = on
      ? new ProgressDetector({}, {
          isReadOnly: isReadOnlyCall,
          isUnscopedMutation,
          isPlatformProgress: isMutatingPlatformTool,
          expectsChange: () => expectsChange,
        })
      : null;
  }

  /** What the turn said before its calls. */
  noteTurnText(text: string): void {
    this.detector?.noteTurnText(text);
  }

  /** One of the turn's calls ran (or was answered from the read cache). */
  observe(tool: string, args: unknown, result: { data: unknown; isError?: boolean }): void {
    this.detector?.observe(tool, args, result);
  }

  /** A child's report reached the run through its inbox (not a `wait_agents` result): its files are the run's writes. */
  observeChildReport(report: Parameters<ProgressDetector['observeChildReport']>[0]): void {
    this.detector?.observeChildReport(report);
  }

  /** The turn's calls all ran. The trip it caused, if any — or the B1 readiness
   *  advisory ({@link readinessAdvisory}) on the FIRST unkept claim, which is never a
   *  trip and must not be queued like one. */
  endTurn(): TripAction | null {
    this.steer = undefined;
    const action = this.detector?.endTurn() ?? null;
    if (!action) return null;
    if (action.kind === 'advisory') {
      this.steer = action.note;
      // Not a trip, but still the run's record: kept for the trace until taken.
      this.advisory = action;
      return null;
    }
    // The detector's second note says the run moved to a stronger model; here the second
    // step is a forced turn, whose brief carries the advice instead.
    // A finish's note is its no-tools turn's brief, so it is not shown twice.
    if (action.kind === 'escalate' || action.kind === 'finish') this.detector?.setSteer(undefined);
    // Only an escalation or finish waits for a later turn's menu — a steer rides the
    // next turn's opening note, it is never forced.
    if (action.kind === 'escalate' || action.kind === 'finish') this.due = action;
    return action;
  }

  /** The note the next turn opens with ("" when none) — a trip steer, or the B1 advisory. */
  steerNote(): string {
    return this.steer ?? this.detector?.steerNote() ?? '';
  }

  /** The advisory the last turn produced, taken once (null when none). */
  takeAdvisory(): ProgressAction | null {
    const advisory = this.advisory;
    this.advisory = null;
    return advisory;
  }

  /** The escalation or finish waiting for this turn, taken once. */
  takeDue(): TripAction | null {
    const due = this.due;
    this.due = null;
    return due;
  }

  /** Whether an unverified finish may still be deferred — once per run, for one forced change turn. */
  get canDeferStalledFinish(): boolean {
    return !this.stalledDeferred;
  }

  /** The one deferral is spent: the next unverified finish really ends the run. */
  stalledFinishDeferred(): void {
    this.stalledDeferred = true;
  }

  /** The escalation could not be forced here: show its note on this turn instead. */
  steerInstead(note: string): void {
    this.steer = note;
  }

  /** A finish offered the obligation tools: `turns` more turns may still record work before the last one offers nothing. */
  beginRecordingFinish(turns: number): void {
    this.recordTurnsLeft = Math.max(0, turns);
  }

  /**
   * The run is FINISHING: a finish turn was decided ("make no more code changes and run nothing … then write the final report").
   * Set once by {@link finishTurn}; never cleared for the rest of the run, so no delivery gate sends its report back for more work.
   */
  get finishing(): boolean {
    return this.finished;
  }

  /** A finish turn was decided (only {@link finishTurn} calls this). */
  enterFinish(): void {
    this.finished = true;
  }

  /**
   * The next turn of a finishing run, taken once per turn: 'record' (the obligation tools again), 'final' (no tools — the
   * report), or null when the run is not finishing that way. Finish means no more coding, whatever a later trip decides.
   */
  takeFinishingTurn(): 'record' | 'final' | null {
    if (this.recordTurnsLeft === null) return null;
    if (this.recordTurnsLeft > 0) {
      this.recordTurnsLeft -= 1;
      return 'record';
    }
    this.recordTurnsLeft = null;
    return 'final';
  }
}

/** Turns a finishing run may spend recording its remaining work as tickets, the finish turn itself included. */
export const FINISH_RECORD_TURNS = 3;

/** What a finish turn that offers the obligation tools adds to the detector's note. */
export const FINISH_RECORD_BRIEF =
  'You are FINISHING: make no more code changes and run nothing. Before your final report, file a ticket for EVERY item the person asked for that is still open (with the ticket tools offered on this turn), and update the status of the tickets you worked on. Then write the final report: what is done, and which ticket tracks each item that is not.';

/** What the last turn of a finishing run says. */
const FINISH_FINAL_BRIEF = 'Write your final report now: what is done, and which ticket tracks each requested item that is still open.';

/**
 * The tools a finish turn offers: ONLY the obligations the work-linking directive declared (`promptTools.obligation`,
 * `chatWorkObligationTools`) that the catalog holds — record the remaining work, update statuses. Never a write or exec tool.
 */
function obligationToolsOf(run: BrainRunContext): BrainToolSpec[] {
  const names = new Set(run.promptTools?.obligation ?? []);
  if (names.size === 0) return [];
  return (run.allTools ?? []).filter((t) => names.has(t.function.name));
}

/** `afterToolCalls`: the turn is over — judge it. */
export function progressAfterToolCalls(run: BrainRunContext): (ctx: { step: number }) => void {
  return (ctx) => {
    const action = run.progress.endTurn();
    // ONE mapping for trips and advisories alike (`progressTraceStep`), so every host's row matches.
    const advisory = run.progress.takeAdvisory();
    if (advisory) traceStep(run, ctx.step, progressTraceStep(advisory));
    if (!action) return;
    traceStep(run, ctx.step, progressTraceStep(action));
  };
}

function traceStep(run: BrainRunContext, step: number, s: ProgressTraceStep): void {
  pushTrace(run.c, { ts: nowIso(), category: 'message', label: s.label, args: { step, ...s.args }, result: s.result });
}

/**
 * The next turn of a FINISHING run (a record turn with the obligation tools, then the final no-tool report), taken once per
 * turn — or null when the run is not finishing. A finishing run stays finishing: no hand-off, change-budget, no-progress or
 * later trip reopens the menu (finish means no more coding), so the turn menu asks this FIRST (`brainTurnMenu.ts`).
 */
export function finishingTurn(run: BrainRunContext): ForcedTurn | null {
  const finishing = run.progress.takeFinishingTurn();
  if (!finishing) return null;
  run.progress.takeDue();
  const tools = finishing === 'record' ? obligationToolsOf(run) : [];
  return finishTurn(run, tools, tools.length > 0 ? FINISH_RECORD_BRIEF : FINISH_FINAL_BRIEF);
}

/** THE one place a finish turn is made: the run is finishing from here on (`RunProgressGuard.finishing`, sticky). */
function finishTurn(run: BrainRunContext, tools: BrainToolSpec[], brief: string): ForcedTurn {
  run.progress.enterFinish();
  return { tools, brief: { role: 'user', content: brief }, finishing: true };
}

/**
 * The forced turn an escalation or finish decides, called after selection with this
 * turn's tools. Null for an ordinary turn — and when the trip cannot be forced here,
 * in which case its note opens the turn instead.
 */
export function progressGuardTurn(run: BrainRunContext, step: number, selected: readonly BrainToolSpec[]): ForcedTurn | null {
  const finishing = finishingTurn(run);
  if (finishing) return finishing;
  const due = run.progress.takeDue();
  if (!due) return null;
  // The next turn is the final report — no change, exec or ask tools, so it can neither invent an
  // edit nor ask the person whether to continue. It offers ONLY the obligation tools (VS Code chat
  // #157440: a run ended mid-task could not record what was still open), for a bounded number of
  // turns; with none to offer, its answer ends the run. Verified wrap-up and the ladder's last rung
  // alike: the note says which.
  if (due.kind === 'finish') {
    const deferred = due.verified ? null : deferredFinishTurn(run, step, selected, due);
    // Steered instead: an ordinary turn, whose note carries the advice.
    if (deferred === 'steered') return null;
    if (deferred) return deferred;
    const tools = obligationToolsOf(run);
    trace(run, step, due, 'finish', tools.length);
    if (tools.length === 0) return finishTurn(run, [], due.note);
    run.progress.beginRecordingFinish(FINISH_RECORD_TURNS - 1);
    return finishTurn(run, tools, `${due.note}\n\n${FINISH_RECORD_BRIEF}`);
  }
  const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
  // A run asked a question is never forced to change anything.
  const out = budgeted(run) ? forcedProgressTurn(run, selected, advice) : null;
  if (!out) {
    run.progress.steerInstead(advice);
    return null;
  }
  trace(run, step, due, out.forced);
  return out.turn;
}

/**
 * A change request that has not changed anything is not ended while the run can still DO the work: once per run, the
 * unverified finish becomes a forced change turn instead — the change tools alone, with NO `ask_user` (the guard's own
 * forced turn never offers a question). A planner's analysis ends there (the coding role takes the turn, as the plan
 * budget would have). When this turn's menu has no change tool to force while still planning, planning ends and the run
 * is steered instead ('steered'), so the NEXT turn selects as `code` with the full menu. Null: the finish stands. The next
 * trip after the deferral really finishes.
 */
function deferredFinishTurn(run: BrainRunContext, step: number, selected: readonly BrainToolSpec[], due: TripAction): ForcedTurn | 'steered' | null {
  if (!budgeted(run) || progressed(run) || !run.progress.canDeferStalledFinish) return null;
  const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
  const planning = offersHandOff(run.policy);
  const out = forcedProgressTurn(run, selected, advice, {
    changeOnly: true,
    noAsk: true,
    endPlanning: { step, why: 'The run kept reading through its progress checks without handing off — analysis ends here and the coding role makes the change.' },
  });
  if (out) {
    run.progress.stalledFinishDeferred();
    trace(run, step, due, out.forced);
    return out.turn;
  }
  // Not planning and nothing to force: the finish stands.
  if (!planning) return null;
  endPlanning(run, step, 'The run kept reading through its progress checks without handing off — analysis ends here and the coding role takes the next turn.');
  run.progress.stalledFinishDeferred();
  run.progress.steerInstead(advice);
  return 'steered';
}

const FORCED_MENU: Readonly<Record<'hand_off' | 'change', string>> = {
  hand_off: 'hand_off alone',
  change: 'the change tools alone',
};

function trace(run: BrainRunContext, step: number, due: TripAction, forced: 'hand_off' | 'change' | 'finish', recordTools = 0): void {
  const why = due.kind === 'finish' && due.verified ? 'the change is made and verified' : 'the run is not converging';
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.progress_forced',
    args: { step, trip: due.trip, signal: due.signal.kind, forced, ...(recordTools > 0 ? { recordTools } : {}) },
    result: forced !== 'finish'
      ? `progress check ${due.trip} (${due.signal.kind}) — this turn offers ${FORCED_MENU[forced]} and requires a call.`
      : recordTools > 0
        ? `progress check ${due.trip} (${due.signal.kind}) — ${why}: this turn offers only the ${recordTools} ticket tool(s) to record what is still open, and the run writes its final report.`
        : `progress check ${due.trip} (${due.signal.kind}) — ${why}: this turn offers no tools and the run writes its final report.`,
  });
}
