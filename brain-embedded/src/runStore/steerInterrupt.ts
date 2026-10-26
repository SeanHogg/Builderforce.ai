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
 */

import type { AfterDispatchDecision, LoopHooks } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { drainRunSteering, hasRunInterrupt, onRunInterrupt, type RunSteerMessage } from '../runSteering';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';

type RunTool = (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;

/** What the model reads on the command a steer interrupted. */
export const INTERRUPTED_BY_STEER =
  "Interrupted by the user's new message: the command was stopped before it finished. Read the message that follows and do what it asks; re-run the command only if it still applies.";

/** What the model reads on a wait a steer cut short — the job itself runs on. */
export const WAIT_INTERRUPTED_BY_STEER =
  "Wait interrupted by the user's new message: the background job is STILL RUNNING. Read the message that follows and do what it asks; check the job later with command_status, or stop it with command_stop.";

/** What the model reads on a call the steer skipped. */
export const SKIPPED_BY_STEER =
  "Not run: the user sent a new message while this turn was running. Read it and decide what to do next.";

function argsOf(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

/** A call that WAITS on a background job: a `yieldMs` foreground window, or a `command_status` wait. */
function isWaitCall(name: string, a: Record<string, unknown>): boolean {
  if (name === 'run_command') return a.background !== true && a.yieldMs != null;
  return name === 'command_status' && typeof a.waitMs === 'number' && a.waitMs > 0;
}

/**
 * The calls a steer may abort: a FOREGROUND shell command, and a wait on a background
 * job (the wait is the step; the job is not). Starting a job with `background:true`
 * returns at once, so there is nothing to interrupt.
 */
export function isInterruptibleCall(name: string, args: unknown): boolean {
  const a = argsOf(args);
  if (isWaitCall(name, a)) return true;
  return name === 'run_command' && a.background !== true;
}

function interruptedResult(out: unknown): Record<string, unknown> {
  const base = out && typeof out === 'object' && !Array.isArray(out) ? (out as Record<string, unknown>) : out === undefined ? {} : { output: out };
  return { ...base, ok: false, aborted: true, interrupted: true, error: INTERRUPTED_BY_STEER };
}

/** A wait the steer cut short: its status so far, said to be a wait that ended — not the job. */
function waitInterruptedResult(out: unknown): Record<string, unknown> {
  const base = out && typeof out === 'object' && !Array.isArray(out) ? (out as Record<string, unknown>) : { output: out };
  return { ...base, interrupted: true, note: WAIT_INTERRUPTED_BY_STEER };
}

/** Did the call come back STOPPED (the step signal reached it), not merely finished? */
function cameBackAborted(out: unknown): boolean {
  return !!out && typeof out === 'object' && (out as Record<string, unknown>).aborted === true;
}

/**
 * Run one call; a foreground command gets a step signal that the run's Stop and an
 * interrupting steer both abort. Any other call is made exactly as before.
 */
export async function runToolInterruptibly(runTool: RunTool, runKey: number, runSignal: AbortSignal | undefined, name: string, args: unknown): Promise<unknown> {
  if (!isInterruptibleCall(name, args)) return runTool(name, args);
  // The person's message is already waiting: the command it would interrupt never starts.
  if (hasRunInterrupt(runKey)) return interruptedResult(undefined);
  const wait = isWaitCall(name, argsOf(args));
  const step = new AbortController();
  let interrupted = false;
  const onStop = (): void => step.abort();
  if (runSignal?.aborted) step.abort();
  runSignal?.addEventListener('abort', onStop, { once: true });
  const off = onRunInterrupt(runKey, () => {
    interrupted = true;
    step.abort();
  });
  try {
    const out = await runTool(name, args, step.signal);
    if (!interrupted) return out;
    // A wait ends with the job still running: the status so far, marked as interrupted.
    if (wait) return cameBackAborted(out) ? interruptedResult(out) : waitInterruptedResult(out);
    // Interrupted only if the command really was stopped; one that finished first stands.
    return cameBackAborted(out) ? interruptedResult(out) : out;
  } finally {
    off();
    runSignal?.removeEventListener('abort', onStop);
  }
}

type AfterDispatch = NonNullable<LoopHooks<ChatCompletionMessage>['afterDispatch']>;

/** Wrap `afterDispatch`: once an interrupting message is waiting, the turn's remaining
 *  calls are not run (each gets a "skipped" row) and the next model call hears it. */
export function skipOnSteer(runKey: number, inner: AfterDispatch): AfterDispatch {
  return async (call, result, row, ctx) => {
    const post = (await inner(call, result, row, ctx)) as AfterDispatchDecision | undefined;
    if (post?.skipRemaining || !hasRunInterrupt(runKey)) return post;
    return { ...(post ?? {}), skipRemaining: { data: { ok: false, skipped: true, error: SKIPPED_BY_STEER }, isError: false } };
  };
}

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
