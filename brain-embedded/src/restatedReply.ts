/**
 * A reply that RESTATES the previous turn's answer instead of moving the work forward.
 *
 * Measured on chat #126 (92 turns): each new user turn re-derived the same status from
 * scratch — tickets, `git_status`, the whole 215 KB roadmap, the same detector files —
 * and ended on the same "not complete" summary it had given the turn before. The user
 * already had that answer; a second copy is a turn spent producing nothing. So a final
 * reply that is mostly the previous final reply is sent back ONCE: act on the next
 * unfinished piece, or say what blocks it.
 *
 * Measured by word 3-gram CONTAINMENT (how much of the new reply was already in the old
 * one), not symmetric similarity: a reply that repeats the old table and adds one line is
 * still a restatement. Short replies are exempt — "Done." twice is not a loop. Pure.
 */

import type { ChatCompletionMessage } from './streamChatCompletion';

/** Replies shorter than this many words are never judged — too little to be a loop. */
export const RESTATED_MIN_WORDS = 40;
/** Share of the new reply's 3-grams that already appeared in the previous reply. */
export const RESTATED_CONTAINMENT = 0.6;

function textOf(content: ChatCompletionMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : ''))
      .join(' ');
  }
  return '';
}

/**
 * The assistant's final reply to the PREVIOUS user turn: the last assistant text that
 * precedes the latest user message. Empty when this is the conversation's first turn.
 */
export function previousReplyText(convo: readonly ChatCompletionMessage[]): string {
  let i = convo.length - 1;
  while (i >= 0 && convo[i]!.role !== 'user') i--;
  for (i -= 1; i >= 0; i--) {
    const m = convo[i]!;
    if (m.role === 'user') return '';
    if (m.role === 'assistant') {
      const text = textOf(m.content).trim();
      if (text) return text;
    }
  }
  return '';
}

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9#\s]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Whether `current` mostly repeats `previous`. */
export function isRestatedReply(current: string, previous: string): boolean {
  const now = shingles(current);
  if (now.size + 2 < RESTATED_MIN_WORDS || !previous.trim()) return false;
  const before = shingles(previous);
  let seen = 0;
  for (const s of now) if (before.has(s)) seen += 1;
  return seen / now.size >= RESTATED_CONTAINMENT;
}

/** The correction the run is sent back with. */
export function restatedReplyNudge(): string {
  return [
    'Your reply repeats the status you already gave the user last turn — they have it. Do not restate it.',
    'Instead: take the FIRST unfinished item and do it now, with tools. If every remaining item is blocked, say which one and exactly what would unblock it, in one or two lines.',
    'If the remaining items are not yet tickets, file one ticket per item (builtin_tasks_create, linked to this chat) so the status lives on the board instead of in a repeated summary.',
    'End with only what CHANGED this turn.',
  ].join('\n');
}
