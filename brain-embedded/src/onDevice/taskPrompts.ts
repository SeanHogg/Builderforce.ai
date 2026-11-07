/**
 * The model-facing prompts for the generic (chat-model) route of each task, and the one
 * parser of a JSON reply. Shared by `structuredPrompt.ts` (the Prompt API) and
 * `completionOnDeviceTasks.ts` (any on-device chat completion) — one wording per task.
 * Not user-facing text; never localized.
 */

import type { JsonTaskOptions, RewriteOptions, SummarizeOptions, WriteOptions } from './onDeviceTasks';

export interface PromptPair {
  system: string;
  user: string;
}

const WORDS: Record<NonNullable<WriteOptions['length']>, string> = { short: 'a few sentences', medium: 'a short paragraph', long: 'several paragraphs' };

export function summarizePrompt(text: string, o: SummarizeOptions): PromptPair {
  const shape =
    o.kind === 'key-points' ? 'as a short bulleted list of the key points'
    : o.kind === 'transcript' ? 'as a faithful summary of this conversation: decisions made, facts established, open questions'
    : 'as a brief plain-text summary';
  const limit = o.maxWords ? ` in at most ${o.maxWords} words` : '';
  return {
    system: `You summarize text. Reply with the summary only, ${shape}${limit}. Do not add anything that is not in the text.${o.context ? ` Context: ${o.context}` : ''}`,
    user: text,
  };
}

export function rewritePrompt(text: string, o: RewriteOptions): PromptPair {
  const asks = [
    o.tone && o.tone !== 'as-is' ? `make the tone ${o.tone === 'more-formal' ? 'more formal' : 'more casual'}` : '',
    o.length && o.length !== 'as-is' ? `make it ${o.length}` : '',
    o.instruction ?? '',
  ].filter(Boolean);
  return {
    system: `You rewrite text. ${asks.length ? `${asks.join('; ')}. ` : ''}Keep the meaning and the language. Reply with the rewritten text only.`,
    user: text,
  };
}

export function writePrompt(task: string, o?: WriteOptions): PromptPair {
  return {
    system: `You write text on request, in ${WORDS[o?.length ?? 'medium']}. Reply with the text only.${o?.context ? ` Context: ${o.context}` : ''}`,
    user: task,
  };
}

export function proofreadPrompt(text: string): PromptPair {
  return {
    system: 'You proofread text. Fix spelling, grammar and punctuation only; change nothing else. Reply with the corrected text only.',
    user: text,
  };
}

/** A JSON task's prompt; `embedSchema` states the schema in words for models without a response constraint. */
export function jsonPrompt(o: JsonTaskOptions, embedSchema: boolean): PromptPair {
  return {
    system: embedSchema
      ? `${o.system}\n\nReply with ONLY a JSON value that satisfies this JSON Schema, no prose, no code fence:\n${JSON.stringify(o.schema)}`
      : o.system,
    user: o.user,
  };
}

/** The JSON value in a model reply (fenced or surrounded by prose), or null. */
export function parseJsonReply(reply: string): unknown | null {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const attempt = (s: string): unknown | null => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };
  const whole = attempt(text);
  if (whole !== null) return whole;
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : null;
}
