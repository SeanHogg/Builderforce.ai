import { describe, expect, it } from 'vitest';
import { deterministicQuestion, isUndispatchedOutcome, tryDeterministicCompletion } from './deterministicCompletion';
import { answerDeterministically } from './registry';
import type { ChatCompletionRequest } from '../proxyTypes';

const now = new Date('2026-10-22T12:00:00Z');
const ask = (content: string, over: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  messages: [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content }],
  ...over,
});

describe('deterministicQuestion', () => {
  it('reads the last user message of a tool-free request', () => {
    expect(deterministicQuestion(ask('2 + 2'))).toBe('2 + 2');
    expect(deterministicQuestion(ask('2 + 2', { tools: [] }))).toBe('2 + 2');
  });

  it('declines tool, JSON, multi-choice and non-user-last requests', () => {
    expect(deterministicQuestion(ask('2 + 2', { tools: [{ type: 'function', function: { name: 'x' } }] }))).toBeNull();
    expect(deterministicQuestion(ask('2 + 2', { tool_choice: 'auto' }))).toBeNull();
    expect(deterministicQuestion(ask('2 + 2', { response_format: { type: 'json_object' } }))).toBeNull();
    expect(deterministicQuestion(ask('2 + 2', { n: 2 }))).toBeNull();
    expect(deterministicQuestion({ messages: [{ role: 'user', content: '2 + 2' }, { role: 'assistant', content: '4' }] })).toBeNull();
    expect(deterministicQuestion({ messages: [{ role: 'user', content: [{ type: 'text', text: '2 + 2' }] as unknown as string }] })).toBeNull();
    expect(deterministicQuestion({ messages: [{ role: 'tool', content: '{}' }, { role: 'user', content: '2 + 2' }] })).toBeNull();
  });
});

describe('answerDeterministically', () => {
  it('declines an over-long message outright', () => {
    expect(answerDeterministically(`${'1 + '.repeat(80)}1`, now)).toBeNull();
  });
});

describe('tryDeterministicCompletion', () => {
  it('answers with an OpenAI-shaped completion, outcome deterministic and no usage', async () => {
    const result = tryDeterministicCompletion(ask('what is 6 * 7?'), now)!;
    expect(result.outcome).toBe('deterministic');
    expect(result.usage).toBeUndefined();
    expect(result.resolvedModel).toBe('deterministic/arithmetic');
    expect(result.response.headers.get('x-builderforce-outcome')).toBe('deterministic');
    const body = await result.response.json() as { choices: Array<{ message: { content: string } }>; usage?: unknown; object: string };
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0]!.message.content).toBe('6 * 7 = 42');
    expect(body.usage).toBeUndefined();
  });

  it('streams a one-chunk SSE answer when the caller streamed', async () => {
    const result = tryDeterministicCompletion(ask('convert 1 mile to km', { stream: true }), now)!;
    expect(result.response.headers.get('content-type')).toContain('text/event-stream');
    const text = await result.response.text();
    expect(text).toContain('1 mile = 1.60934 kilometers');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('leaves everything else to a model', () => {
    expect(tryDeterministicCompletion(ask('write a haiku about 2 + 2'), now)).toBeNull();
    expect(tryDeterministicCompletion(ask('2 + 2', { tools: [{ type: 'function' }] }), now)).toBeNull();
  });
});

describe('isUndispatchedOutcome', () => {
  it('covers both outcomes that dispatched nothing', () => {
    expect(isUndispatchedOutcome('deterministic')).toBe(true);
    expect(isUndispatchedOutcome('response_cache_hit')).toBe(true);
    expect(isUndispatchedOutcome('success')).toBe(false);
    expect(isUndispatchedOutcome(undefined)).toBe(false);
  });
});
