/**
 * `inTransaction`'s WebSocket-pool path — the one the HTTP client's availability
 * wrapper does not cover. The seam is Drizzle's pool adapter (`drizzle-orm/neon-serverless`),
 * mocked at the module boundary: the pool object `connection.ts` builds is real but
 * never connects (a pool opens its socket on the first query), and the adapter that
 * would run a query on it is replaced, so no socket opens and no query runs. The test
 * names no database driver: only `connection.ts` may (`npm run check:db-access`).
 * Pinned here:
 *
 *   • a Neon quota refusal (the bare Postgres-error text the WebSocket proxy sends)
 *     answers as the `database_unavailable` outage, not an unknown 500;
 *   • an error thrown by the transaction BODY passes through by identity;
 *   • a `pool.end()` that rejects replaces neither the result of a committed
 *     transaction nor the error of a failed one, and is reported rather than swallowed;
 *   • the pool is closed after every outcome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError, ServiceUnavailableError } from '../../domain/shared/errors';
import type { Env } from '../../env';

const driver = vi.hoisted(() => ({
  endImpl: (): Promise<void> => Promise.resolve(),
  endCalls: 0,
  transactionImpl: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work({}),
  reported: [] as Array<{ operation: string; level?: string }>,
}));

vi.mock('drizzle-orm/neon-serverless', () => ({
  // Receives the pool `inTransaction` built; swap its close for a controllable one.
  drizzle: (pool: { end: () => Promise<void> }) => {
    pool.end = () => { driver.endCalls += 1; return driver.endImpl(); };
    return { transaction: (work: (tx: unknown) => Promise<unknown>) => driver.transactionImpl(work) };
  },
}));

vi.mock('../../application/observability/caughtErrorReporter', () => ({
  reportCaughtError: (_error: unknown, details: { operation: string; level?: string }) => {
    driver.reported.push({ operation: details.operation, level: details.level });
  },
}));

import { DATABASE_UNAVAILABLE_CODE } from './neonAvailability';
import { buildDatabase, inTransaction } from './connection';

const env = {
  NEON_DATABASE_URL: 'postgres://user:pass@txn.neon.tech/core',
  CORS_ORIGINS: '',
  ENVIRONMENT: 'test',
} as unknown as Env;

const quotaAtConnect = () => new Error(
  'Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.',
);

describe('inTransaction (pool path)', () => {
  beforeEach(() => {
    driver.endImpl = () => Promise.resolve();
    driver.endCalls = 0;
    driver.reported.length = 0;
    driver.transactionImpl = (work) => work({});
  });

  it('returns the body result', async () => {
    await expect(inTransaction(buildDatabase(env), async () => 42)).resolves.toBe(42);
  });

  it('closes the pool after a commit and after a failure', async () => {
    await inTransaction(buildDatabase(env), async () => 1);
    expect(driver.endCalls).toBe(1);
    await inTransaction(buildDatabase(env), async () => { throw new DomainError('nope'); }).catch(() => undefined);
    expect(driver.endCalls).toBe(2);
    expect(driver.reported).toEqual([]);
  });

  it('answers a quota refusal at connect as the database_unavailable outage', async () => {
    const original = quotaAtConnect();
    driver.transactionImpl = () => Promise.reject(original);
    const error = await inTransaction(buildDatabase(env), async () => 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ServiceUnavailableError).code).toBe(DATABASE_UNAVAILABLE_CODE);
    expect((error as ServiceUnavailableError).cause).toBe(original);
  });

  it('passes a domain error from the body through by identity', async () => {
    const domain = new DomainError('slot already taken');
    const error = await inTransaction(buildDatabase(env), async () => { throw domain; }).catch((e: unknown) => e);
    expect(error).toBe(domain);
  });

  it('does not let a rejecting pool.end() mask a mapped outage or a body error', async () => {
    driver.endImpl = () => Promise.reject(new Error('socket already closed'));

    driver.transactionImpl = () => Promise.reject(quotaAtConnect());
    const outage = await inTransaction(buildDatabase(env), async () => 1).catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(ServiceUnavailableError);

    driver.transactionImpl = (work) => work({});
    const domain = new DomainError('nope');
    const body = await inTransaction(buildDatabase(env), async () => { throw domain; }).catch((e: unknown) => e);
    expect(body).toBe(domain);
  });

  it('still returns the committed result when pool.end() rejects', async () => {
    driver.endImpl = () => Promise.reject(new Error('socket already closed'));
    await expect(inTransaction(buildDatabase(env), async () => 'committed')).resolves.toBe('committed');
    // Reported, not swallowed: a socket that will not close is a leak worth seeing.
    expect(driver.reported).toEqual([{ operation: 'inTransaction:poolEnd', level: 'warning' }]);
  });

  it('a handle with no connection string keeps using its own transaction()', async () => {
    const double = { transaction: async (work: (tx: unknown) => Promise<unknown>) => work('tx') };
    await expect(inTransaction(double as never, async (tx) => tx)).resolves.toBe('tx');
  });
});
