import { describe, expect, it } from 'vitest';
import { RequestValidationError } from '../../domain/shared/errors';
import { parseBody, parseQuery, z, zNonEmptyString, zOptionalString, zPositiveInt, zQueryInt } from './requestBody';

const bodyCtx = (value: unknown) => ({ req: { json: async () => value } });
const badJsonCtx = { req: { json: async () => { throw new SyntaxError('Unexpected token'); } } };
const queryCtx = (query: Record<string, string>) => ({ req: { query: () => query } });

describe('parseBody', () => {
  const schema = z.object({ name: zNonEmptyString, id: zPositiveInt, tags: z.array(z.string()).optional() });

  it('returns exactly what the schema admits', async () => {
    await expect(parseBody(bodyCtx({ name: '  Ada ', id: 3, extra: 'dropped' }), schema))
      .resolves.toEqual({ name: 'Ada', id: 3 });
  });

  it('throws a RequestValidationError with per-field issues on a miss', async () => {
    const error = await parseBody(bodyCtx({ name: '', id: '3' }), schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestValidationError);
    const issues = (error as RequestValidationError).issues;
    expect(issues.map((i) => i.path).sort()).toEqual(['id', 'name']);
    expect((error as Error).message).toMatch(/^Invalid request body — /);
  });

  it('answers malformed JSON as a validation error, not a thrown SyntaxError', async () => {
    const error = await parseBody(badJsonCtx, schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).issues).toEqual([{ path: '', message: 'Request body must be valid JSON' }]);
  });

  it('dots nested paths', async () => {
    const nested = z.object({ items: z.array(z.object({ id: zPositiveInt })) });
    const error = await parseBody(bodyCtx({ items: [{ id: 1 }, { id: 0 }] }), nested).catch((e: unknown) => e);
    expect((error as RequestValidationError).issues[0]?.path).toBe('items.1.id');
  });
});

describe('parseQuery', () => {
  it('coerces numerics from strings and rejects junk', () => {
    const schema = z.object({ limit: zQueryInt.optional(), kind: z.enum(['a', 'b']).optional() });
    expect(parseQuery(queryCtx({ limit: '5', kind: 'a' }), schema)).toEqual({ limit: 5, kind: 'a' });
    expect(() => parseQuery(queryCtx({ limit: '0' }), schema)).toThrow(RequestValidationError);
    expect(() => parseQuery(queryCtx({ kind: 'c' }), schema)).toThrow(/Invalid request query/);
  });
});

describe('shared field schemas', () => {
  it('zPositiveInt matches positiveIntParam: 0, floats, numeric strings refused', () => {
    expect(zPositiveInt.safeParse(1).success).toBe(true);
    for (const bad of [0, -1, 1.5, '1', NaN, null]) expect(zPositiveInt.safeParse(bad).success).toBe(false);
  });

  it('zOptionalString reads "", whitespace, null and absent as undefined', () => {
    for (const absent of ['', '   ', null, undefined]) expect(zOptionalString.parse(absent)).toBeUndefined();
    expect(zOptionalString.parse('  x ')).toBe('x');
    expect(zOptionalString.safeParse(4).success).toBe(false);
  });
});
