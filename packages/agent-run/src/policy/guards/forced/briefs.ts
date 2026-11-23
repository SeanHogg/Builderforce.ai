/**
 * policy/guards/forced — the words a forced turn says, and the labels and counts its rows carry. Data: a surface that
 * wants other words says so in its binding; every other reads these.
 */

import { PLAN_TURN_BUDGET } from "@builderforce/run-policy";

/** The trace label of a turn the progress guard forced (`detail.forced`: 'hand_off' | 'change' | 'finish'). */
export const PROGRESS_FORCED_LABEL = "loop.progress_forced";

/** Turns a finishing run may spend recording its remaining work as tickets, the finish turn itself included. */
export const FINISH_RECORD_TURNS = 3;

/** A forced hand-off's brief: why it is forced, then the one hand-off instruction. */
export function handOffBrief(reason: string, tool: string): string {
  return `${reason} ` +
    `Call ${tool} NOW. summary = the research for the coders: everything you and any research sub-agents established that the change needs ` +
    "(files, functions, what they do today, decisions, traps). tasks = each one standalone: the files, the change, and how to know it is done. " +
    "The coding agents start from exactly what you write here; they do not see this conversation.";
}

/** A forced change's brief: why it is forced, then the one change instruction — naming the question tool only when this turn offers it. */
export function changeBrief(reason: string, askTool: string | null): string {
  return `${reason} ` +
    "Make the change now with what you already know — the edit tools are the only ones offered this turn." +
    (askTool ? ` If something genuinely blocks the change, call ${askTool} and say exactly what.` : "");
}

/** The analysis budget's brief. */
export const handOffDueBrief = (tool: string): string => handOffBrief(`ANALYSIS IS OVER. You have spent ${PLAN_TURN_BUDGET} turns analysing without changing anything.`, tool);

/** The coding budget's brief. */
export const changeDueBrief = (codeTurns: number, askTool: string | null): string => changeBrief(`STOP READING. You have spent ${codeTurns} coding turns without changing anything.`, askTool);

/** The no-progress breaker's reason. */
export const circlingReason = (n: number): string =>
  `YOU ARE CIRCLING. Your last ${n} calls were all answered from this run's read cache — you already have every one of those results, and re-reading them changes nothing.`;

/** What a finish turn that offers the obligation tools adds to the detector's note. */
export const FINISH_RECORD_BRIEF =
  "You are FINISHING: make no more code changes and run nothing. Before your final report, file a ticket for EVERY item the person asked for that is still open (with the ticket tools offered on this turn), and update the status of the tickets you worked on. Then write the final report: what is done, and which ticket tracks each item that is not.";

/** What the last turn of a finishing run says. */
export const FINISH_FINAL_BRIEF = "Write your final report now: what is done, and which ticket tracks each requested item that is still open.";

/** The deferred finish's reasons for ending planning. */
export const DEFERRED_ENDS_PLANNING = "The run kept reading through its progress checks without handing off — analysis ends here and the coding role makes the change.";
export const DEFERRED_ENDS_PLANNING_STEERED = "The run kept reading through its progress checks without handing off — analysis ends here and the coding role takes the next turn.";
