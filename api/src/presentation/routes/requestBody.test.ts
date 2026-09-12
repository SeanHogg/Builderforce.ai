import { describe, expect, it } from 'vitest';
import { RequestValidationError } from '../../domain/shared/errors';
import { errorResponseBody as errorResponseFor } from '../middleware/errorResponse';
import {
  parseBody, parseOptionalBody, parseQuery, z,
  zBoundedInt, zLimit, zNonEmptyString, zOffset, zOptionalString, zPositiveInt, zQueryInt,
} from './requestBody';

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

describe('bounded integer schemas (boundedInt semantics, never refuse)', () => {
  it('zLimit clamps into [1, max] and defaults absent/junk', () => {
    const schema = z.object({ limit: zLimit(50, 200) });
    expect(schema.parse({})).toEqual({ limit: 50 });
    expect(schema.parse({ limit: 'abc' })).toEqual({ limit: 50 });
    expect(schema.parse({ limit: '' })).toEqual({ limit: 50 });
    expect(schema.parse({ limit: 10_000 })).toEqual({ limit: 200 });
    expect(schema.parse({ limit: 0 })).toEqual({ limit: 1 });
    expect(schema.parse({ limit: '7.9' })).toEqual({ limit: 7 });
  });

  it('zOffset is never negative and defaults to 0', () => {
    const schema = z.object({ offset: zOffset });
    expect(schema.parse({})).toEqual({ offset: 0 });
    expect(schema.parse({ offset: -5 })).toEqual({ offset: 0 });
    expect(schema.parse({ offset: '40' })).toEqual({ offset: 40 });
  });

  it('zBoundedInt honours an arbitrary band', () => {
    const days = zBoundedInt({ def: 30, min: 1, max: 365 });
    expect(days.parse(undefined)).toBe(30);
    expect(days.parse(9999)).toBe(365);
    expect(days.parse(NaN)).toBe(30);
  });

  it('works through parseQuery exactly as through a body', () => {
    const schema = z.object({ limit: zLimit(25, 100), offset: zOffset });
    expect(parseQuery(queryCtx({ limit: '500', offset: '-1' }), schema)).toEqual({ limit: 100, offset: 0 });
  });
});

describe('RequestValidationError on the wire', () => {
  it('answers 400 { error, code: "invalid_request", issues } through errorResponse', async () => {
    const error = await parseBody(bodyCtx({ id: 'x' }), z.object({ id: zPositiveInt })).catch((e: unknown) => e);
    const { status, body } = errorResponseFor(error);
    expect(status).toBe(400);
    expect(body.code).toBe('invalid_request');
    expect(body.issues).toEqual([{ path: 'id', message: expect.any(String) }]);
    expect(body.error).toMatch(/^Invalid request body — id: /);
  });
});

describe('parseOptionalBody', () => {
  const schema = z.object({ label: zOptionalString });

  it('reads an absent / unparseable body as {}', async () => {
    await expect(parseOptionalBody(badJsonCtx, schema)).resolves.toEqual({ label: undefined });
    await expect(parseOptionalBody(bodyCtx(null), schema)).resolves.toEqual({ label: undefined });
  });

  it('still validates a body that IS present', async () => {
    await expect(parseOptionalBody(bodyCtx({ label: 5 }), schema)).rejects.toBeInstanceOf(RequestValidationError);
  });
});
