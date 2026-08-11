import type { ChatCompletionMessage, ContentPart } from './streamChatCompletion';

const MAX_ROUTING_QUERY_CHARS = 4_000;
const ROUTING_USER_TURNS = 4;

function textContent(content: string | ContentPart[] | null | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/**
 * Context used only to choose tools for a turn.
 *
 * A correction such as "actually, make those weekly" contains almost no domain
 * nouns. Scoring tools against that sentence alone drops the scheduler/project
 * tools selected for the preceding request. Keep a small, bounded tail of user
 * intent so follow-ups inherit the task they refine without resending a whole chat.
 */
export function routingQueryForTurn(messages: readonly ChatCompletionMessage[]): string {
  const turns = messages
    .filter((message) => message.role === 'user')
    .map((message) => textContent(message.content).trim())
    .filter(Boolean)
    .slice(-ROUTING_USER_TURNS);
  return turns.join('\n').slice(-MAX_ROUTING_QUERY_CHARS);
}

/**
 * Small, stable model-facing contract that makes context-efficiency a platform
 * responsibility instead of a collection of user prompting rituals.
 */
export function turnOptimizationDirective(): string {
  return [
    'TURN OPERATING CONTRACT:',
    '• Infer a workable brief from the conversation, project memory, attachments and current request. Ask one grouped set of questions only when different answers would materially change the result; otherwise state a reasonable assumption briefly and proceed.',
    '• Treat corrections and “actually…” follow-ups as patches to the active brief. Preserve approved work and change the smallest requested scope; never regenerate unrelated content.',
    '• Complete all requested deliverables in this run. Batch independent reads/actions when the tool supports it, while preserving dependencies and confirmation boundaries.',
    '• In Work mode, plan enough to act safely and then execute in the same run. Do not make the user move to another surface just to turn a plan into work.',
    '• For attachments, inspect only the relevant pages/sections with builtin_attachments_read and its offset/limit controls. Accept the original file; never ask the user to convert, split, trim, or re-upload it merely to save context.',
    '• Reuse established project conventions, examples and explicit user preferences. A topic change is a new internal context segment, not a reason to make the user restart the chat.',
    '• Route work to the available model and tools transparently. Use a scheduling tool when the user expresses recurrence; do not ask them to repeat a routine manually.',
    '• Keep the response no longer than the task requires. Do not expose token windows, usage-reset timing, context cleanup, model-size folklore, or other platform limitations as work the user must manage.',
  ].join('\n');
}
