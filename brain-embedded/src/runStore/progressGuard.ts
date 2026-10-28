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
 *     (a sub-agent), it is steered again.
 *
 * Lever `a3_progress_detector` (on at 100%; `COST_LEVER_A3_PROGRESS_DETECTOR=off` turns it
 * off on this device). Trace: `loop.progress_check`, and `loop.progress_forced` for a
 * forced turn.
 */

import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';
import { ProgressDetector, progressAdvice, type ProgressAction } from '@builderforce/run-guards';
import { isUnscopedMutation } from '../readCoverage';
import { isReadOnlyShellCall } from '../readOnlyShell';
import { isRouterTool } from '../toolRouter';
import type { BrainToolSpec } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import { isDedupableRead, type RunLoopContext } from './runLoopContext';
import { budgeted, forcedProgressTurn, type ForcedTurn } from './progressBudget';
import { deviceLeverOn } from './deviceLevers';

/** A call that only reads: a deduplicable read, a read-only shell command, a router lookup. */
export function isReadOnlyCall(tool: string, args: unknown): boolean {
  return isDedupableRead(tool) || isReadOnlyShellCall(tool, args) || isRouterTool(tool);
}

export class RunProgressGuard {
  /** Null when the lever is off: every method is then a no-op. */
  private readonly detector: ProgressDetector | null;
  /** An escalate / pause a later turn's menu acts on — kept until one takes it, so a
   *  budget that forces the next turn first never drops it. */
  private due: ProgressAction | null = null;
  /** The note the next turn opens with, when the host shows it in place of an escalation. */
  private steer: string | undefined;

  constructor(on = deviceLeverOn('a3_progress_detector')) {
    this.detector = on ? new ProgressDetector({}, { isReadOnly: isReadOnlyCall, isUnscopedMutation }) : null;
  }

  /** What the turn said before its calls. */
  noteTurnText(text: string): void {
    this.detector?.noteTurnText(text);
  }

  /** One of the turn's calls ran (or was answered from the read cache). */
  observe(tool: string, args: unknown, result: { data: unknown; isError?: boolean }): void {
    this.detector?.observe(tool, args, result);
  }

  /** The turn's calls all ran. The trip it caused, if any. */
  endTurn(): ProgressAction | null {
    this.steer = undefined;
    const action = this.detector?.endTurn() ?? null;
    // The detector's second note says the run moved to a stronger model; here the second
    // step is a forced turn, whose brief carries the advice instead.
    if (action?.kind === 'escalate') this.detector?.setSteer(undefined);
    if (action && action.kind !== 'steer') this.due = action;
    return action;
  }

  /** The note the next turn opens with ("" when none). */
  steerNote(): string {
    return this.steer ?? this.detector?.steerNote() ?? '';
  }

  /** The escalation or pause waiting for this turn, taken once. */
  takeDue(): ProgressAction | null {
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
export function progressAfterToolCalls(run: RunLoopContext): (ctx: { step: number }) => void {
  return (ctx) => {
    const action = run.progress.endTurn();
    if (!action) return;
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'loop.progress_check',
      args: { step: ctx.step, trip: action.trip, signal: action.signal.kind, action: action.kind },
      result: `progress check ${action.trip}: ${action.signal.kind} → ${action.kind}`,
    });
  };
}

/**
 * The forced turn an escalation or pause decides, called after selection with this
 * turn's tools. Null for an ordinary turn — and when the trip cannot be forced here,
 * in which case its note opens the turn instead.
 */
export function progressGuardTurn(run: RunLoopContext, step: number, selected: readonly BrainToolSpec[]): ForcedTurn | null {
  const due = run.progress.takeDue();
  if (!due) return null;
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

function trace(run: RunLoopContext, step: number, due: ProgressAction, forced: 'hand_off' | 'change' | 'ask_user'): void {
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.progress_forced',
    args: { step, trip: due.trip, signal: due.signal.kind, forced },
    result: `progress check ${due.trip} (${due.signal.kind}) — this turn offers ${forced === 'ask_user' ? 'ask_user alone' : forced === 'hand_off' ? 'hand_off alone' : 'the change tools alone'} and requires a call.`,
  });
}
