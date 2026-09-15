import { describe, expect, it } from 'vitest';
import { ServiceUnavailableError, statusOf } from '../../domain/shared/errors';
import { DATABASE_UNAVAILABLE_CODE, asDatabaseUnavailable, withDatabaseAvailability } from './neonAvailability';

/** The exact text the Neon HTTP driver throws for a 402 (captured from production, 2026-09-14). */
const quotaError = () => new Error(
  'Server error (HTTP status 402): {"message":"Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits."}',
);

/** A stand-in for `neon(url)`: callable, returning a lazy thenable that `transaction()` reads back. */
function fakeClient(outcome: () => Promise<unknown>) {
  const client = (text: string) => ({
    parameterizedQuery: { query: text },
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => outcome().then(onFulfilled, onRejected),
    catch: (onRejected: (e: unknown) => unknown) => outcome().catch(onRejected),
    finally: (onFinally?: () => void) => outcome().finally(onFinally),
  });
  return Object.assign(client, {
    transaction: async (queries: Array<{ parameterizedQuery: unknown }>) => {
      await outcome();
      return queries.map((q) => q.parameterizedQuery);
    },
  });
}

describe('asDatabaseUnavailable', () => {
  it('turns a Neon quota refusal into a 503 outage carrying the code and the original', () => {
    const original = quotaError();
    const mapped = asDatabaseUnavailable(original);
    expect(mapped).toBeInstanceOf(ServiceUnavailableError);
    expect(statusOf(mapped)).toBe(503);
    expect((mapped as ServiceUnavailableError).code).toBe(DATABASE_UNAVAILABLE_CODE);
    expect((mapped as ServiceUnavailableError).cause).toBe(original);
  });

  it('leaves every other error exactly as it was', () => {
    const sqlError = new Error('relation "x" does not exist');
    expect(asDatabaseUnavailable(sqlError)).toBe(sqlError);
    const other = new Error('Server error (HTTP status 500): boom');
    expect(asDatabaseUnavailable(other)).toBe(other);
    expect(asDatabaseUnavailable('string')).toBe('string');
  });
});

describe('withDatabaseAvailability', () => {
  it('translates a quota refusal on an awaited query and on .catch()', async () => {
    const db = withDatabaseAvailability(fakeClient(() => Promise.reject(quotaError())));
    await expect(db('select 1')).rejects.toBeInstanceOf(ServiceUnavailableError);
    const caught = await db('select 1').catch((error: unknown) => error);
    expect(statusOf(caught)).toBe(503);
  });

  it('passes results and unrelated failures through untouched', async () => {
    await expect(withDatabaseAvailability(fakeClient(() => Promise.resolve([{ id: 1 }])))('select 1')).resolves.toEqual([{ id: 1 }]);
    const sqlError = new Error('relation "x" does not exist');
    await expect(withDatabaseAvailability(fakeClient(() => Promise.reject(sqlError)))('select 1')).rejects.toBe(sqlError);
  });

  it('keeps the query object intact for transaction(), and translates its refusal too', async () => {
    const ok = withDatabaseAvailability(fakeClient(() => Promise.resolve([])));
    const query = ok('select 1');
    expect(query.parameterizedQuery).toEqual({ query: 'select 1' });
    await expect(ok.transaction([query])).resolves.toEqual([{ query: 'select 1' }]);

    const down = withDatabaseAvailability(fakeClient(() => Promise.reject(quotaError())));
    await expect(down.transaction([down('select 1')])).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
