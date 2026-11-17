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
 *   • pause — `ask_user` alone with the detector's question. Where the run cannot ask
 *     (a sub-agent), it is steered again;
 *   • finish — the run's change is made and a check passed after it, so an idle-shaped
 *     trip is wrap-up: the next turn offers NO tools and carries the detector's note, so
 *     the model writes its final report and the run ends. Never a forced edit, never
 *     `ask_user` (VS Code chat #146477).
 *
 * Escalation never forces the change tools on a run that already changed code
 * (`forcedProgressTurn` returns null once the run has changed code (`codeChanged`)): its note opens the turn instead.
 *
 * Lever `a3_progress_detector` (on at 100%; `COST_LEVER_A3_PROGRESS_DETECTOR=off` turns it
 * off on this device). Trace: `loop.progress_check`, `loop.progress_advisory` for a B1/B4
 * advisory (not a trip), and `loop.progress_forced` for a forced turn.
 */

import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';
import { ProgressDetector, progressAdvice, progressTraceStep, type ProgressAction, type ProgressTraceStep } from '@builderforce/run-guards';
import { isUnscopedMutation } from '../readCoverage';
import { isReadOnlyShellCall } from '../readOnlyShell';
import { isRouterTool } from '../toolRouter';
import type { BrainToolSpec } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import { isDedupableRead, type BrainRunContext } from './brainRunContext';
import { isMutatingPlatformTool } from '../chatWorkLinking';
import { budgeted, forcedProgressTurn, type ForcedTurn } from './progressBudget';
import { deviceLeverOn } from './deviceLevers';

/** A ladder trip (escalate / pause / steer) — everything except the B1 advisory, which
 *  carries no `trip`/`signal` and is consumed inside {@link RunProgressGuard.endTurn}. */
type TripAction = Exclude<ProgressAction, { kind: 'advisory' }>;

/** A call that only reads: a deduplicable read, a read-only shell command, a router lookup. */
export function isReadOnlyCall(tool: string, args: unknown): boolean {
  return isDedupableRead(tool) || isReadOnlyShellCall(tool, args) || isRouterTool(tool);
}

export class RunProgressGuard {
  /** Null when the lever is off: every method is then a no-op. */
  private readonly detector: ProgressDetector | null;
  /** An escalate / pause a later turn's menu acts on — kept until one takes it, so a
   *  budget that forces the next turn first never drops it. */
  private due: TripAction | null = null;
  /** The note the next turn opens with, when the host shows it in place of an escalation. */
  private steer: string | undefined;
  /** The B1 / B4 advisory the last turn produced, waiting to be traced. */
  private advisory: ProgressAction | null = null;

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
    // Only an escalation, pause or finish waits for a later turn's menu — a steer rides the
    // next turn's opening note, it is never forced.
    if (action.kind === 'escalate' || action.kind === 'pause' || action.kind === 'finish') this.due = action;
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

  /** The escalation or pause waiting for this turn, taken once. */
  takeDue(): TripAction | null {
    const due = this.due;
    this.due = null;
    return due;
  }

  /** The escalation could not be forced here: show its note on this turn instead. */
  steerInstead(note: string): void {
    this.steer = note;
  }
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
 * The forced turn an escalation or pause decides, called after selection with this
 * turn's tools. Null for an ordinary turn — and when the trip cannot be forced here,
 * in which case its note opens the turn instead.
 */
export function progressGuardTurn(run: BrainRunContext, step: number, selected: readonly BrainToolSpec[]): ForcedTurn | null {
  const due = run.progress.takeDue();
  if (!due) return null;
  // The change is made and verified: the next turn is the final report — no tools, so it
  // can neither invent an edit nor ask the person; its answer ends the run.
  if (due.kind === 'finish') {
    trace(run, step, due, 'finish');
    return { tools: [], brief: { role: 'user', content: due.note } };
  }
  const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
  if (due.kind === 'pause') {
    if (!run.canAskUser) {
      run.progress.steerInstead(advice);
      return null;
    }
    trace(run, step, due, 'ask_user');
    return {
      tools: [ASK_USER_TOOL_SPEC as BrainToolSpec],
      toolChoice: 'required',
      brief: {
        role: 'user',
        content: `${advice} Call ${ASK_USER_TOOL} now. question: "${due.question}" options: [{ "label": "Continue with guidance" }, { "label": "Stop the run" }]`,
      },
    };
  }
  // A run asked a question is never forced to change anything.
  const out = budgeted(run) ? forcedProgressTurn(run, selected, advice) : null;
  if (!out) {
    run.progress.steerInstead(advice);
    return null;
  }
  trace(run, step, due, out.forced);
  return out.turn;
}

const FORCED_MENU: Readonly<Record<'hand_off' | 'change' | 'ask_user', string>> = {
  ask_user: 'ask_user alone',
  hand_off: 'hand_off alone',
  change: 'the change tools alone',
};

function trace(run: BrainRunContext, step: number, due: TripAction, forced: 'hand_off' | 'change' | 'ask_user' | 'finish'): void {
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.progress_forced',
    args: { step, trip: due.trip, signal: due.signal.kind, forced },
    result: forced === 'finish'
      ? `progress check ${due.trip} (${due.signal.kind}) — the change is made and verified: this turn offers no tools and the run writes its final report.`
      : `progress check ${due.trip} (${due.signal.kind}) — this turn offers ${FORCED_MENU[forced]} and requires a call.`,
  });
}
