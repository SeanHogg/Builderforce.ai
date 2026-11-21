import { describe, expect, it } from 'vitest';
import { listBuiltinTools } from './builtinMcpService';
import { prepareBuiltinToolArgs } from './builtinToolArgs';

/** The catalog's declared schema for one built-in tool. */
const schemaOf = (tool: string): Record<string, unknown> => {
  const entry = listBuiltinTools().find((t) => t.tool === tool);
  if (!entry) throw new Error(`no built-in tool ${tool}`);
  return entry.parameters;
};

describe('built-in catalog schemas through the argument step', () => {
  it('project_files.save accepts empty content (an empty file), but still requires the field', () => {
    const schema = schemaOf('project_files.save');
    expect(prepareBuiltinToolArgs('project_files.save', schema, { projectId: 3, path: 'a.txt', content: '' })).toEqual({ projectId: 3, path: 'a.txt', content: '' });
    expect(() => prepareBuiltinToolArgs('project_files.save', schema, { projectId: 3, path: 'a.txt' })).toThrow(/missing required argument "content"/);
    expect(() => prepareBuiltinToolArgs('project_files.save', schema, { projectId: 3, path: ' ', content: 'x' })).toThrow(/missing required argument "path"/);
  });
});
