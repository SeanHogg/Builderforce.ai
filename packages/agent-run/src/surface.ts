/**
 * surface — the optional ports a surface with its OWN tools and its OWN deliverables
 * hands the agent (PRD 35 §3.2, WS4 canvas).
 *
 * The Creation Canvas runs the board's tools (`canvas_*`, the tenant's MCP catalog) and
 * owes the user things the shared registry knows nothing about: a canvas change, an app
 * that was written, a document of the requested length. Two ports carry that, and both
 * are DATA plus the surface's own facts — never a loop and never a rule:
 *
 *   • {@link PlatformTools} — the surface's tools as a capability provider on the same
 *     run: what it can run right now, how to run one, and which of its calls hand the
 *     run from analysis to code. The tools policy narrows the catalog per turn.
 *   • {@link DeliveryLedger} — what the task still owes when a turn ends in prose, as
 *     {@link LadderRung}s. The stall policy walks them: restate, hand to a model that
 *     already acted, then fail, settle or fall through. The MECHANICS are the stall
 *     module's (`policy/stall/ladder.ts`); the surface supplies only which rungs hold
 *     and the words each one says.
 *
 * Plain types only, no `node:*`, no DOM.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { RunPolicyEvent, RunPolicyOutcome } from "@builderforce/run-policy";

/** Why a turn ended without having finished: the output ceiling, or a call the provider could not parse. */
export type TurnInterruption = "truncated" | "malformed-tool-call";

/** How a completion failed in transport, in the run policy's own words. */
export type TransportFailure = Extract<RunPolicyEvent, { type: "transport_failed" }>;

/** The ladder counters a surface reads to know how far a rung has gone (`RunState.stall.rungs`). */
export interface LadderProgress {
  readonly rungs: Readonly<Record<string, number>>;
}

/** What a platform tool returned: the payload the model reads, and whether it failed. */
export interface PlatformToolResult {
  data: unknown;
  isError?: boolean;
}

/** How a tool call with unusable arguments is declined, in this surface's words. */
export interface MalformedCallPolicy {
  /** Appended to the truncated-call result: how THIS surface's tools take a long object. */
  retryHint?: string;
  /** Said once, after a round in which a call was declined — the remedy that matches why. */
  roundDirective(truncated: boolean): string;
  /** A call was declined (for the surface's trace). The tool never ran. */
  refused?(call: { name: string; arguments: string }, truncated: boolean, outcome: unknown): void;
}

/** The turn's relevance selection over the surface's catalog. */
export interface PlatformSelection {
  /** The text tools are scored against (the request, plus the latest exchange). */
  query: string;
  /** The most tools one completion advertises. */
  limit: number;
  /** Tools the prompt names — advertised whatever the query scores. */
  required: ReadonlySet<string>;
}

/** The surface's own tools, as a capability provider on the same run. */
export interface PlatformTools {
  /**
   * The surface's catalog is the whole catalog: the shared registry's core set is not
   * advertised beside it, every call is the surface's to run, and a name it does not know
   * is the surface's to answer. Absent ⇒ the surface runs only the names the shared
   * registry does not, and the registry's catalog strategy applies.
   */
  closed?: boolean;
  /** The tools the surface can run right now. Read every turn: a rung may withdraw some. */
  schemas(progress: LadderProgress): readonly ToolSchema[];
  /** The relevance selection the tools policy applies to {@link schemas}. */
  selection: PlatformSelection;
  /** Run one call. A refusal is a result the model reads, never a throw. */
  execute(name: string, args: Record<string, unknown>, env: { signal?: AbortSignal; progress: LadderProgress }): Promise<PlatformToolResult>;
  /** Does this call end analysis and begin the work? The first one hands the run to the coder. */
  handsOff?(name: string): boolean;
  /** How a call whose arguments never parsed is declined. Absent ⇒ the shared wording, no hint. */
  malformed?: MalformedCallPolicy;
}

/** What the stall ladder judges a turn that ended without calling a tool. */
export interface DeliveryTurn {
  /** What the model said. */
  content: string;
  /** Set when the turn was cut off rather than finished. */
  interruption?: TurnInterruption;
  /** The model that answered, as the gateway resolved it. */
  model?: string;
}

/** One rung of the ladder a prose-ended turn must clear. */
export interface LadderRung {
  /** The counter key (`RunState.stall.rungs`); stable across turns. */
  id: string;
  /** Does this rung hold for this turn? A rung that does not hold is stepped over. */
  applies: boolean;
  /** The directives for successive re-statements, softest first. */
  restate: readonly string[];
  /** Re-statements spent before a hand-off is tried (default 1). */
  free?: number;
  /**
   * What is said when the turn is handed to a model that already acted, in the surface's
   * words and naming the model that takes over. Absent ⇒ no hand-off is tried.
   */
  handoff?: (to: string) => string;
  /** Put what the model said into the transcript before the directive. */
  quote?: boolean;
  /** Said once with the run's first re-statement of this rung, and never again. */
  once?: string;
  /** What happens when every re-statement is spent. */
  spent: "fail" | "fall" | { settle: string };
  /** Called when evaluation reaches this rung, whether or not it applies. */
  reached?(): void;
  /** Called with the attempt number each time this rung re-states. */
  onRestate?(attempt: number): void;
}

/** How a provider failure is spoken to the model, in this surface's words. */
export interface ProviderFailureWording {
  /** Said when the turn moves to a model that already acted, naming it. */
  handoff: (to: string) => string;
  /** Said when the turn is re-asked of the gateway's pool. */
  reroute: string;
  /** The turn is being re-asked; for the surface's trace. */
  rerouted?(failure: { model?: string; message: string; step: number; outcome: Extract<RunPolicyOutcome, { kind: "retry_turn" }> }): void;
  /** No model is left: the turn is abandoned. */
  abandoned?(failure: { model?: string; message: string }): void;
}

/** What the task still owes, and how a prose-ended turn is judged. */
export interface DeliveryLedger {
  /** The rungs this turn must clear, in order. Read live: the surface's own facts decide which hold. */
  rungs(turn: DeliveryTurn): readonly LadderRung[];
  /** Rungs whose counters survive a hand-off to another model (every other rung starts fresh). */
  sticky?: readonly string[];
  /**
   * Which of the agent's generic stall behaviours the ledger REPLACES. Each is off unless
   * stated, so a surface that declares deliverables still gets the generic behaviour it
   * did not take over.
   */
  owns?: {
    /** The rungs are the stall judgement: the narration heuristics do not also run. */
    narration?: boolean;
    /** {@link DeliveryLedger.accept} shapes the settled answer (the generic trim and ask-lift do not run). */
    settle?: boolean;
    /** The surface composes its own closing answer: no forced no-tools synthesis turn. */
    synthesis?: boolean;
  };
  /** The answer a turn that cleared every rung settles on. Used when {@link DeliveryLedger.owns}`.settle`. */
  accept?(content: string): string;
  /** The turn moved to another model (for the surface's session bookkeeping). */
  handedOff?(from: string | undefined, to: string): void;
  /** The wording of a provider failure's recovery. Absent ⇒ the failure is routed in silence. */
  providerFailure?: ProviderFailureWording;
}

/**
 * The error a transport throws when its provider failed in a way the model policy routes
 * around. The transport classifies (it knows its own errors); the policy decides.
 */
export interface ModelTransportFailure {
  failure: TransportFailure;
}

/** True for an error carrying a {@link TransportFailure}. */
export function isTransportFailure(err: unknown): err is Error & ModelTransportFailure {
  const failure = (err as { failure?: unknown } | null)?.failure;
  return err instanceof Error && !!failure && typeof failure === "object" && (failure as { type?: unknown }).type === "transport_failed";
}
