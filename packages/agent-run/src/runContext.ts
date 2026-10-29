/**
 * The run's shared shapes: what a caller hands the agent, what one turn sees, the
 * context every policy hook reads, and the trace emit. Split out of `runAgent.ts` so the
 * driver holds only the composition (PRD 35 §5 rule 4).
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { ParsedToolCall } from "@builderforce/agent-loop";
import type { EventSink, RunEvent, RunMessage, RunPolicy, RunPorts, RunState, RunTask } from "./contract.js";
import type { PolicyContext, PolicyModules, PolicyToolCall } from "./policy/index.js";
import type { TurnInterruption } from "./surface.js";

/** What a caller hands the agent. */
export interface RunAgentInput {
  task: RunTask;
  policy: RunPolicy;
  ports: RunPorts;
  /** The state a prior invocation saved, to resume from. */
  resume?: RunState;
  /** Steps this invocation may take before yielding. `1` on a cloud tick; unbounded when omitted. */
  maxSteps?: number;
  /** The cancellation signal. A fired signal settles the run `failed` with reason `cancelled`. */
  signal?: AbortSignal;
  /**
   * Replace a policy module WHOLE. A test drives one module this way, and an adapter
   * binds a module's ENGINE ports this way (`createFinishHook(ports)`,
   * `createGuardsHook(ports)`, `createVerifyHook(ports)`) — the module stays the
   * policy's; the adapter only hands it the couplings its surface has.
   */
  modules?: Partial<PolicyModules>;
}

/** What one turn of the run sees. Rebuilt per turn, because the hooks may have changed it. */
export interface TurnView {
  messages: RunMessage[];
  tools: ToolSchema[];
  model?: string;
  maxTokens?: number;
}

/** The context every hook sees, for one moment of the run. */
export function policyContext(input: RunAgentInput, state: RunState, view: TurnView, step: number, turn: number): PolicyContext {
  return {
    task: input.task,
    policy: input.policy,
    state,
    ports: input.ports,
    step,
    turn,
    messages: view.messages,
    tools: view.tools,
    signal: input.signal,
  };
}

/**
 * Apply a hook's compaction, recording what it dropped. The transcript is rewritten IN
 * PLACE: it is the array the kernel holds (`view.messages` is that same array), so
 * assigning a new one would leave the kernel sending the uncompacted rows.
 */
export function applyCompaction(state: RunState, view: TurnView, result: { messages: RunMessage[]; dropped: number; reserveTokens?: number }, step: number): void {
  view.messages.splice(0, view.messages.length, ...result.messages);
  state.messages = view.messages;
  state.compaction = {
    compactions: state.compaction.compactions + 1,
    lastCompactedStep: step,
    ...(result.reserveTokens !== undefined ? { reserveTokens: result.reserveTokens } : {}),
    droppedMessages: result.dropped,
  };
}

/**
 * What the turn that just ended tells the hooks that run after it: how it was served and
 * whether it was cut off (read by the stall ladder and by the dispatch of its calls), and
 * whether a call in it was declined (said once, after the round).
 */
export interface TurnFacts {
  model?: string;
  interruption?: TurnInterruption;
  /** A call with unusable arguments was declined this round. */
  refused: boolean;
}

/** The view a hook reads: the transcript and the tools as they stand. */
export function currentView(transcript: RunMessage[], offered: ToolSchema[]): TurnView {
  return { messages: transcript, tools: offered };
}

/** A tool call as the policy hooks see it. */
export function toPolicyCall(call: ParsedToolCall): PolicyToolCall {
  return { id: call.id, name: call.name, args: call.args };
}

/** Emit one trace event. A sink that throws must not sink the run. */
export async function emit(events: EventSink, event: RunEvent): Promise<void> {
  try {
    await events.emit(event);
  } catch {
    // Telemetry is best-effort. A broken sink records nothing; it does not fail the run.
  }
}

