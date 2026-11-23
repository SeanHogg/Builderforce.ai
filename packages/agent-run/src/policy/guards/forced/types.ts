/**
 * policy/guards/forced — the types of A3's forced-turn ladder, as DATA a surface binds.
 *
 * A3's trips (steer / escalate / finish) and the run-policy budgets (plan, change, no-progress) decide that a turn must
 * be narrower than the tools policy's menu: `hand_off` alone while planning, the change tools alone once coding, the
 * obligation (ticket) tools for a finishing run's record turns, then no tools at all (the run's final report). The
 * MECHANICS live once, here (`./ladder.ts`, `./turns.ts`); a surface supplies only the vocabulary (its hand-off tool, its
 * question tool, its obligation tools) and the facts the rules read (`ProgressFacts`). Never branches on
 * `RunPolicy.entryPoint`. No `node:*`, no DOM.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { ChildReportLike } from "@builderforce/agent-tools";
import type { ProgressAction } from "@builderforce/run-guards";

/** The trip a later turn's menu acts on: an escalation or a finish (a steer rides the next turn's opening, never forced). */
export type DueTrip = Exclude<ProgressAction, { kind: "advisory" } | { kind: "steer" }>;

/** The ladder's state across a step boundary (`LoopGuardState.forced`). Plain JSON. */
export interface ForcedLadderState {
  /** An escalate / finish a later turn's menu acts on — kept until one takes it, so a budget that forces the next turn first never drops it. */
  due?: DueTrip;
  /** An unverified finish was deferred once for a forced change turn. */
  deferred?: true;
  /** The run is FINISHING with its obligation tools on offer: how many more turns may still record work before the last one offers nothing. */
  recordLeft?: number;
  /** The run entered a finish (a record turn or its final no-tool turn): sticky for the rest of the run. */
  finishing?: true;
}

/**
 * A turn a progress rule decided. `tools` is the whole menu; `final` marks the run's own last turn (no tools, no call
 * required, never judged as a stall). `finishing` marks a finish / record turn: its brief is the whole say, so no steer rides along.
 */
export interface ForcedTurn {
  tools: ToolSchema[];
  toolChoice?: "required";
  /** The directive the turn's volatile tail carries. */
  brief: string;
  finishing?: true;
  final?: true;
}

/** The facts the rules read of the run, which only the surface holds. */
export interface ProgressFacts {
  /** The run was asked to CHANGE something (only then is any rule forced; a question answered after thirty reads is an answer). */
  budgeted(): boolean;
  /** The run edited code itself (a hand-off alone is not a change made HERE). */
  codeChanged(): boolean;
  /** The run made its change: edited code, or handed it to coders that run (an INLINE hand-off started none). */
  progressed(): boolean;
  /** The surface offers its question tool this run. */
  canAskUser(): boolean;
  /** The tools the work-linking directive declares as obligations (a finish may offer ONLY these). */
  obligationTools(): readonly string[];
}

/** The vocabulary and counts of the ladder — data, not code. */
export interface ProgressTurnOptions {
  /** The conversational hand-off tool (plan → code). */
  handOffTool: string;
  /** The conversational question tool. */
  askTool: string;
  /** How many turns a finish may spend recording its remaining work, the finish turn itself included. */
  recordTurns: number;
}

/** What a surface binds to the A3 detector and the forced-turn ladder (`GuardPorts.progress`). */
export interface ProgressBinding {
  /** A call that only reads. */
  isReadOnly?(tool: string, args: unknown): boolean;
  /** A call that may have changed ANY file, unnamed. */
  isUnscopedMutation?(tool: string, args: unknown): boolean;
  /** The run was asked for a CHANGE: only then does a read-only streak trip (a review reads and answers). */
  expectsChange?(): boolean;
  /** A non-file call the host counts as progress (a ticket created, a dispatch). */
  isPlatformProgress?(tool: string, args: unknown): boolean;
  /** Child reports that reached the run outside a call (an inbox message); drained at each turn's end. */
  childReports?(): readonly Pick<ChildReportLike, "state" | "changedFiles">[];
  /** The run's facts. */
  facts: ProgressFacts;
  /** The ladder's vocabulary. Absent ⇒ A3's trips keep their generic handling (a tier escalation, a tools-free final turn). */
  turns?: ProgressTurnOptions;
}

/** What the guards decided for a turn: the policy's selection (this turn's tools) and, when a rule forced it, the menu. */
export interface ForcedTurnResult {
  selected: readonly ToolSchema[];
  menu?: { tools: readonly ToolSchema[]; toolChoice?: "required"; tail: readonly string[]; final?: true };
}
