/**
 * The per-turn VOLATILE block (cost lever B1).
 *
 * Everything that changes turn to turn — the limbic affect block, the budget line, the
 * structured task state — used to ride as a `system` message PREPENDED to the request.
 * Every vendor folds system messages into the head of the prompt, so any change there
 * invalidated the cached system prompt AND every cached history turn behind it.
 *
 * Under B1 those lines go into ONE `user` message appended AFTER the history, opened by
 * {@link VOLATILE_TAIL_TAG} so the direct Anthropic vendor places its history breakpoint
 * before it. A trailing user turn is valid after a tool-result turn on both the OpenAI
 * and the Anthropic shape (Anthropic merges it into the tool_result user turn), so
 * tool-call/result pairing is untouched. It is built per request and never persisted.
 */
import { VOLATILE_TAIL_TAG } from '../../llm/vendors/anthropic';

type Msg = Record<string, unknown>;

/** The tail message for these sections, or null when every section is empty. */
export function volatileTailMessage(sections: readonly string[]): Msg | null {
  const body = sections.map((s) => s.trim()).filter(Boolean).join('\n\n');
  return body ? { role: 'user', content: `${VOLATILE_TAIL_TAG}\n${body}\n</run-state>` } : null;
}

/**
 * The request messages for one turn.
 *  - `stablePrefix` off: today's shape — `dynamicSystem` prepended as a system message;
 *    any other volatile section (budget / task state, from their own levers) trails.
 *  - on: the persisted history untouched, every volatile section in the trailing block.
 */
export function turnRequestMessages(
  messages: readonly Msg[],
  opts: { stablePrefix: boolean; dynamicSystem?: string; sections: readonly string[] },
): Msg[] {
  const head = !opts.stablePrefix && opts.dynamicSystem
    ? [{ role: 'system', content: opts.dynamicSystem }, ...messages]
    : [...messages];
  const tail = volatileTailMessage(opts.stablePrefix ? [opts.dynamicSystem ?? '', ...opts.sections] : opts.sections);
  return tail ? [...head, tail] : head;
}
