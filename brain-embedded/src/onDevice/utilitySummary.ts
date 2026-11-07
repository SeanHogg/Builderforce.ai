/**
 * The ONE seam for "a utility summary runs on the device first" (PRD 42 · C2).
 *
 * The transcript summarizer (`transcriptSummarizer.ts`) builds a `SummaryCompletion` over the
 * run's stream. A host that owns an {@link OnDeviceTasks} port lends it, and this wraps that
 * completion: the device is asked first (`summarize`, chunked by the port), and when it
 * declines — `null`: no API, model not ready, over the chunk budget, refused — the wrapped
 * completion runs exactly as before (the run's pin, then Auto under Hybrid; under Local only,
 * the other on-device engines). A fold, a hand-off note, canvas compaction and a local
 * Consolidate/Fork all compress through the summarizer, so they all take this path.
 */

import type { SummaryCompletion } from '@seanhogg/builderforce-memory/working';
import type { OnDeviceTasks, SummarizeOptions } from './onDeviceTasks';

/** Longest slice of the summarizer's own instructions handed to the device as its context. */
const CONTEXT_CHARS = 800;

/**
 * A {@link SummaryCompletion} request as the `OnDeviceTasks.summarize` call: the ONE mapping
 * (the transcript kind, the summarizer's own instructions as context, the caller's abort).
 */
export function transcriptSummaryOptions(
  request: Pick<Parameters<SummaryCompletion>[0], 'system' | 'signal'>,
  extra: Partial<SummarizeOptions> = {},
): SummarizeOptions {
  return {
    kind: 'transcript',
    context: request.system.slice(0, CONTEXT_CHARS),
    ...extra,
    ...(request.signal ? { signal: request.signal } : {}),
  };
}

/** `completion`, with the device asked first. No port ⇒ `completion` itself. Throws only an abort. */
export function onDeviceFirst(completion: SummaryCompletion, tasks: OnDeviceTasks | undefined): SummaryCompletion {
  if (!tasks) return completion;
  return async (request) => {
    const summary = await tasks.summarize(request.user, transcriptSummaryOptions(request));
    return summary?.trim() ? summary : completion(request);
  };
}
