/**
 * policy/steering — `policy/steering/**` — the drain of user messages between steps, the steer that interrupts a step, and the stop that kills the tool in flight.
 *
 * Owned by WS2c. It ports, behind the {@link SteeringHook} the composition calls:
 *   - `runtime/cloudLoopControl.ts` (the between-iteration steering drain and the
 *     cooperative cancel watcher) — `cloudLoopControl.ts`;
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

import type { RunMessage } from "../../contract.js";
import type { PolicyContext, SteeringHook } from "../hooks.js";
import { stopIntent } from "./stopIntent.js";

/**
 * True when one of the drained texts IS a stop command — the SteerSource port then
 * marks it `interrupt: true`, and {@link runToolInterruptibly} aborts the step in
 * flight the way the Stop button does (PRD 35 §6.3, WS8e E10).
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
  runToolInterruptibly,
  skipRemainingOnSteer,
  steerAppliedTrace,
  type SteerApplied,
  type SteerMessage,
  type SteerRegistry,
} from "./steerInterrupt.js";
export {
  CLOUD_RUN_CANCELLED_REASON,
  CANCEL_POLL_MS,
  applyPendingSteering,
  startCancelWatcher,
  type CooperativeCancel,
  type LoopMessage,
  type SteerSink,
} from "./cloudLoopControl.js";
export { ABORT_TRIGGERS, isAbortTrigger, stopIntent } from "./stopIntent.js";
