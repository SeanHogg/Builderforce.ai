/**
 * The `provider-failure` triage cause: the LATEST run ended on a failed `llm.complete` (a provider / stream failure the run did not
 * recover from). VS Code chat #128305 ended on an xAI doom-loop StreamInterruptedError after a delivery gate re-prompted a turn that
 * offered no tools — and triage named "TOOL NOT ADVERTISED", which sent the reader after the tool selection instead of the provider
 * failure (and the gate that caused it). Split out of `brainTriage.ts` (already large): the finding is measured here, ranked in
 * `brainVerdict.ts`, worded in `brainDiagnosticsText.ts`. Pure over the trace.
 */

import type { BrainTraceEvent } from './brainTriage';
import type { BrainMessage } from './types';
import { splitRuns } from './runSlices';

/** What the run's last, unrecovered failed completion was. */
export interface ProviderFailureFinding {
  /** The model the failed request was made to. */
  model: string;
  /** The error as recorded (`<name>: <message>`). */
  message: string;
  /** Whether the turn was retried on another model (`llm.stream_interrupted` / `llm.transport_error`) or the run failed over. */
  failoverTried: boolean;
  /**
   * The failed request offered NO tools and the step before it was a delivery gate's re-prompt (`loop.recover_*`): the model was
   * asked to act with nothing to act with.
   */
  gateRepromptedNoTools: boolean;
  /** The run kept the answer the gate had sent back instead of ending on the error (`loop.reprompt_failed_answer_kept`). */
  answerKept: boolean;
}

/** The labels that say a failed turn was retried on another model, or the run moved to another one. */
const RETRY_LABELS: ReadonlySet<string> = new Set(['llm.stream_interrupted', 'llm.transport_error', 'loop.model_failover']);

const isFailedCompletion = (ev: BrainTraceEvent): boolean => ev.label === 'llm.complete' && (ev.isError === true || ev.category === 'error');

const argsOf = (ev: BrainTraceEvent): Record<string, unknown> => (ev.args && typeof ev.args === 'object' ? (ev.args as Record<string, unknown>) : {});

/** The LATEST run's unrecovered provider failure, or null when its last completion did not fail. */
export function providerFailureInTrace(events: readonly BrainTraceEvent[], messages: readonly BrainMessage[] = []): ProviderFailureFinding | null {
  const slices = splitRuns(events, messages);
  const run = slices[slices.length - 1]?.events ?? [];
  const completions = run.map((ev, i) => ({ ev, i })).filter(({ ev }) => ev.label === 'llm.complete');
  const last = completions[completions.length - 1];
  if (!last || !isFailedCompletion(last.ev)) return null;
  const args = argsOf(last.ev);
  const failure = args.failure && typeof args.failure === 'object' ? (args.failure as { toolCount?: unknown }) : undefined;
  // What happened since the run's previous completion: a retry of THIS turn, and the re-prompt that asked for it.
  const previous = completions[completions.length - 2];
  const since = run.slice(previous ? previous.i + 1 : 0, last.i);
  const retried = since.some((ev) => RETRY_LABELS.has(ev.label));
  const reprompted = since.some((ev) => ev.label.startsWith('loop.recover_'));
  return {
    model: typeof args.model === 'string' && args.model ? args.model : 'default',
    message: typeof last.ev.result === 'string' ? last.ev.result : String(last.ev.result ?? 'unknown error'),
    failoverTried: retried,
    gateRepromptedNoTools: reprompted && failure?.toolCount === 0,
    answerKept: run.slice(last.i + 1).some((ev) => ev.label === 'loop.reprompt_failed_answer_kept'),
  };
}

/** The `provider-failure` verdict sentence. */
export function providerFailureVerdict(f: ProviderFailureFinding): string {
  const failover = f.failoverTried
    ? 'A failover to another model was tried and failed too.'
    : 'No failover to another model was tried.';
  const gate = f.gateRepromptedNoTools
    ? ' The request that failed came right after a delivery gate re-prompted the run: a delivery gate re-prompted a turn that offered no tools (the model was asked to act with nothing to act with).'
    : '';
  const headline = f.answerKept
    ? `PROVIDER FAILURE on the re-prompt — the run kept the answer it had already given. The re-prompt's completion on ${f.model} failed (${f.message}) and was not recovered.`
    : `PROVIDER FAILURE — the run's last completion on ${f.model} failed (${f.message}) and was not recovered, and the run ended on the error.`;
  return `${headline} ${failover}${gate} This is the provider's stream failing, not a tool the model was not offered: read the failed \`llm.complete\` step below.`;
}
