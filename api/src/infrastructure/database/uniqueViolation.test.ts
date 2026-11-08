import { describe, expect, it } from 'vitest';
import { isUniqueViolation, pgErrorOf } from './uniqueViolation';

/** What drizzle-orm 0.45 throws: a "Failed query" wrapper with the driver error on `.cause`. */
const wrapped = (cause: unknown) => Object.assign(new Error('Failed query: insert into "sync_events" …'), { cause });

describe('pgErrorOf', () => {
  it('finds the SQLSTATE on the error itself, or up to five causes down', () => {
    expect(pgErrorOf({ code: '40P01' })?.code).toBe('40P01');
    expect(pgErrorOf(wrapped({ code: '23505', constraint: 'uq_x' }))).toMatchObject({ code: '23505', constraint: 'uq_x' });
    const deep = { cause: { cause: { cause: { cause: { cause: { code: '40001' } } } } } };
    expect(pgErrorOf(deep)?.code).toBe('40001');
  });

  it('gives up past five levels and for anything without a code', () => {
    const tooDeep = { cause: { cause: { cause: { cause: { cause: { cause: { code: '40001' } } } } } } };
    expect(pgErrorOf(tooDeep)).toBeUndefined();
    expect(pgErrorOf(new Error('boom'))).toBeUndefined();
    expect(pgErrorOf(null)).toBeUndefined();
    expect(pgErrorOf('text')).toBeUndefined();
  });

  it('terminates on a cyclic cause chain', () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(pgErrorOf(a)).toBeUndefined();
  });
});

describe('isUniqueViolation through a wrapped driver error', () => {
  it('recognises a 23505 on .cause, and narrows by the constraint named there', () => {
    const error = wrapped({ code: '23505', message: 'duplicate key value violates unique constraint "uq_sync_events_event"', constraint: 'uq_sync_events_event' });
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'uq_sync_events_event')).toBe(true);
    expect(isUniqueViolation(error, 'some_other_index')).toBe(false);
  });

  it('is false for a wrapped error that is not a unique violation', () => {
    expect(isUniqueViolation(wrapped({ code: '40P01', message: 'deadlock detected' }))).toBe(false);
  });
});
