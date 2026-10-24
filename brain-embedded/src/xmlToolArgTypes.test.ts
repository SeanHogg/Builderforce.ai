import { describe, expect, it } from 'vitest';
import type { BrainToolSpec } from './streamChatCompletion';
import { typeXmlToolArgs } from './xmlToolArgTypes';
import { extractXmlToolCalls } from './xmlToolCalls';

/**
 * An inline call's arguments are text until the advertised schema says otherwise — the
 * rule Qwen3-Coder's own parser applies, so a JSON file's content stays a string while a
 * declared array arrives as one.
 */

const tool = (name: string, properties: Record<string, unknown>): BrainToolSpec => ({
  type: 'function',
  function: { name, description: '', parameters: { type: 'object', properties } },
});
const TOOLS = [
  tool('write_file', { path: { type: 'string' }, content: { type: 'string' } }),
  tool('edit', { edits: { type: 'array' }, options: { type: 'object' }, line: { type: 'integer' }, dry: { type: 'boolean' }, id: { type: 'string' } }),
];
const args = (raw: string) => JSON.parse(typeXmlToolArgs(extractXmlToolCalls(raw).toolCalls, TOOLS)[0]!.args) as Record<string, unknown>;

describe('typeXmlToolArgs', () => {
  it('hands a string property the text exactly as written — never a number or object the parser read it as', () => {
    const raw =
      '<tool_call>\n<function=edit>\n<parameter=id>\n1.10\n</parameter>\n</function>\n</tool_call>' +
      '<invoke name="write_file"><parameter name="path">a.json</parameter><parameter name="content">{"a": 1}</parameter></invoke>';
    const [edit, write] = typeXmlToolArgs(extractXmlToolCalls(raw).toolCalls, TOOLS);
    expect(JSON.parse(edit!.args)).toEqual({ id: '1.10' });
    expect(JSON.parse(write!.args)).toEqual({ path: 'a.json', content: '{"a": 1}' });
    expect(edit).not.toHaveProperty('rawArgs');
  });

  it("keeps a string property's JSON text as text", () => {
    const raw = '<tool_call>\n<function=write_file>\n<parameter=path>\npackage.json\n</parameter>\n<parameter=content>\n{"name": "x"}\n</parameter>\n</function>\n</tool_call>';
    expect(args(raw)).toEqual({ path: 'package.json', content: '{"name": "x"}' });
  });

  it('parses what the schema declares structured, and turns a bare scalar back to text for a string property', () => {
    const raw =
      '<tool_call>\n<function=edit>\n<parameter=edits>\n[{"a": 1}]\n</parameter>\n<parameter=options>\n{"x": true}\n</parameter>\n' +
      '<parameter=line>\n12\n</parameter>\n<parameter=dry>\nfalse\n</parameter>\n<parameter=id>\n42\n</parameter>\n</function>\n</tool_call>';
    expect(args(raw)).toEqual({ edits: [{ a: 1 }], options: { x: true }, line: 12, dry: false, id: '42' });
  });

  it('leaves a call alone when no schema describes it, or it does not read as the declared type', () => {
    const calls = extractXmlToolCalls('<function=other>\n<parameter=edits>\n[1]\n</parameter>\n</function>').toolCalls;
    const plain = calls.map(({ id, name, args }) => ({ id, name, args }));
    expect(typeXmlToolArgs(calls, TOOLS)).toEqual(plain);
    expect(typeXmlToolArgs(calls, undefined)).toEqual(plain);
    const bad = '<tool_call>\n<function=edit>\n<parameter=edits>\nnot json\n</parameter>\n</function>\n</tool_call>';
    expect(args(bad)).toEqual({ edits: 'not json' });
  });
});
