import { describe, expect, it } from 'vitest';
import { isTransactionConflict } from './syncChunking';

const wrapped = (cause: unknown) => Object.assign(new Error('Failed query'), { cause });

describe('isTransactionConflict', () => {
  it('recognises a deadlock or serialization failure at the top level', () => {
    expect(isTransactionConflict({ code: '40P01' })).toBe(true);
    expect(isTransactionConflict({ code: '40001' })).toBe(true);
    expect(isTransactionConflict(new Error('deadlock detected'))).toBe(true);
  });

  it('recognises one wrapped by drizzle (the SQLSTATE is on .cause)', () => {
    expect(isTransactionConflict({ message: 'Failed query', cause: { code: '40P01' } })).toBe(true);
    expect(isTransactionConflict(wrapped({ code: '40001' }))).toBe(true);
    expect(isTransactionConflict(wrapped({ message: 'could not serialize access due to concurrent update' }))).toBe(true);
  });

  it('refuses everything else, wrapped or not', () => {
    expect(isTransactionConflict(wrapped({ code: '23505' }))).toBe(false);
    expect(isTransactionConflict(new Error('importer exploded'))).toBe(false);
    expect(isTransactionConflict(null)).toBe(false);
  });
});
