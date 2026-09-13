import { describe, expect, it } from 'vitest';
import {
  MAX_REASONING_CALLS, nextReasoningChain, reasoningByCall, toolTurnCallIds,
  reasoningReplayKey, withReplayedReasoning,
} from './reasoningReplay';

const reasoning = (id: string) => ({ type: 'reasoning', id, summary: [], encrypted_content: `enc-${id}` });
const call = (callId: string, name = 'read_file') => ({ type: 'function_call', call_id: callId, name, arguments: '{}' });

describe('reasoningByCall', () => {
  it('attaches each reasoning group to the call that follows it, in order', () => {
    const chain = reasoningByCall([reasoning('r1'), call('c1'), call('c2'), reasoning('r2'), reasoning('r3'), call('c3')]);
    expect(chain).toEqual({ c1: [reasoning('r1')], c3: [reasoning('r2'), reasoning('r3')] });
  });

  it('drops reasoning with no call after it — it preceded a reply, not a call', () => {
    expect(reasoningByCall([call('c1'), reasoning('r1'), { type: 'message' }])).toEqual({});
  });
});

describe('nextReasoningChain', () => {
  it('saves the prior chain plus this turn under the turn\'s first call id', () => {
    const next = nextReasoningChain({ c0: [reasoning('r0')] }, [reasoning('r1'), call('c1'), call('c2')]);
    expect(next).toEqual({ firstCallId: 'c1', chain: { c0: [reasoning('r0')], c1: [reasoning('r1')] } });
  });

  it('carries the prior chain forward even when this turn reasoned nothing', () => {
    expect(nextReasoningChain({ c0: [reasoning('r0')] }, [call('c1')])?.chain).toEqual({ c0: [reasoning('r0')] });
  });

  it('saves nothing for a turn that called no tool, or with nothing to remember', () => {
    expect(nextReasoningChain({ c0: [reasoning('r0')] }, [reasoning('r1'), { type: 'message' }])).toBeNull();
    expect(nextReasoningChain({}, [call('c1')])).toBeNull();
  });

  it('keeps only the most recent calls', () => {
    const prior = Object.fromEntries(Array.from({ length: MAX_REASONING_CALLS }, (_, i) => [`old${i}`, [reasoning(`o${i}`)]]));
    const chain = nextReasoningChain(prior, [reasoning('new'), call('newest')])!.chain;
    expect(Object.keys(chain)).toHaveLength(MAX_REASONING_CALLS);
    expect(chain['old0']).toBeUndefined();
    expect(chain['newest']).toEqual([reasoning('new')]);
  });
});

describe('withReplayedReasoning', () => {
  it('puts each remembered group back immediately before its call and nowhere else', () => {
    const input = [
      { role: 'user', content: [] },
      call('c1'), call('c2'),
      { type: 'function_call_output', call_id: 'c1', output: 'a' },
      call('c3'),
    ];
    const replayed = withReplayedReasoning(input, { c1: [reasoning('r1')], c3: [reasoning('r3')], gone: [reasoning('x')] });
    expect(replayed.map((item) => (item as { id?: string; call_id?: string; role?: string }).id ?? (item as { call_id?: string }).call_id ?? 'user'))
      .toEqual(['user', 'r1', 'c1', 'c2', 'c1', 'r3', 'c3']);
  });
});

describe('toolTurnCallIds', () => {
  it('reads the first call id of every tool turn, newest first', () => {
    expect(toolTurnCallIds([
      { role: 'assistant', tool_calls: [{ id: 'a1' }] },
      { role: 'tool', tool_call_id: 'a1' },
      { role: 'assistant', tool_calls: [{ id: 'b1' }, { id: 'b2' }] },
      { role: 'tool', tool_call_id: 'b1' },
      { role: 'assistant', content: 'done' },
    ])).toEqual(['b1', 'a1']);
    expect(toolTurnCallIds([{ role: 'user', content: 'hi' }])).toEqual([]);
  });
});

describe('reasoningReplayKey', () => {
  it('scopes the same call id to each credential', async () => {
    const a = await reasoningReplayKey('key-a', 'call_1');
    expect(a).toMatch(/^xai-reasoning:v1:[0-9a-f]{16}:call_1$/);
    expect(await reasoningReplayKey('key-b', 'call_1')).not.toBe(a);
    expect(await reasoningReplayKey('key-a', 'call_1')).toBe(a);
  });
});
