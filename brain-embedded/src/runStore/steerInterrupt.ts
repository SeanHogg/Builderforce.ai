/**
 * The person's message INTERRUPTS the step in flight (PRD 35 E10, §6.3).
 *
 * A message typed mid-run used to wait for the running step to end — and a 5–10 minute
 * `run_command` kept "write the update now" away from the model that long. Now:
 *   1. a foreground shell command — and a WAIT on one (`run_command` `yieldMs`,
 *      `command_status` `waitMs`) — runs under a STEP signal derived from the run's: the
 *      run's Stop aborts it, and so does an interrupting steer (`queueRunSteering(…,
 *      { interrupt: true })`); its result tells the model it was interrupted. An
 *      interrupted wait leaves the background job running; only the wait ends. A call
 *      that would START after the message arrived is not started at all;
 *   2. the turn's remaining calls are skipped (`skipOnSteer`), as on-prem does;
 *   3. the message is drained in front of the next model call and recorded as one
 *      `steer.applied` step (`takeRunSteering`).
 * Every other tool is called exactly as before — the host lends it the run's own signal.
 *
 * The interrupt rule itself — which calls a steer may abort, the step signal, the
 * "interrupted" and "skipped" rows the model reads — lives ONCE, in `@builderforce/agent-run`
 * (`policy/steering`), over the same run-keyed queue (`../runSteering`). What stays here is
 * the Brain's own part: recording the drained direction on the run's trace.
 */

import {
  INTERRUPTED_BY_STEER,
  SKIPPED_BY_STEER,
  WAIT_INTERRUPTED_BY_STEER,
  isInterruptibleCall,
  runToolInterruptibly,
  skipOnSteer,
} from '@builderforce/agent-run';
import { drainRunSteering, type RunSteerMessage } from '../runSteering';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';

export { INTERRUPTED_BY_STEER, SKIPPED_BY_STEER, WAIT_INTERRUPTED_BY_STEER, isInterruptibleCall, runToolInterruptibly, skipOnSteer };

/** Drain the run's waiting direction for this turn and record it as `steer.applied`. */
export function takeRunSteering(c: RunCell, runKey: number, step: number): RunSteerMessage[] {
  const messages = drainRunSteering(runKey);
  if (messages.length > 0) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.applied',
      args: { step, messages: messages.length },
      result: messages.map((m) => m.text.slice(0, 200)).join('\n'),
    });
  }
  return messages;
}
