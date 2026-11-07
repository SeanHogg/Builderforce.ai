/**
 * The project sync lock is a BOUNDED wait (PRD 41 A11): `lock_timeout` is set before the advisory lock, and its expiry
 * (Postgres 55P03) is a typed, retryable 503 the client pump backs off on, not a hung request or a 500.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { drizzleLedger } from './knowledgeLedger';
import { KnowledgeSyncError } from './sync/knowledgeSyncPorts';

const text = (q: unknown): string => JSON.stringify((q as { queryChunks?: unknown }).queryChunks ?? '');

describe('ledger.lock', () => {
  it('sets a local lock_timeout, takes the advisory lock, then restores the default timeout', async () => {
    const seen: string[] = [];
    const db = { execute: async (q: unknown) => { seen.push(text(q)); return { rows: [] }; } } as unknown as Db;
    await drizzleLedger(db, 1, 2).lock();
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatch(/SET LOCAL lock_timeout = '\d+s'/);
    expect(seen[1]).toContain('pg_advisory_xact_lock');
    expect(seen[2]).toContain('SET LOCAL lock_timeout = DEFAULT');
  });

  it.each([['the error itself', { code: '55P03' }], ['a driver-wrapped cause', { cause: { code: '55P03' } }]])('turns an expired wait (%s) into a retryable 503 with a retry hint', async (_n, failure) => {
    const db = { execute: async (q: unknown) => { if (text(q).includes('pg_advisory_xact_lock')) throw Object.assign(new Error('canceling statement due to lock timeout'), failure); return { rows: [] }; } } as unknown as Db;
    const error = await drizzleLedger(db, 1, 2).lock().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KnowledgeSyncError);
    expect(error).toMatchObject({ status: 503, code: 'sync_busy' });
    expect((error as KnowledgeSyncError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rethrows any other failure unchanged', async () => {
    const boom = new Error('connection reset');
    const db = { execute: async () => { throw boom; } } as unknown as Db;
    await expect(drizzleLedger(db, 1, 2).lock()).rejects.toBe(boom);
  });
});
