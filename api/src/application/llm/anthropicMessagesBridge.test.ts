import { describe, expect, it } from 'vitest';
import {
  anthropicToOpenAiRequest,
  openAiToAnthropicMessage,
  createAnthropicStreamEncoder,
  mapStopReason,
} from './anthropicMessagesBridge';

describe('anthropicToOpenAiRequest', () => {
  it('hoists system, maps messages, max_tokens, stream + usage opt-in', () => {
    const out = anthropicToOpenAiRequest({
      model: 'claude-x', max_tokens: 100, stream: true, system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.model).toBe('claude-x');
    expect(out.max_tokens).toBe(100);
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
    expect(out.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('flattens system blocks to text', () => {
    const out = anthropicToOpenAiRequest({ system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], messages: [] });
    expect((out.messages as Array<{ content: string }>)[0]!.content).toBe('a\n\nb');
  });

  it('maps assistant tool_use → openai tool_calls', () => {
    const out = anthropicToOpenAiRequest({
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'x' } }] }],
    });
    const msg = (out.messages as Array<Record<string, unknown>>)[0]!;
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('calling');
    expect(msg.tool_calls).toEqual([{ id: 'tu_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }]);
  });

  it('maps user tool_result → openai role:tool message', () => {
    const out = anthropicToOpenAiRequest({
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result text' }] }],
    });
    expect((out.messages as Array<Record<string, unknown>>)[0]).toEqual({ role: 'tool', tool_call_id: 'tu_1', content: 'result text' });
  });

  it('maps tools + tool_choice', () => {
    const out = anthropicToOpenAiRequest({
      messages: [], tools: [{ name: 'foo', description: 'd', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'foo' },
    });
    expect(out.tools).toEqual([{ type: 'function', function: { name: 'foo', description: 'd', parameters: { type: 'object' } } }]);
    expect(out.tool_choice).toEqual({ type: 'function', function: { name: 'foo' } });
  });
});

describe('openAiToAnthropicMessage', () => {
  it('maps text + usage + stop_reason', () => {
    const out = openAiToAnthropicMessage(
      { choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 } },
      'm', 'msg_1',
    );
    expect(out).toMatchObject({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'm',
      content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 4 },
    });
  });

  it('maps tool_calls → tool_use blocks with parsed input', () => {
    const out = openAiToAnthropicMessage(
      { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'foo', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }] },
      'm', 'msg_1',
    );
    expect(out.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'foo', input: { a: 1 } }]);
    expect(out.stop_reason).toBe('tool_use');
  });

  it('always emits at least one content block', () => {
    const out = openAiToAnthropicMessage({ choices: [{ message: {}, finish_reason: 'stop' }] }, 'm', 'msg_1');
    expect(out.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('mapStopReason', () => {
  it('maps finish reasons', () => {
    expect(mapStopReason('length')).toBe('max_tokens');
    expect(mapStopReason('tool_calls')).toBe('tool_use');
    expect(mapStopReason('stop')).toBe('end_turn');
    expect(mapStopReason(null)).toBe('end_turn');
  });
});

describe('createAnthropicStreamEncoder', () => {
  const events = (s: string) => s.split('\n').filter((l) => l.startsWith('event: ')).map((l) => l.slice(7));

  it('emits a well-formed text stream', () => {
    const enc = createAnthropicStreamEncoder({ messageId: 'msg_1', model: 'm' });
    let out = '';
    out += enc.feed({ choices: [{ delta: { content: 'Hel' } }] });
    out += enc.feed({ choices: [{ delta: { content: 'lo' } }] });
    out += enc.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    out += enc.feed({ usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [] });
    out += enc.finish();
    expect(events(out)).toEqual([
      'message_start', 'content_block_start', 'content_block_delta', 'content_block_delta',
      'content_block_stop', 'message_delta', 'message_stop',
    ]);
    expect(out).toContain('"text":"Hel"');
    expect(out).toContain('"stop_reason":"end_turn"');
    expect(out).toContain('"output_tokens":2');
  });

  it('emits tool_use blocks (start + input_json_delta + stop)', () => {
    const enc = createAnthropicStreamEncoder({ messageId: 'msg_1', model: 'm' });
    let out = '';
    out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'foo', arguments: '' } }] } }] });
    out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] } }] });
    out += enc.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    out += enc.finish();
    expect(events(out)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(out).toContain('"type":"tool_use"');
    expect(out).toContain('"name":"foo"');
    expect(out).toContain('"partial_json":"{\\"x\\":1}"');
    expect(out).toContain('"stop_reason":"tool_use"');
  });

  it('handles text followed by a tool call (closes text block first)', () => {
    const enc = createAnthropicStreamEncoder({ messageId: 'msg_1', model: 'm' });
    let out = '';
    out += enc.feed({ choices: [{ delta: { content: 'thinking' } }] });
    out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'foo', arguments: '{}' } }] } }] });
    out += enc.finish();
    // text block 0 opened+stopped, then tool block 1 opened+stopped
    expect(events(out)).toEqual([
      'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop',
      'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
    ]);
    expect(out).toContain('"index":0');
    expect(out).toContain('"index":1');
  });

  it('finish() alone still emits a valid empty message', () => {
    const enc = createAnthropicStreamEncoder({ messageId: 'msg_1', model: 'm' });
    expect(events(enc.finish())).toEqual(['message_start', 'message_delta', 'message_stop']);
  });
});
