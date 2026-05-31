import { describe, expect, it, vi } from 'vitest';
import { resolveSegment } from './segmentResolver';

/**
 * Locks the resolveSegment chokepoint behaviour (migrations 0054/0055 rely on it):
 *  - no claims → the tenant's default segment
 *  - account/company claims → matching segment, lazy-created on miss
 *  - resolved ids are cached per (tenant, account, company)
 *
 * The module-level cache persists across cases, so each case uses a distinct
 * tenant id to stay isolated.
 */

/** Minimal chainable Drizzle mock. `selectReturns` is consumed one .limit() at a time. */
function mockDb(selectReturns: Array<Array<{ id: string }>>, onInsert = vi.fn(async () => {})) {
  const limit = vi.fn(async () => selectReturns.shift() ?? []);
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  const insert = vi.fn(() => ({ values: () => ({ onConflictDoNothing: onInsert }) }));
  return { db: { select, insert } as any, select, insert, limit };
}

describe('resolveSegment', () => {
  it('returns the tenant default segment when there are no claims', async () => {
    const { db } = mockDb([[{ id: 'seg-default' }]]);
    expect(await resolveSegment(db, 9001)).toBe('seg-default');
  });

  it('lazy-creates a federated segment on first sight, then returns it', async () => {
    // first findFederated → miss; insert; re-read → hit
    const { db, insert } = mockDb([[], [{ id: 'seg-fed' }]]);
    const id = await resolveSegment(db, 9002, { accountId: 'acct1', companyId: 'co1' });
    expect(id).toBe('seg-fed');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not insert when the federated segment already exists', async () => {
    const { db, insert } = mockDb([[{ id: 'seg-existing' }]]);
    const id = await resolveSegment(db, 9003, { accountId: 'acct2', companyId: 'co2' });
    expect(id).toBe('seg-existing');
    expect(insert).not.toHaveBeenCalled();
  });

  it('caches the resolved id and skips the DB on repeat calls', async () => {
    const { db, select } = mockDb([[{ id: 'seg-cached' }]]);
    expect(await resolveSegment(db, 9004)).toBe('seg-cached');
    expect(await resolveSegment(db, 9004)).toBe('seg-cached');
    expect(select).toHaveBeenCalledTimes(1); // second call served from cache
  });
});
