import { describe, expect, it } from 'vitest';
import { SQL } from 'drizzle-orm';
import { ProductReleaseService } from './ProductReleaseService';
import type { Db } from '../../infrastructure/database/connection';

const SCOPE = { tenantId: 7, segmentId: null };
const NOW = new Date('2026-10-23T12:00:00.000Z');

/** Captures what the service hands Drizzle; returns the written values as the row. */
function fakeDb() {
  const seen: { values?: Record<string, unknown>; set?: Record<string, unknown>; returning?: Record<string, unknown> } = {};
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        seen.values = v;
        return { returning: async (cols?: Record<string, unknown>) => { seen.returning = cols; return [{ id: 'r1', ...v }]; } };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        seen.set = s;
        return { where: () => ({ returning: async (cols?: Record<string, unknown>) => { seen.returning = cols; return [{ id: 'r1', ...s }]; } }) };
      },
    }),
  };
  return { db: db as unknown as Db, seen };
}

describe('ProductReleaseService — released_at follows the status transition', () => {
  it('create: a release created as released is stamped now; a planned one has no actual date', async () => {
    const { db, seen } = fakeDb();
    const svc = new ProductReleaseService(db);
    await svc.create(SCOPE, { name: 'v1', status: 'released' }, NOW);
    expect(seen.values?.releasedAt).toEqual(NOW);

    await svc.create(SCOPE, { name: 'v2', status: 'planned', releasedAt: '2026-10-01' }, NOW);
    expect(seen.values?.releasedAt).toBeNull();
    expect(seen.values?.status).toBe('planned');
  });

  it('create: an explicit ship date back-dates a release created as released', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).create(SCOPE, { name: 'v1', status: 'released', releasedAt: '2026-10-01T00:00:00.000Z' }, NOW);
    expect(seen.values?.releasedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('update: the move to released stamps released_at in SQL (an existing date wins)', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).update(SCOPE, 'r1', { status: 'released' }, NOW);
    expect(seen.set?.status).toBe('released');
    expect(seen.set?.releasedAt).toBeInstanceOf(SQL);
  });

  it('update: moving off released clears released_at, even when the old date is echoed back', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).update(SCOPE, 'r1', { status: 'planned', releasedAt: '2026-10-01T00:00:00.000Z' }, NOW);
    expect(seen.set?.status).toBe('planned');
    expect(seen.set).toHaveProperty('releasedAt', null);
  });

  it('update: cancelling keeps the ship date of a rolled-back release (released_at untouched)', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).update(SCOPE, 'r1', { status: 'cancelled' }, NOW);
    expect(seen.set?.status).toBe('cancelled');
    expect(seen.set).not.toHaveProperty('releasedAt');
  });

  it('update: a write with no status and no date leaves released_at alone', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).update(SCOPE, 'r1', { notes: 'scope agreed' }, NOW);
    expect(seen.set).not.toHaveProperty('releasedAt');
    expect(seen.set?.updatedAt).toEqual(NOW);
  });

  it('update: a bare date is a guarded correction (applies only to a released row)', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).update(SCOPE, 'r1', { releasedAt: '2026-10-01T00:00:00.000Z' }, NOW);
    expect(seen.set).not.toHaveProperty('status');
    expect(seen.set?.releasedAt).toBeInstanceOf(SQL);
  });
});

describe('ProductReleaseService — deprecated releaseDate input alias', () => {
  it('maps releaseDate onto targetDate for a planned release and never writes a release_date', async () => {
    const { db, seen } = fakeDb();
    const svc = new ProductReleaseService(db);
    await svc.create(SCOPE, { name: 'v2', releaseDate: '2026-11-01T00:00:00.000Z' }, NOW);
    expect(seen.values?.targetDate).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    expect(seen.values).not.toHaveProperty('releaseDate');

    await svc.update(SCOPE, 'r1', { releaseDate: '2026-12-01T00:00:00.000Z' }, NOW);
    expect(seen.set?.targetDate).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(seen.set).not.toHaveProperty('releaseDate');
  });

  it('create / update return the explicit projection — the deprecated release_date column never reaches a response', async () => {
    const { db, seen } = fakeDb();
    const svc = new ProductReleaseService(db);
    await svc.create(SCOPE, { name: 'v1' }, NOW);
    expect(Object.keys(seen.returning ?? {})).toEqual(expect.arrayContaining(['targetDate', 'releasedAt']));
    expect(seen.returning).not.toHaveProperty('releaseDate');
    seen.returning = undefined;
    await svc.update(SCOPE, 'r1', { name: 'v1b' }, NOW);
    expect(seen.returning).toBeDefined();
    expect(seen.returning).not.toHaveProperty('releaseDate');
  });

  it('on a write that marks the release released, releaseDate is the ship date', async () => {
    const { db, seen } = fakeDb();
    await new ProductReleaseService(db).update(SCOPE, 'r1', { status: 'released', releaseDate: '2026-10-01T00:00:00.000Z' }, NOW);
    expect(seen.set?.releasedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(seen.set).not.toHaveProperty('targetDate');
  });
});
