/**
 * The Brain's binding of the ONE transcript summarizer (`summarizeTranscript`,
 * `@seanhogg/builderforce-memory/working`) onto its streaming transport. The prompt,
 * rendering and budget are the memory package's; this only turns the run's stream into
 * the summarizer's completion port, so a compaction fold, a hand-off note and a chat
 * "Consolidate" all compress through the same call.
 */

import { summarizeTranscript, type SummaryCompletion } from '@seanhogg/builderforce-memory/working';
import type { ChatCompletionMessage, StreamChatOptions, StreamChatResult } from './streamChatCompletion';

/**
 * The slice of the run's streaming transport the summarizer uses — typed structurally so
 * this module does not depend on the run store (`BrainStreamFn` satisfies it).
 */
export type SummaryStreamFn = (
  opts: Omit<StreamChatOptions, 'transport'>,
) => Promise<Pick<StreamChatResult, 'text'>>;

/** The summarizer's completion over the run's stream: one no-tools, no-reasoning call.
 *  A note is a UTILITY completion, never the run's full output ceiling or thinking depth. */
export function streamSummaryCompletion(stream: SummaryStreamFn, model: string | undefined): SummaryCompletion {
  return async ({ system, user, maxTokens, signal }) => {
    const res = await stream({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      model,
      maxTokens,
      reasoning: { level: 'off' },
      signal,
    });
    return res.text;
  };
}

/** Compress `msgs` into a memory note with the run's model. Null on any failure/empty, so
 *  the caller falls back (drop-oldest, elision). */
export function summarizeMiddle(
  stream: SummaryStreamFn,
  model: string | undefined,
  msgs: ChatCompletionMessage[],
  signal: AbortSignal | undefined,
): Promise<string | null> {
  return summarizeTranscript(streamSummaryCompletion(stream, model), msgs, signal);
}
