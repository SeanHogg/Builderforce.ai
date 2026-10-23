import { afterEach, describe, expect, it, vi } from 'vitest';
import { MALFORMED_CALL_RESULT } from '@builderforce/agent-loop';
import type { LocalSuccessOutcome } from '@seanhogg/builderforce-memory-engine';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { createDeferredLocalRecords, inferVerdict, labelWithVerdict, type RecordLocalOutcome } from './verifiedLocalLabel';

/**
 * E5's load-bearing rules:
 *  - lever on + a failed verdict turns a served local `succeeded` into `failed`;
 *    lever off, or no verdict, keeps the transport label (today's behaviour);
 *  - the chat's NEXT call is the verdict: a resend of the same message fails it, a tool
 *    refusal for its calls fails it, moving on / clean tool results pass it;
 *  - a turn nobody judges is recorded with the transport label at the timeout.
 */

const turn = { promptTokens: 10, contextTokens: 0, servedContextTokens: 4096, tools: 0, turnIndex: 0 };
const served: LocalSuccessOutcome = { turn, local: 'succeeded' };

const user = (content: string): ChatCompletionMessage => ({ role: 'user', content });
const assistantCall = (id: string): ChatCompletionMessage => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{' } }],
});
const toolResult = (id: string, content: string): ChatCompletionMessage => ({ role: 'tool', tool_call_id: id, content });

afterEach(() => {
  vi.useRealTimers();
});

describe('labelWithVerdict', () => {
  it('fails a served turn whose verdict failed — only with the lever on', () => {
    const judged = { ...served, verifier: { passed: false, source: 'retry' as const } };
    expect(labelWithVerdict(judged, true)).toEqual({ turn, local: 'failed' });
    expect(labelWithVerdict(judged, false)).toEqual(served);
    expect(labelWithVerdict(served, true)).toEqual(served);
    expect(labelWithVerdict({ ...served, verifier: { passed: true, source: 'continued' } }, true)).toEqual(served);
  });
});

describe('inferVerdict', () => {
  it('reads a resend of the same message as a retry (failed)', () => {
    expect(inferVerdict('fix it', { messages: [user('fix it'), { role: 'assistant', content: 'done' }, user('fix it')] }))
      .toEqual({ passed: false, source: 'retry' });
  });

  it('reads a different next message as the person moving on (passed)', () => {
    expect(inferVerdict('fix it', { messages: [user('fix it'), { role: 'assistant', content: 'done' }, user('thanks, now docs')] }))
      .toEqual({ passed: true, source: 'continued' });
  });

  it("reads the agent loop's malformed-arguments refusal of this turn's call as a schema failure", () => {
    const next = { messages: [user('fix it'), assistantCall('c1'), toolResult('c1', JSON.stringify({ error: MALFORMED_CALL_RESULT }))] };
    expect(inferVerdict('fix it', next)).toEqual({ passed: false, source: 'tool_schema' });
  });

  it("reads clean results for this turn's calls as passed", () => {
    const next = { messages: [user('fix it'), assistantCall('c1'), toolResult('c1', '{"ok":true}')] };
    expect(inferVerdict('fix it', next)).toEqual({ passed: true, source: 'tool_ok' });
  });
});

describe('createDeferredLocalRecords', () => {
  function recorder(): { record: RecordLocalOutcome; seen: LocalSuccessOutcome[] } {
    const seen: LocalSuccessOutcome[] = [];
    return { seen, record: async (_ref, o) => { seen.push(o); } };
  }

  it("records the verdict the chat's next call gives", async () => {
    const r = recorder();
    const deferred = createDeferredLocalRecords({ leverOn: () => true });
    deferred.defer({ conversation: 'chat:1', prompt: 'fix it', ref: 'local/x', outcome: served, record: r.record });
    expect(r.seen).toEqual([]);
    deferred.observe('chat:1', { messages: [user('fix it')] });
    await Promise.resolve();
    expect(r.seen).toEqual([{ turn, local: 'failed' }]);
    expect(deferred.pending()).toBe(0);
  });

  it('takes an explicit rating for the chat’s latest turn', async () => {
    const r = recorder();
    const deferred = createDeferredLocalRecords({ leverOn: () => true });
    deferred.defer({ conversation: 'chat:2', prompt: 'p', ref: 'local/x', outcome: served, record: r.record });
    expect(deferred.verdictForConversation('chat:2', { passed: false, source: 'rating' })).toBe(true);
    expect(deferred.verdictForConversation('chat:2', { passed: false, source: 'rating' })).toBe(false);
    await Promise.resolve();
    expect(r.seen).toEqual([{ turn, local: 'failed' }]);
  });

  it('falls back to the transport label at the timeout', async () => {
    vi.useFakeTimers();
    const r = recorder();
    const deferred = createDeferredLocalRecords({ leverOn: () => true, timeoutMs: 1_000 });
    deferred.defer({ conversation: 'chat:3', prompt: 'p', ref: 'local/x', outcome: served, record: r.record });
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(r.seen).toEqual([served]);
  });

  it('records an older pending turn of the same chat with its transport label when a new one is deferred', async () => {
    const r = recorder();
    const deferred = createDeferredLocalRecords({ leverOn: () => true });
    deferred.defer({ conversation: 'chat:4', prompt: 'a', ref: 'local/x', outcome: served, record: r.record });
    deferred.defer({ conversation: 'chat:4', prompt: 'b', ref: 'local/x', outcome: served, record: r.record });
    await Promise.resolve();
    expect(r.seen).toEqual([served]);
    expect(deferred.pending()).toBe(1);
  });
});
