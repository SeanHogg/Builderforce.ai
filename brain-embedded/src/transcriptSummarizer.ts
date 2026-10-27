/**
 * The Brain's binding of the ONE transcript summarizer (`summarizeTranscript`,
 * `@seanhogg/builderforce-memory/working`) onto its streaming transport. The prompt,
 * rendering and budget are the memory package's; this only turns the run's stream into
 * the summarizer's completion port, so a compaction fold, a hand-off note and a chat
 * "Consolidate" all compress through the same call.
 */

import { answerTextOf, stripReasoningTagsFromText, thoughtTextOf } from '@builderforce/agent-loop';
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
 *  A note is a UTILITY completion, never the run's full output ceiling or thinking depth.
 *
 *  `reasoning: off` is a request, not a guarantee: MiniMax and Kimi still think inline,
 *  and chat #5739's every fold note was "<think>We need produce memory compression…" —
 *  the note budget spent deliberating, the facts it should have carried lost, and the run
 *  re-reading what it had folded. The note is the ANSWER alone, never the markup. A reply
 *  that is nothing but reasoning (or a block the output ceiling cut off) keeps that
 *  reasoning's TEXT, untagged: it usually holds the facts, and an empty note would make
 *  the window re-run this whole call on every turn, since a failed fold is not memoized. */
export function streamSummaryCompletion(stream: SummaryStreamFn, model: string | undefined): SummaryCompletion {
  return async ({ system, user, maxTokens, signal }) => {
    const res = await stream({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      model,
      maxTokens,
      reasoning: { level: 'off' },
      signal,
    });
    const text = res.text ?? '';
    // Stripped once more: a reply whose every block is empty comes back from the
    // splitter as the raw markup it was, and markup is no note.
    return stripReasoningTagsFromText(answerTextOf(text) || thoughtTextOf(text));
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
