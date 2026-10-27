/**
 * Reading the working transcript's turns — the latest user text (the recall query and
 * the run's own request), whether it is a follow-up, and the last reply.
 */

import type { ChatCompletionMessage } from '../streamChatCompletion';

/**
 * The text of the most recent user turn in a transcript — the query the Evermind
 * recall runs against. A vision turn is `ContentPart[]`; we pull its text parts
 * (the image bytes aren't a recall query). Returns '' when there is no text.
 */
export function latestUserText(convo: ChatCompletionMessage[]): string {
  for (let i = convo.length - 1; i >= 0; i--) {
    const m = convo[i];
    if (m.role === 'user') return userTextOf(m);
  }
  return '';
}

/** One user turn's text — a vision turn's text parts joined, never its image bytes. */
export function userTextOf(m: ChatCompletionMessage): string {
  if (typeof m.content === 'string') return m.content.trim();
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : ''))
      .join(' ')
      .trim();
  }
  return '';
}

/**
 * Is the latest user turn a FOLLOW-UP — i.e. does anything precede it in the
 * conversation? A follow-up means what the turns above it make it mean, so no memory
 * tier keyed on the question's words may answer it or store its answer.
 */
export function isFollowUpTurn(convo: ChatCompletionMessage[]): boolean {
  let users = 0;
  for (const m of convo) {
    if (m.role === 'assistant') return true;
    if (m.role === 'user') users += 1;
  }
  return users > 1;
}

/**
 * The text of the most recent ASSISTANT turn — the counterpart to
 * {@link latestUserText}. Read as a pair to decide whether a bare directive
 * ("Fix") is a continuation of a proposal the previous turn left unfinished.
 * Walks backwards because the working transcript also carries `tool` rows and the
 * loop's own injected turns, so position alone does not identify a reply.
 */
export function lastAssistantText(convo: ChatCompletionMessage[]): string {
  for (let i = convo.length - 1; i >= 0; i -= 1) {
    const m = convo[i];
    if (m.role === 'assistant') return typeof m.content === 'string' ? m.content.trim() : '';
  }
  return '';
}
