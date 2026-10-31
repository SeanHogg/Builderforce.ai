/**
 * `inTransaction`'s WebSocket-pool path — the one the HTTP client's availability
 * wrapper does not cover. The driver is mocked at the module boundary: no socket
 * opens and no query runs. Pinned here:
 *
 *   • a Neon quota refusal (the bare Postgres-error text the WebSocket proxy sends)
 *     answers as the `database_unavailable` outage, not an unknown 500;
 *   • an error thrown by the transaction BODY passes through by identity;
 *   • a `pool.end()` that rejects replaces neither the result of a committed
 *     transaction nor the error of a failed one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError, ServiceUnavailableError } from '../../domain/shared/errors';
import type { Env } from '../../env';

const driver = vi.hoisted(() => ({
  endImpl: (): Promise<void> => Promise.resolve(),
  transactionImpl: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work({}),
}));

vi.mock('@neondatabase/serverless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@neondatabase/serverless')>()),
  Pool: class {
    end() { return driver.endImpl(); }
  },
}));

vi.mock('drizzle-orm/neon-serverless', () => ({
  drizzle: () => ({ transaction: (work: (tx: unknown) => Promise<unknown>) => driver.transactionImpl(work) }),
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
    driver.transactionImpl = (work) => work({});
  });

  it('returns the body result', async () => {
    await expect(inTransaction(buildDatabase(env), async () => 42)).resolves.toBe(42);
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
  });

  it('a handle with no connection string keeps using its own transaction()', async () => {
    const double = { transaction: async (work: (tx: unknown) => Promise<unknown>) => work('tx') };
    await expect(inTransaction(double as never, async (tx) => tx)).resolves.toBe('tx');
  });
});
