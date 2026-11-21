import { describe, expect, it } from 'vitest';
import { BuiltinToolArgError, prepareBuiltinToolArgs } from './builtinToolArgs';
import { ValidationError, statusOf } from '../../domain/shared/errors';

const schema = {
  type: 'object',
  properties: {
    projectId: { type: 'number' },
    count: { type: 'integer' },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    ids: { type: 'array', items: { type: 'number' } },
    createTicket: { type: 'boolean' },
    untyped: {},
  },
  required: ['projectId', 'summary'],
};

const prepare = (args: unknown) => prepareBuiltinToolArgs('tickets.from_delta', schema, args);

describe('prepareBuiltinToolArgs — required arguments', () => {
  it('refuses a missing required argument with a 400-class error naming the tool and the field', () => {
    let caught: unknown;
    try { prepare({ projectId: 3 }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(BuiltinToolArgError);
    expect(caught).toBeInstanceOf(ValidationError);
    expect(statusOf(caught)).toBe(400);
    const err = caught as BuiltinToolArgError;
    expect(err.missing).toEqual(['summary']);
    expect(err.message).toMatch(/^tickets\.from_delta: missing required argument "summary"/);
    expect(err.message).toMatch(/summary is required/);
  });

  it('treats null and a blank string as missing, and lists every missing field', () => {
    expect(() => prepare({ projectId: null, summary: '  ' })).toThrow(/missing required arguments "projectId", "summary"/);
  });

  it('treats absent arguments as an empty object', () => {
    expect(() => prepare(undefined)).toThrow(BuiltinToolArgError);
  });

  it('reads an arguments object sent as JSON text', () => {
    expect(prepare('{"projectId":3,"summary":"x"}')).toEqual({ projectId: 3, summary: 'x' });
  });
});

describe('prepareBuiltinToolArgs — coercion', () => {
  it('parses a JSON-encoded array', () => {
    expect(prepare({ projectId: 3, summary: 's', files: '["a.ts","b.ts"]' }).files).toEqual(['a.ts', 'b.ts']);
  });

  it('wraps a single path string as a one-entry array', () => {
    expect(prepare({ projectId: 3, summary: 's', files: 'src/a.ts' }).files).toEqual(['src/a.ts']);
  });

  it('splits a comma-separated list, and keeps a bracketed non-JSON path whole', () => {
    expect(prepare({ projectId: 3, summary: 's', files: 'a.ts, b.ts' }).files).toEqual(['a.ts', 'b.ts']);
    expect(prepare({ projectId: 3, summary: 's', files: '[id].tsx' }).files).toEqual(['[id].tsx']);
  });

  it('coerces scalar array items to the declared item type', () => {
    expect(prepare({ projectId: 3, summary: 's', ids: '7, 8' }).ids).toEqual([7, 8]);
    expect(prepare({ projectId: 3, summary: 's', ids: ['9'] }).ids).toEqual([9]);
  });

  it('reads a numeric string as a number, and a boolean string as a boolean', () => {
    const out = prepare({ projectId: '42', summary: 's', count: '5', createTicket: 'false' });
    expect(out).toMatchObject({ projectId: 42, count: 5, createTicket: false });
  });

  it('leaves a non-numeric string for a number field to the handler', () => {
    expect(prepare({ projectId: 'abc', summary: 's' }).projectId).toBe('abc');
    expect(prepare({ projectId: 3, summary: 's', count: '4.5' }).count).toBe('4.5');
  });

  it('does not coerce without a declared type, nor a value already of its type', () => {
    const files = ['a.ts'];
    const out = prepare({ projectId: 3, summary: '42', untyped: '["x"]', files, extra: '7' });
    expect(out.summary).toBe('42');
    expect(out.untyped).toBe('["x"]');
    expect(out.extra).toBe('7');
    expect(out.files).toEqual(files);
  });

  it('passes arguments through for a schema with no properties', () => {
    expect(prepareBuiltinToolArgs('x.y', { type: 'object' }, { a: '1' })).toEqual({ a: '1' });
  });

  it('refuses a value that can never be its declared type', () => {
    let caught: unknown;
    try { prepare({ projectId: 3, summary: 's', files: { a: 1 } }); } catch (e) { caught = e; }
    expect((caught as BuiltinToolArgError).invalid).toEqual([{ field: 'files', expected: 'array', received: 'object' }]);
    expect((caught as Error).message).toMatch(/argument "files" must be an array, got object/);
  });
});
