/** Shared fixtures for the window-fit tests (`src/windowFit/`). */
import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { ChatCompletionMessage } from '../streamChatCompletion';

/** system · task · ten read rounds (~500 tokens each) · the latest directive. */
export function windowFitTranscript(): ChatCompletionMessage[] {
  const out: ChatCompletionMessage[] = [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'Add the avatar filter.' },
  ];
  for (let i = 0; i < 10; i++) {
    out.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
    out.push({ role: 'tool', tool_call_id: `c${i}`, content: 'X'.repeat(2_000) });
  }
  out.push({ role: 'user', content: 'Now wire the chip row.' });
  return out;
}

/** A seeded Evermind recall carrying one memory. */
export const seededRecall = (text: string): EvermindRecallResult => ({ seeded: true, version: 3, mode: 'connected', items: [{ id: 1, text, score: 0.9 }] });
