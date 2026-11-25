import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/neon-http';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import type { HonoEnv } from '../../env';
import { errorHandler } from '../../presentation/middleware/errorHandler';
import { __clearL1CacheForTests, getOrSetCached, OUTAGE_STALE_TTL_SECONDS } from '../cache/readThroughCache';
import { DATABASE_UNAVAILABLE_CODE, asDatabaseUnavailable, isDatabaseUnavailable, withDatabaseAvailability } from './neonAvailability';

/**
 * regression: production runs REAL drizzle over the Neon client, and drizzle's
 * `PgPreparedQuery.queryWithCache` rethrows every driver failure as
 * `DrizzleQueryError(query, params, cause)`. The outage error `withDatabaseAvailability`
 * raises therefore reaches the app as a `.cause`, which `instanceof` never matched — so
 * the 503 mapping and the cache's stale fallback were dead code outside unit tests.
 */
const quotaRefusal = () => new Error(
  'Server error (HTTP status 402): {"message":"Your project has exceeded the data transfer quota"}',
);

const things = pgTable('things', { id: integer('id').primaryKey() });

/** A `neon(url)` stand-in shaped like the real one: callable, with `.query` and `.transaction`,
 *  answering with lazy thenables. */
function refusingNeon() {
  const run = () => ({
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise.reject(quotaRefusal()).then(onFulfilled, onRejected),
    catch: (onRejected: (e: unknown) => unknown) => Promise.reject(quotaRefusal()).catch(onRejected),
    finally: (onFinally?: () => void) => Promise.reject(quotaRefusal()).finally(onFinally),
  });
  const client = (..._args: unknown[]) => run();
  return Object.assign(client, { query: (..._args: unknown[]) => run(), transaction: () => Promise.reject(quotaRefusal()) });
}

function refusingDb() {
  return drizzle(withDatabaseAvailability(refusingNeon()) as never);
}

async function selectThings(): Promise<unknown> {
  return refusingDb().select().from(things);
}

describe('database outage through real drizzle', () => {
  it('a drizzle select against a refusing Neon is recognised as the outage', async () => {
    const caught = await selectThings().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).constructor.name).toBe('DrizzleQueryError');
    expect(isDatabaseUnavailable(caught)).toBe(true);
  });

  it('asDatabaseUnavailable maps a raw quota error wrapped in a plain cause chain', () => {
    const wrapped = new Error('Failed query', { cause: quotaRefusal() });
    const mapped = asDatabaseUnavailable(wrapped);
    expect(isDatabaseUnavailable(mapped)).toBe(true);
    expect(asDatabaseUnavailable(new Error('boom', { cause: new Error('relation "x" does not exist') }))).toBeInstanceOf(Error);
  });

  it('the app error handler answers it 503 database_unavailable', async () => {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.get('/', async (c) => c.json(await selectThings()));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await app.request('/', undefined, { CORS_ORIGINS: '*' } as unknown as HonoEnv['Bindings']);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: DATABASE_UNAVAILABLE_CODE });
      // Not reported: the durable error sink is a write to the database that is refusing.
      expect(spy.mock.calls.some(([tag]) => tag === '[unhandled-error]')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('stale-on-unavailable cache over a drizzle-wrapped outage', () => {
  beforeEach(() => {
    __clearL1CacheForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('serves the last-known-good value when the loader\'s drizzle select is refused', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    };
    const env = { AUTH_CACHE_KV: kv } as never;
    const opts = { kvTtlSeconds: 60, staleOnUnavailableSeconds: OUTAGE_STALE_TTL_SECONDS };

    await expect(getOrSetCached(env, 'regression:drizzle', async () => ({ id: 7 }), opts)).resolves.toEqual({ id: 7 });

    // Past the fresh window, with no L1 copy: the loader runs, and the database refuses.
    __clearL1CacheForTests();
    vi.setSystemTime(Date.now() + 120_000);
    const loader = vi.fn(async () => selectThings());
    await expect(getOrSetCached(env, 'regression:drizzle', loader, opts)).resolves.toEqual({ id: 7 });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
