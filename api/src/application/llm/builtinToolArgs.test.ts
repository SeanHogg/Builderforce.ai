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

  it('never splits a string on commas, and keeps a bracketed non-JSON path whole', () => {
    expect(prepare({ projectId: 3, summary: 's', files: 'a.ts, b.ts' }).files).toEqual(['a.ts, b.ts']);
    expect(prepare({ projectId: 3, summary: 's', files: '[id].tsx' }).files).toEqual(['[id].tsx']);
  });

  it('coerces scalar array items to the declared item type', () => {
    expect(prepare({ projectId: 3, summary: 's', ids: '[7, 8]' }).ids).toEqual([7, 8]);
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

  it('R1: a non-JSON string for an array field is ONE entry — never split on commas or newlines', () => {
    expect(prepare({ projectId: 3, summary: 's', files: 'Paris, France' }).files).toEqual(['Paris, France']);
    expect(prepare({ projectId: 3, summary: 's', files: 'none' }).files).toEqual(['none']);
    expect(prepare({ projectId: 3, summary: 's', files: 'a.ts\nb.ts' }).files).toEqual(['a.ts\nb.ts']);
  });

  it('R2: bracketed text that is not a JSON array is invalid, with a message asking for a JSON array', () => {
    let caught: unknown;
    try { prepare({ projectId: 3, summary: 's', files: "['a.ts','b.ts']" }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(BuiltinToolArgError);
    expect(statusOf(caught)).toBe(400);
    expect((caught as BuiltinToolArgError).invalid).toEqual([{ field: 'files', expected: 'array', received: 'string', hint: expect.stringMatching(/JSON array/) }]);
    expect((caught as Error).message).toMatch(/argument "files" must be an array, got string \(send a JSON array/);
  });

  it('R3: a blank required string is missing unless its schema says minLength: 0', () => {
    const withEmpty = { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', minLength: 0 } }, required: ['path', 'content'] };
    expect(prepareBuiltinToolArgs('project_files.save', withEmpty, { path: 'a.txt', content: '' })).toEqual({ path: 'a.txt', content: '' });
    expect(() => prepareBuiltinToolArgs('project_files.save', withEmpty, { path: 'a.txt' })).toThrow(/missing required argument "content"/);
    expect(() => prepareBuiltinToolArgs('project_files.save', withEmpty, { path: '', content: 'x' })).toThrow(/missing required argument "path"/);
  });

  it('R4: numbers only from plain decimal text (no hex, no exponent)', () => {
    expect(prepare({ projectId: '-3.5', summary: 's' }).projectId).toBe(-3.5);
    expect(prepare({ projectId: '0x1F', summary: 's' }).projectId).toBe('0x1F');
    expect(prepare({ projectId: '1e3', summary: 's' }).projectId).toBe('1e3');
    expect(prepare({ projectId: 'Infinity', summary: 's' }).projectId).toBe('Infinity');
    expect(prepare({ projectId: ' 12 ', summary: 's' }).projectId).toBe(12);
  });

  it('R4: booleans from 1/0 numbers and "1"/"0" text', () => {
    expect(prepare({ projectId: 3, summary: 's', createTicket: 1 }).createTicket).toBe(true);
    expect(prepare({ projectId: 3, summary: 's', createTicket: 0 }).createTicket).toBe(false);
    expect(prepare({ projectId: 3, summary: 's', createTicket: '1' }).createTicket).toBe(true);
    expect(prepare({ projectId: 3, summary: 's', createTicket: '0' }).createTicket).toBe(false);
    expect(() => prepare({ projectId: 3, summary: 's', createTicket: 2 })).toThrow(/argument "createTicket" must be a boolean, got number/);
  });

  it('R4: an object field given JSON object text gets the parsed object; anything else is left as-is', () => {
    const objSchema = { type: 'object', properties: { credentials: { type: 'object' } } };
    const p = (credentials: unknown) => prepareBuiltinToolArgs('integrations.create', objSchema, { credentials }).credentials;
    expect(p('{"token":"t"}')).toEqual({ token: 't' });
    expect(p('{}')).toEqual({});
    expect(p('{not json')).toBe('{not json');
    expect(p('[1,2]')).toBe('[1,2]');
    expect(p('plain')).toBe('plain');
  });

  it('refuses a value that can never be its declared type', () => {
    let caught: unknown;
    try { prepare({ projectId: 3, summary: 's', files: { a: 1 } }); } catch (e) { caught = e; }
    expect((caught as BuiltinToolArgError).invalid).toEqual([{ field: 'files', expected: 'array', received: 'object' }]);
    expect((caught as Error).message).toMatch(/argument "files" must be an array, got object/);
  });
});
