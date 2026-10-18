/**
 * runEndMemory — the verify-then-remember tail every run loop shares.
 *
 * TWO findings, ONE seam. A run loop used to end the moment the agent stopped: it
 * never told the run policy it had entered verification, and it never wrote down
 * anything it had learned. Both are fixed here so no loop re-invents them:
 *
 *   1. {@link runVerifyPhase} walks a run through the `verify` phase declared by
 *      `@builderforce/run-policy` — the `verify_started` event in that package's
 *      `RunPolicyEvent` union, which until now NO loop ever emitted, so the policy
 *      that is meant to gate runs on a verify step never saw one. A loop observes the
 *      phase only by feeding the returned event back through `reduceRunPolicy`.
 *
 *   2. {@link commitRunMemory} writes the run's outcome into the EXISTING governed
 *      memory (`buildMemoryCapability(...).remember` — the same capability the cloud
 *      run's `memory` tool and the container's `memory` op already use). No parallel
 *      store is invented here; this only calls what is already there.
 *
 * BOTH ARE BEST-EFFORT. A run that verified but could not remember is still a
 * finished run: neither call throws, and neither may lose the run's result.
 */

import { buildMemoryCapability } from '../../memory/memoryService';
import { reduceRunPolicy, type RunPolicyState } from '@builderforce/run-policy';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { inRunVerifyOutcome, type InRunVerifyOutcome } from './inRunVerify';

/** Which run loop called in. `brain-reply` has no shell and no branch, exactly like
 *  `durable`, so it shares that surface's "run nothing, record what actually ran"
 *  semantics; it is kept as its own name so the recorded verdict still says which
 *  loop ran it. */
export type RunVerifySurface = 'durable' | 'container' | 'github_actions' | 'on-prem' | 'brain-reply';

/** Surfaces with a real shell — the ones that may RUN a check rather than only
 *  record one. A chat reply and a DO worker have none, and must never fake one. */
type ShellSurface = Exclude<RunVerifySurface, 'durable' | 'brain-reply'>;
const SHELL_SURFACES: ReadonlySet<RunVerifySurface> = new Set<ShellSurface>(['container', 'github_actions', 'on-prem']);
const hasShell = (surface: RunVerifySurface): surface is ShellSurface => SHELL_SURFACES.has(surface);

export interface RunVerifyInput {
  /** WHICH runtime ran it — the surface is part of the recorded verdict. */
  surface: RunVerifySurface;
  /** The files this run actually wrote. Nothing written ⇒ nothing to verify, and the
   *  outcome says `nothing_written` rather than inventing a check. */
  writtenPaths?: ReadonlySet<string> | readonly string[] | null;
  /** `package.json` scripts, when the caller already read them. */
  packageScripts?: Record<string, string> | null;
  /** Runs one declared script and returns its exit code. */
  runner?: Parameters<typeof inRunVerifyOutcome>[0]['runner'];
  /** A check already run by the caller (the durable static/branch check, the
   *  container's own shell); supplied instead of `runner` so nothing runs twice. */
  results?: Parameters<typeof inRunVerifyOutcome>[0]['results'];
}

/**
 * The verification action a loop performs before it may finish: the project's own
 * checks over what the run wrote, decided by the unit-tested
 * {@link inRunVerifyOutcome} so every surface draws the SAME line about what counts
 * as verified. It performs nothing itself — it selects the commands from what the
 * caller ran, which is what keeps the durable (shell-less) surface honest.
 */
export function runVerifyPhase(input: RunVerifyInput): InRunVerifyOutcome {
  // A shell-less surface can only RECORD checks its caller already ran; handing it a
  // runner would let a chat reply claim a test run that never happened.
  if (!hasShell(input.surface)) {
    return inRunVerifyOutcome({
      surface: 'durable',
      writtenPaths: input.writtenPaths ?? [],
      results: input.results ?? null,
    });
  }
  return inRunVerifyOutcome({
    surface: input.surface === 'on-prem' ? 'durable' : input.surface,
    writtenPaths: input.writtenPaths ?? [],
    packageScripts: input.packageScripts ?? null,
    runner: input.runner,
    results: input.results ?? null,
  });
}

/** One-line human summary of a verify outcome, for the timeline and the fact body. */
export function describeVerifyOutcome(outcome: InRunVerifyOutcome): string {
  if (outcome.kind === 'skipped') return `verify skipped (${outcome.reason})`;
  if (outcome.commands.length === 0) return `verify ${outcome.kind}, no commands`;
  const failed = outcome.failedCommands.length;
  return `verify ${outcome.kind}: ${outcome.commands.join('; ')}${failed > 0 ? ` — ${failed} failed` : ''}`;
}

/**
 * Apply the `verify_started` event through the run policy's reducer and return the
 * new state — the one call that actually moves a run into its `verify` phase.
 *
 * This is the half of finding 11 that `policy.ts` cannot fix by itself: the event was
 * DECLARED there and its reducer HANDLED it, but no loop ever emitted it, so the
 * policy meant to gate runs on a verify step never saw one. Every loop applies this
 * instead of inventing its own phase transition (or its own event name).
 */
export function applyVerifyPhase(state: RunPolicyState): RunPolicyState {
  return reduceRunPolicy(state, { type: 'verify_started' });
}

/** Where a run's verify verdict is recorded. */
export interface RunVerifyAudit {
  db: Db;
  tenantId: number;
  executionId: number | null;
  cloudAgentRef?: string;
}

/**
 * Emit BOTH halves of the verify phase onto the run's timeline: the `verify_started`
 * event the run policy declares, and the paired completion carrying the real verdict.
 *
 * The policy event is RETURNED rather than applied — the caller owns its policy state
 * and feeds it through `reduceRunPolicy` (only a host holding the state can move its
 * own phase), and `verify_started` carries no payload by declaration.
 */
export function recordRunVerifyEvents(
  audit: RunVerifyAudit,
  outcome: InRunVerifyOutcome,
): { started: { type: 'verify_started' } } {
  const detail = {
    surface: outcome.surface,
    kind: outcome.kind,
    reason: outcome.reason,
    commands: outcome.commands,
    failedCommands: outcome.failedCommands,
    mayFinish: outcome.mayFinish,
  };
  // Start, then completion, in the order the run performed them. Best-effort: the
  // timeline is observability, and losing it must never cost the run its result.
  try {
    void recordCloudToolEvent(audit.db, {
      tenantId: audit.tenantId,
      cloudAgentRef: audit.cloudAgentRef,
      executionId: audit.executionId,
      toolName: 'run_policy',
      category: 'policy',
      detail: { event: 'verify_started' },
      result: `run entered the verify phase (surface ${outcome.surface})`,
    });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgent/runEndMemory.ts',
      operation: 'recordVerifyStarted',
    });
  }
  try {
    void recordCloudToolEvent(audit.db, {
      tenantId: audit.tenantId,
      cloudAgentRef: audit.cloudAgentRef,
      executionId: audit.executionId,
      toolName: 'in_run_verify',
      category: 'tool',
      detail,
      result: outcome.note,
    });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgent/runEndMemory.ts',
      operation: 'recordVerifyCompleted',
    });
  }
  return { started: { type: 'verify_started' } };
}

export interface RunMemoryCommitInput {
  db: Db;
  env: Env;
  tenantId: number;
  projectId?: number | null;
  ticketId?: number | null;
  executionId?: number | null;
  cloudAgentRef?: string;
  /** What the run DID — its own summary of the work, the fact the next run needs. */
  summary: string;
  /** What the run verified, in one line (see {@link describeVerifyOutcome}). */
  verifyNote?: string;
  /** The files the run wrote, so the fact points at them. */
  writtenPaths?: readonly string[] | null;
  /** An extra fact worth keeping (e.g. an in-run verify failure worth not repeating). */
  learning?: string;
  tags?: string[];
}

/** Facts below this length are noise; a "learning" of four words teaches nothing. */
const MIN_COMMIT_BODY = 24;

/** Stable, bounded memory key per run — a re-delivered completion upserts, not duplicates. */
function runFactKey(input: RunMemoryCommitInput): string {
  const scope = input.ticketId != null
    ? `ticket-${input.ticketId}`
    : input.projectId != null ? `project-${input.projectId}` : 'run';
  const id = input.executionId != null ? String(input.executionId) : String(Math.trunc(Date.now() / 1000));
  return `run-outcome:${scope}:${id}`;
}

/**
 * Commit what a run learned, through the EXISTING memory contract. Returns whether the
 * write landed — a caller logs that, and NEVER lets `false` fail or delay its run.
 */
export async function commitRunMemory(input: RunMemoryCommitInput): Promise<boolean> {
  const body = input.learning?.trim() || input.summary.trim();
  if (body.length < MIN_COMMIT_BODY) return false;
  try {
    const memory = buildMemoryCapability({
      db: input.db,
      env: input.env,
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      ticketId: input.ticketId ?? null,
      origin: 'cloud-run',
      executionId: input.executionId ?? null,
    });
    const paths = (input.writtenPaths ?? []).filter((p) => typeof p === 'string' && !!p).slice(0, 25);
    const parts = [body];
    if (input.verifyNote) parts.push(input.verifyNote);
    if (paths.length > 0) parts.push(`changed: ${paths.join(', ')}`);
    await memory.remember(runFactKey(input), parts.join('\n'), {
      tags: ['run-outcome', ...(input.tags ?? [])],
      importance: 0.6,
    });
    return true;
  } catch (error) {
    // Best-effort by contract: the run already finished; a memory write that fails is
    // reported, not propagated.
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgent/runEndMemory.ts',
      operation: 'commitRunMemory',
    });
    return false;
  }
}