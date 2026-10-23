/**
 * What the Hybrid router knows about a turn BEFORE it runs, in the shape the engine's
 * `run.local-success` task reads (`LocalTurnFeatures`, `@seanhogg/builderforce-memory-engine`).
 *
 * Every field is computed on this device from the call itself and the local target's
 * served window — no network, no model call. The scaling onto fixed log axes is the
 * engine's (`localSuccessFeatures`), so a weight means the same thing on every host;
 * this module only reads the raw counts. `priorLocalSuccessRate` is the router's to
 * fill from its own outcome history (`localSuccessRouter.ts`).
 */

import type { LocalTurnFeatures } from '@seanhogg/builderforce-memory-engine';
import { estimateTokensFromChars } from '@builderforce/workload';
import type { ChatCompletionMessage } from '../streamChatCompletion';

/** A turn's features minus the history-derived prior, which the router owns. */
export type TurnFeaturesBase = Omit<LocalTurnFeatures, 'priorLocalSuccessRate'>;

/** Edits, diffs and stack traces — the turns a small local model most often fumbles. */
const CODE_HEAVY = /```|^diff --git |^@@ [-+]\d|^\s+at \S+ \(?\S+:\d+:\d+\)?$|Traceback \(most recent call last\)/m;

/** The text of a message's content (text parts joined) — shared with the E5 verdict reader. */
export function contentText(content: ChatCompletionMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

function contentChars(content: ChatCompletionMessage['content']): number {
  return typeof content === 'string' ? content.length : JSON.stringify(content).length;
}

/**
 * The features of `call` against a local target serving `servedContextTokens` (0 when
 * the window is unknown — the engine reads a zero window as "no fill measured").
 */
export function localTurnFeatures(
  call: { messages: readonly ChatCompletionMessage[]; tools?: readonly unknown[] },
  servedContextTokens: number | undefined,
): TurnFeaturesBase {
  const users = call.messages.filter((m) => m.role === 'user');
  const last = users[users.length - 1];
  const promptChars = last ? contentChars(last.content) : 0;
  const totalChars = call.messages.reduce((n, m) => n + contentChars(m.content), 0)
    + (call.tools?.length ? JSON.stringify(call.tools).length : 0);
  const promptTokens = estimateTokensFromChars(promptChars);
  const attachments = last && typeof last.content !== 'string' ? last.content.filter((p) => p.type !== 'text').length : 0;
  return {
    promptTokens,
    contextTokens: Math.max(0, estimateTokensFromChars(totalChars) - promptTokens),
    servedContextTokens: Math.max(0, servedContextTokens ?? 0),
    tools: call.tools?.length ?? 0,
    turnIndex: Math.max(0, users.length - 1),
    attachments,
    codeHeavy: last ? CODE_HEAVY.test(contentText(last.content)) : false,
  };
}
