import { describe, it, expect } from 'vitest';
import { XmlToolCallFilter, extractXmlToolCalls } from './xmlToolCalls';

/** Feed a string in fixed-size chunks to exercise the split-across-deltas paths. */
function streamInChunks(raw: string, size: number): { text: string; calls: ReturnType<XmlToolCallFilter['toolCalls']> } {
  const f = new XmlToolCallFilter();
  let emitted = '';
  for (let i = 0; i < raw.length; i += size) emitted += f.push(raw.slice(i, i + size));
  emitted += f.flush();
  // The incrementally-emitted text must match the accumulated clean text.
  expect(emitted).toBe(f.cleanText());
  return { text: f.cleanText(), calls: f.toolCalls() };
}

describe('XmlToolCallFilter', () => {
  it('passes plain text through untouched', () => {
    const { text, toolCalls } = extractXmlToolCalls('Just a normal answer with no calls.');
    expect(text).toBe('Just a normal answer with no calls.');
    expect(toolCalls).toEqual([]);
  });

  it('lifts an inline arg_key/arg_value tool call and strips the markup', () => {
    const raw = 'Let me clean up the duplicate.<tool_call>delete_task<arg_key>id</arg_key><arg_value>75</arg_value></tool_call>';
    const { text, toolCalls } = extractXmlToolCalls(raw);
    expect(text).toBe('Let me clean up the duplicate.');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('delete_task');
    // Numeric arg is coerced (so the tool receives 75, not "75").
    expect(JSON.parse(toolCalls[0].args)).toEqual({ id: 75 });
  });

  it('handles multiple args and multiple calls in one stream', () => {
    const raw =
      '<tool_call>update_task<arg_key>id</arg_key><arg_value>12</arg_value><arg_key>title</arg_key><arg_value>Hi</arg_value></tool_call>' +
      ' and then ' +
      '<tool_call>assign<arg_key>user</arg_key><arg_value>bob</arg_value></tool_call>';
    const { text, toolCalls } = extractXmlToolCalls(raw);
    expect(text).toBe(' and then ');
    expect(toolCalls.map((c) => c.name)).toEqual(['update_task', 'assign']);
    expect(JSON.parse(toolCalls[0].args)).toEqual({ id: 12, title: 'Hi' });
    expect(JSON.parse(toolCalls[1].args)).toEqual({ user: 'bob' });
    // Synthesized ids are unique.
    expect(new Set(toolCalls.map((c) => c.id)).size).toBe(2);
  });

  it('is robust to the tag being split across stream chunks', () => {
    const raw = 'Working…<tool_call>delete_task<arg_key>id</arg_key><arg_value>75</arg_value></tool_call>done';
    // Tiny chunks guarantee `<tool_call>` / `</tool_call>` straddle boundaries.
    for (const size of [1, 2, 3, 5, 7]) {
      const { text, calls } = streamInChunks(raw, size);
      expect(text).toBe('Working…done');
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('delete_task');
      expect(JSON.parse(calls[0].args)).toEqual({ id: 75 });
    }
  });

  it('does not hold back text that merely resembles a tag prefix', () => {
    const { text, toolCalls } = extractXmlToolCalls('compare a < b and c > d');
    expect(text).toBe('compare a < b and c > d');
    expect(toolCalls).toEqual([]);
  });

  it('parses the {"name","arguments"} JSON variant', () => {
    const raw = '<tool_call>{"name":"create_file","arguments":{"path":"a.ts"}}</tool_call>';
    const { toolCalls } = extractXmlToolCalls(raw);
    expect(toolCalls[0].name).toBe('create_file');
    expect(JSON.parse(toolCalls[0].args)).toEqual({ path: 'a.ts' });
  });

  it('recovers a best-effort call from an unterminated tag at end of stream', () => {
    const raw = 'oops<tool_call>delete_task<arg_key>id</arg_key><arg_value>9</arg_value>';
    const { text, toolCalls } = extractXmlToolCalls(raw);
    expect(text).toBe('oops');
    expect(toolCalls[0].name).toBe('delete_task');
    expect(JSON.parse(toolCalls[0].args)).toEqual({ id: 9 });
  });
});
