/**
 * policy/guards/forced — the ladder that turns A3's trips and the run-policy budgets into the turn's menu.
 *
 * Every run gets the A3 detector — parent and sub-agent, planning and coding — so a run that says "Now I have everything I
 * need" and keeps reading, circles a file, undoes its own edit or repeats a failing call trips it wherever it is:
 *
 *   • steer — the note rides the next turn's opening (its volatile tail, never the cached prefix);
 *   • escalate — a forced turn: the hand-off tool alone while planning, the change tools alone once coding. A run asked a
 *     QUESTION is never forced to change anything, so it is steered again instead;
 *   • finish — the next turn offers no change, exec or ask tools and carries the detector's note, so the model writes its
 *     final report and the run ends. It offers ONLY the obligation (ticket) tools, for at most `recordTurns` turns, so what is
 *     still open is filed before the report (VS Code chat #157440); a run with none offers nothing. A verified run's idle-shaped
 *     trip (its wrap-up) and any run's third trip are finishes. Never the question tool — the guard never asks the person whether
 *     to continue. A change request that has changed nothing still gets ONE more chance to finish the work: its first
 *     unverified finish is deferred for a forced change turn; the next trip really finishes.
 *
 * Escalation never forces the change tools on a run that already changed code: its note opens the turn instead. FINISHING is
 * sticky: once a finish turn was decided, no hand-off, change budget, no-progress or later trip reopens the menu.
 *
 * The order of one turn's decision: a finishing run's record / final turn, else the analysis budget's hand-off turn (decided
 * BEFORE selection, so a forced turn that did not hand off already selects as code), else the change budget, else a circling
 * run, else A3's due escalation or finish.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import { progressAdvice } from "@builderforce/run-guards";
import { offersHandOff } from "@builderforce/run-policy";
import type { CacheServedStreak } from "../../tools/cacheServedStreak.js";
import type { PolicyContext } from "../../hooks.js";
import { DEFERRED_ENDS_PLANNING, DEFERRED_ENDS_PLANNING_STEERED, FINISH_FINAL_BRIEF, FINISH_RECORD_BRIEF, PROGRESS_FORCED_LABEL } from "./briefs.js";
import { budgeted, changeBudgetTurn, endPlanning, forcedProgressTurn, noProgressTurn, planBudgetTurn, type Note, type TurnEnv } from "./turns.js";
import type { DueTrip, ForcedLadderState, ForcedTurn, ForcedTurnResult, ProgressBinding, ProgressTurnOptions } from "./types.js";

export { FINISH_RECORD_TURNS, PROGRESS_FORCED_LABEL } from "./briefs.js";

const FORCED_MENU: Readonly<Record<"hand_off" | "change", string>> = {
  hand_off: "hand_off alone",
  change: "the change tools alone",
};

/** The ladder's state and decisions for one run. */
export class ForcedLadder {
  constructor(
    readonly state: ForcedLadderState,
    /** Show `note` on the next turn's opening (the detector's steer), or clear it. */
    private readonly steer: (note: string | undefined) => void,
    readonly bind: ProgressBinding,
    readonly opts: ProgressTurnOptions,
  ) {}

  /** The run is FINISHING: a finish turn was decided. Never cleared for the rest of the run, so no delivery gate sends its report back for more work. */
  get finishing(): boolean {
    return this.state.finishing === true;
  }

  /**
   * A trip an escalation or a finish waits on a later turn's menu for. The detector's second note says the run moved to a
   * stronger model, and a finish's note is its no-tools turn's brief: neither is shown twice, so the steer is cleared.
   */
  hold(action: DueTrip): void {
    this.steer(undefined);
    this.state.due = action;
  }

  private takeDue(): DueTrip | null {
    const due = this.state.due ?? null;
    delete this.state.due;
    return due;
  }

  /** 'record' (the obligation tools again), 'final' (no tools — the report), or null when the run is not finishing that way. */
  private takeFinishingTurn(): "record" | "final" | null {
    if (this.state.recordLeft === undefined) return null;
    if (this.state.recordLeft > 0) {
      this.state.recordLeft -= 1;
      return "record";
    }
    delete this.state.recordLeft;
    return "final";
  }

  /** The obligation tools of the work-linking directive that the catalog holds — never a write or exec tool. */
  private obligationTools(ctx: PolicyContext): ToolSchema[] {
    const names = new Set(this.bind.facts.obligationTools());
    return names.size === 0 ? [] : ctx.tools.filter((t) => names.has(t.function.name));
  }

  /** THE one place a finish turn is made: the run is finishing from here on. */
  private finishTurn(tools: ToolSchema[], brief: string): ForcedTurn {
    this.state.finishing = true;
    return { tools, brief, finishing: true, ...(tools.length === 0 ? { final: true as const } : {}) };
  }

  private finishingTurn(ctx: PolicyContext): ForcedTurn | null {
    const finishing = this.takeFinishingTurn();
    if (!finishing) return null;
    this.takeDue();
    const tools = finishing === "record" ? this.obligationTools(ctx) : [];
    return this.finishTurn(tools, tools.length > 0 ? FINISH_RECORD_BRIEF : FINISH_FINAL_BRIEF);
  }

  /**
   * The forced turn an escalation or finish decides, called after selection with this turn's tools. Null for an ordinary
   * turn — and when the trip cannot be forced here, in which case its note opens the turn instead.
   */
  private guardTurn(env: TurnEnv, step: number, selected: readonly ToolSchema[]): ForcedTurn | null {
    const due = this.takeDue();
    if (!due) return null;
    // The next turn is the final report — no change, exec or ask tools, so it can neither invent an edit nor ask the person
    // whether to continue. It offers ONLY the obligation tools, for a bounded number of turns; with none to offer, its answer ends the run.
    if (due.kind === "finish") {
      const deferred = due.verified ? null : this.deferredFinishTurn(env, step, selected, due);
      // Steered instead: an ordinary turn, whose note carries the advice.
      if (deferred === "steered") return null;
      if (deferred) return deferred;
      const tools = this.obligationTools(env.ctx);
      this.trace(env.note, step, due, "finish", tools.length);
      if (tools.length === 0) return this.finishTurn([], due.note);
      this.state.recordLeft = Math.max(0, this.opts.recordTurns - 1);
      return this.finishTurn(tools, `${due.note}\n\n${FINISH_RECORD_BRIEF}`);
    }
    const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
    // A run asked a question is never forced to change anything.
    const out = budgeted(env) ? forcedProgressTurn(env, selected, advice) : null;
    if (!out) {
      this.steer(advice);
      return null;
    }
    this.trace(env.note, step, due, out.forced);
    return out.turn;
  }

  /**
   * A change request that has not changed anything is not ended while the run can still DO the work: once per run, the
   * unverified finish becomes a forced change turn instead — the change tools alone, with NO question tool. A planner's analysis
   * ends there (the coding role takes the turn). When this turn's menu has no change tool to force while still planning,
   * planning ends and the run is steered instead ('steered'), so the NEXT turn selects as `code`. Null: the finish stands.
   */
  private deferredFinishTurn(env: TurnEnv, step: number, selected: readonly ToolSchema[], due: DueTrip): ForcedTurn | "steered" | null {
    if (!budgeted(env) || this.bind.facts.progressed() || this.state.deferred) return null;
    const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
    const planning = offersHandOff(env.ctx.state.model);
    const out = forcedProgressTurn(env, selected, advice, { changeOnly: true, noAsk: true, endsPlanning: { step, why: DEFERRED_ENDS_PLANNING } });
    if (out) {
      this.state.deferred = true;
      this.trace(env.note, step, due, out.forced);
      return out.turn;
    }
    // Not planning and nothing to force: the finish stands.
    if (!planning) return null;
    endPlanning(env, step, DEFERRED_ENDS_PLANNING_STEERED);
    this.state.deferred = true;
    this.steer(advice);
    return "steered";
  }

  private trace(note: Note, step: number, due: DueTrip, forced: "hand_off" | "change" | "finish", recordTools = 0): void {
    const why = due.kind === "finish" && due.verified ? "the change is made and verified" : "the run is not converging";
    const head = `progress check ${due.trip} (${due.signal.kind})`;
    note(
      PROGRESS_FORCED_LABEL,
      { step, trip: due.trip, signal: due.signal.kind, forced, ...(recordTools > 0 ? { recordTools } : {}) },
      forced !== "finish"
        ? `${head} — this turn offers ${FORCED_MENU[forced]} and requires a call.`
        : recordTools > 0
          ? `${head} — ${why}: this turn offers only the ${recordTools} ticket tool(s) to record what is still open, and the run writes its final report.`
          : `${head} — ${why}: this turn offers no tools and the run writes its final report.`,
    );
  }

  /** Decide one turn: the policy's selection (the hand-off tool leaves it once planning closes) and the forced turn, when a rule forced one. */
  async decide(env: TurnEnv, step: number, select: () => Promise<readonly ToolSchema[]>, cache: CacheServedStreak): Promise<{ selected: readonly ToolSchema[]; turn: ForcedTurn | null }> {
    // A finishing run's turn is taken FIRST — before the plan budget can force (or end) a hand-off.
    const finishing = this.finishingTurn(env.ctx);
    // Analysis that has spent its budget ends HERE, BEFORE selection.
    const handOffTurn = finishing ? null : planBudgetTurn(env, step);
    const ranked = await select();
    // Once the run is coding, the plan is handed off: the hand-off tool is gone from the menu, so a coder can never re-plan the work it was just given.
    const selected = offersHandOff(env.ctx.state.model) ? ranked : ranked.filter((t) => t.function.name !== this.opts.handOffTool);
    const turn = finishing ?? handOffTurn ?? changeBudgetTurn(env, step, selected) ?? noProgressTurn(env, step, selected, cache) ?? this.guardTurn(env, step, selected);
    return { selected, turn };
  }
}

/** Ask the ladder for one step's turn and leave the rows it decided on the run's timeline (`onEvent`). */
export async function ladderTurn(
  ladder: ForcedLadder,
  ctx: PolicyContext,
  env: { select(): Promise<readonly ToolSchema[]>; cache: CacheServedStreak },
  onEvent: ((row: { tool: string; detail: Record<string, unknown>; result: string }, at: { step: number }) => Promise<void> | void) | undefined,
): Promise<ForcedTurnResult> {
  const rows: Array<{ tool: string; detail: Record<string, unknown>; result: string }> = [];
  const note: Note = (tool, detail, result) => { rows.push({ tool, detail, result }); };
  const { selected, turn } = await ladder.decide({ ctx, bind: ladder.bind, opts: ladder.opts, note }, ctx.step, env.select, env.cache);
  for (const row of rows) await onEvent?.(row, { step: ctx.step });
  return { selected, ...(turn ? { menu: menuOf(turn) } : {}) };
}

/** A forced turn as the menu the kernel advertises. */
export function menuOf(turn: ForcedTurn): NonNullable<ForcedTurnResult["menu"]> {
  return { tools: turn.tools, ...(turn.toolChoice ? { toolChoice: turn.toolChoice } : {}), tail: [turn.brief], ...(turn.final ? { final: true as const } : {}) };
}
