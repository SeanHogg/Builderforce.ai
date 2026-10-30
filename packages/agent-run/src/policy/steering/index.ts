/**
 * policy/steering — `policy/steering/**` — the drain of user messages between steps, the steer that interrupts a step, and the stop that kills the tool in flight.
 *
 * Owned by WS2c. It ports, behind the {@link SteeringHook} the composition calls:
 *   - `runtime/cloudLoopControl.ts` (the between-iteration steering drain and the
 *     cooperative cancel watcher) — absorbed: the drain is `beforeTurn` over the
 *     `SteeringSource` port, cancel is the run's abort signal; `cancelNotice.ts`
 *     keeps only the cancelled-run notice;
 *   - `brain-embedded/src/runStore/steerInterrupt.ts` (the steer that interrupts the
 *     step in flight) — `steerInterrupt.ts`;
 *   - `packages/run-guards/src/stopIntent.ts` (a message typed during a run that IS a
 *     stop command) — `stopIntent.ts`;
 *   - the composer queue (brain-embedded run store) and on-prem `steeringQueue`: both
 *     are the SAME contract the port already names — a queue drained between steps
 *     whose messages are spliced in front of the next model call, and an interrupting
 *     message aborts the step in flight. The drain is the `SteeringSource` PORT
 *     (`RunPorts.steering.drain()`), so the policy is one rule for every surface and
 *     never branches on where the queue lives;
 *   - the SDK `SteeringChannel` semantics: same — the channel a steer is posted to
 *     mid-run drains between steps and reaches the next model call.
 *
 * The hook's {@link SteeringHook.inject} is the port's decision: it turns the drained
 * steer texts into the transcript rows the next model call reads, and it is where a
 * stop message (a text `stopIntent` matches) is surfaced as an interrupting steer.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { RunMessage, SteerInput, SteeringSource } from "../../contract.js";
import type { PolicyContext, SteeringHook } from "../hooks.js";
import { stopIntent } from "./stopIntent.js";
import type { InterruptWatch } from "./steerInterrupt.js";

/** A drained steer, read the same whether the port sent a bare string or a message. */
export function steerInput(raw: string | SteerInput): SteerInput {
  return typeof raw === "string" ? { text: raw } : raw;
}

/**
 * The port's interrupt watch: what the agent's dispatch listens on so an interrupting
 * steer aborts the foreground command in flight and skips the turn's remaining calls.
 * A port that cannot push an interrupt yields a watch that never fires — its steers
 * still reach the next model call, between steps.
 */
export function portInterruptWatch(source: SteeringSource | undefined): InterruptWatch {
  return {
    hasInterrupt: () => source?.hasInterrupt?.() ?? false,
    onInterrupt: (listener) => source?.onInterrupt?.(listener) ?? (() => undefined),
  };
}

/**
 * True when one of the drained texts IS a stop command (`stopIntent`). The agent then
 * cancels the run before the model gets another turn (PRD 35 §6.3, WS8e E10).
 */
export function isStopSteer(steered: readonly string[]): boolean {
  return steered.some((text) => stopIntent(text));
}

/** The steering hook, as it stands. */
export const steeringHook: SteeringHook = {
  inject(_ctx: PolicyContext, steered: readonly string[]): RunMessage[] | undefined {
    // A late steer is never lost: every drained message becomes the next user turn,
    // in the order the user sent them — the same contract the cloud loop, the
    // composer queue, on-prem's steeringQueue and the SDK SteeringChannel keep.
    if (steered.length === 0) return undefined;
    return steered.map((text): RunMessage => ({ role: "user", content: text }));
  },
};

export {
  INTERRUPTED_BY_STEER,
  SKIPPED_BY_STEER,
  WAIT_INTERRUPTED_BY_STEER,
  isInterruptibleCall,
  runInterruptWatch,
  runToolInterruptibly,
  runToolWithWatch,
  skipOnSteer,
  steerSkip,
  type InterruptWatch,
  type SteerMessage,
} from "./steerInterrupt.js";
export {
  drainRunSteering,
  hasRunInterrupt,
  newSteerKey,
  onRunInterrupt,
  queueRunSteering,
  resetRunSteering,
  runSteeringSource,
  type RunSteerMessage,
} from "./runSteering.js";
export { RUN_CANCELLED_NOTICE } from "./cancelNotice.js";
export { ABORT_TRIGGERS, isAbortTrigger, stopIntent } from "./stopIntent.js";
