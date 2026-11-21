/**
 * The run VERDICT — the "Likely cause" a triager reads first — as one pure decision over
 * signals `computeBrainDiagnostics` has already measured. Split out of `brainTriage.ts` so
 * the ordering of causes (and the two states that are not causes at all: a run still in
 * flight, and a run with nothing to explain) lives in one small module instead of at the
 * bottom of a 1,400-line one.
 */

import { HISTORY_TOKEN_BUDGET } from '@seanhogg/builderforce-memory/working';
import type { BrainTraceEvent } from './brainTriage';
import { isFailedToolResult } from './toolFailure';
import { callTargetKey } from './runProgress';

/**
 * A prompt at or past this many tokens is context PRESSURE.
 *
 * DERIVED from the working transcript's own budget rather than guessed: the request is
 * the system prompt + the tool catalog + the history, and the first two are ~15–30k on a
 * coding turn, so a full prompt at the budget lands around 1.5×. A prompt below this is
 * the design working, not a symptom.
 *
 * It was a hardcoded 24k, written when the history budget was 24k and never moved when
 * the budget became 64k. Chat #113 therefore reported "Likely CONTEXT EXHAUSTION — the
 * prompt peaked at 90,129 tokens" on a turn that had exhausted nothing: 90k is what a
 * 64k-token transcript is SUPPOSED to cost.
 */
export const CONTEXT_PROMPT_PEAK = Math.round(HISTORY_TOKEN_BUDGET * 1.5);
/** A single LOSSY tool result at least this large is context pressure too. */
export const LARGE_LOSSY_RESULT_BYTES = 20_000;

/**
 * Best-effort verdict — the header a triager reads first. `healthy` is distinct
 * from `inconclusive`: the former means there is no failure to explain, the
 * latter that there IS one but the signals don't separate A from B. Collapsing
 * both into "inconclusive" made a clean run read as an unsolved problem.
 *
 * `run-in-progress` is not a cause: the run was still executing at capture, so every
 * "and then nothing happened" signal describes an unfinished run (chat #273 run #6,
 * captured 5 s in, read "Inconclusive" and "NOTHING WAS CHANGED"). It outranks all.
 *
 * `tool-calls-not-emitted` outranks the rest: a run that narrated its calls did
 * nothing at all, and every other signal on it reads clean.
 *
 * `no-tools-advertised` and `tool-not-advertised` outrank even that, because they are
 * OUR fault rather than the model's, and the remedy ("pick a different model") that
 * `tool-calls-not-emitted` prescribes is actively wrong for them.
 *
 * `provider-failure` (the LATEST run ended on a failed completion it did not recover from) outranks both of those: the
 * run ENDED on the provider, and a no-tools turn just before it is what a delivery gate's re-prompt looks like, not a
 * selection fault (VS Code chat #128305 read "TOOL NOT ADVERTISED" over an xAI doom-loop failure).
 *
 * `no-progress` sits above `context-exhaustion` and `model-degradation` for the same
 * reason: a run that re-read one file until its budget was gone will ALSO show a high
 * prompt peak and truncated tool results, so the context signals fire — but they are a
 * CONSEQUENCE of the loop, and acting on them (shrink the transcript, swap the model)
 * changes nothing. The loop has to be named first or it is never seen.
 *
 * `work-filed-not-staffed` sits LAST among the causes, above only `healthy`/`inconclusive`:
 * it is a verdict about the run's OUTCOME, not its mechanics, so any genuine exhaustion,
 * model fault or narrated-call failure explains the missing dispatch better and outranks it.
 */
export type LikelyCause =
  | 'run-in-progress'
  | 'memory-answered'
  | 'provider-failure'
  | 'no-tools-advertised'
  | 'tool-not-advertised'
  | 'tool-calls-not-emitted'
  | 'answered-in-prose'
  | 'no-progress'
  | 'context-exhaustion'
  | 'model-degradation'
  | 'app-errors-unresolved'
  | 'work-filed-not-staffed'
  | 'inconclusive'
  | 'healthy';

/** Everything the decision reads — each already measured by `computeBrainDiagnostics`. */
export interface VerdictSignals {
  running: boolean;
  memoryOnlyRun: boolean;
  /** The LATEST run ended on a failed completion it did not recover from (`providerFailureCause.ts`). */
  providerFailure: boolean;
  noToolsAdvertised: boolean;
  narratedUnadvertised: boolean;
  announcedUnmadeToolCall: boolean;
  answeredInProse: boolean;
  noProgress: boolean;
  contextSignal: boolean;
  degradationSignal: boolean;
  unresolvedAppFailures: number;
  workFiledNotStaffed: boolean;
  /** No failure left to explain — see {@link isHealthyRun}. */
  healthy: boolean;
}

/** The verdict, most-explanatory cause first. Pure. */
export function decideLikelyCause(s: VerdictSignals): LikelyCause {
  if (s.running) return 'run-in-progress';
  if (s.memoryOnlyRun) return 'memory-answered';
  if (s.providerFailure) return 'provider-failure';
  if (s.noToolsAdvertised) return 'no-tools-advertised';
  if (s.narratedUnadvertised) return 'tool-not-advertised';
  if (s.announcedUnmadeToolCall) return 'tool-calls-not-emitted';
  if (s.answeredInProse) return 'answered-in-prose';
  if (s.noProgress) return 'no-progress';
  if (s.contextSignal && !s.degradationSignal) return 'context-exhaustion';
  if (s.degradationSignal && !s.contextSignal) return 'model-degradation';
  if (s.unresolvedAppFailures > 0) return 'app-errors-unresolved';
  if (s.workFiledNotStaffed) return 'work-filed-not-staffed';
  return s.healthy ? 'healthy' : 'inconclusive';
}

const succeeded = (ev: BrainTraceEvent): boolean =>
  ev.category === 'tool' && !ev.isError && !isFailedToolResult(ev.result);

/**
 * The failed steps a LATER successful call on the same target (same command, same file) recovered — the shape of a
 * run that fixes what it broke: a guard fails, the agent edits, the guard passes. Chat
 * #275 failed three guard runs, fixed them, saw all 29 pass, committed and pushed — and
 * was reported "Inconclusive" because `errors > 0` alone ruled out `healthy`.
 *
 * Only TOOL failures can be recovered this way: a failed completion or an exhausted loop
 * is not undone by a later step, so it is never counted here.
 */
export function recoveredFailuresInTrace(events: readonly BrainTraceEvent[]): Set<BrainTraceEvent> {
  // The LAST outcome per target: a failure is recovered only when the final call aimed at
  // the same target (the same command, the same file — `callTargetKey`, never merely the
  // same tool) came after it and succeeded. A later failure on that target un-recovers it.
  const lastOnTarget = new Map<string, BrainTraceEvent>();
  for (const ev of events) if (ev.category === 'tool') lastOnTarget.set(callTargetKey(ev), ev);
  const recovered = new Set<BrainTraceEvent>();
  for (const ev of events) {
    if (!ev.isError || ev.category !== 'tool') continue;
    const last = lastOnTarget.get(callTargetKey(ev));
    if (last && last !== ev && succeeded(last)) recovered.add(ev);
  }
  return recovered;
}

/** Inputs to {@link isHealthyRun}. */
export interface HealthInputs {
  errors: number;
  /** Of `errors`, those {@link recoveredFailuresInTrace} found recovered. */
  recoveredFailures: number;
  loopExhausted: boolean;
  emptyOrLengthFinishes: number;
  contextSignal: boolean;
  announcedUnmadeToolCall: boolean;
  answeredInProse: boolean;
  noProgress: boolean;
  unresolvedAppFailures: number;
  didWork: boolean;
}

/**
 * Nothing left to explain: every failure (if any) was recovered by a later success, no
 * aborted loop, no truncated/empty turn, no context consequence, and the run actually did
 * something (a run that did NOTHING is not evidence of health).
 */
export function isHealthyRun(h: HealthInputs): boolean {
  return h.errors === h.recoveredFailures && !h.loopExhausted && h.emptyOrLengthFinishes === 0
    && !h.contextSignal && !h.announcedUnmadeToolCall && !h.answeredInProse && !h.noProgress
    && h.unresolvedAppFailures === 0 && h.didWork;
}
