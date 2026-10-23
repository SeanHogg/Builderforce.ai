/**
 * A slug lookup never resolves a template row as a listing.
 *
 * Since 1263 `catalog_items` holds kanban and canvas templates beside the
 * marketplace listings. Both by-slug reads — the public listing page and the
 * buyer's launch/install resolution — are bounded to the sellable kinds
 * (`LISTING_KIND_IDS`), and the buyer read additionally requires a row that was
 * published at some point, so a private draft never resolves.
 */
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { LISTING_KIND_IDS } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { getPublicListing } from './browse';
import { resolveListingBySlug } from './launch';

const dialect = new PgDialect();

function capturingDb() {
  const seen: { where?: { sql: string; params: unknown[] } } = {};
  const chain = {
    from: () => chain,
    where: (predicate: SQL) => { seen.where = dialect.sqlToQuery(predicate); return chain; },
    limit: () => Promise.resolve([]),
  };
  return { seen, db: { select: () => chain } as unknown as Db };
}

describe('resolveListingBySlug (launch / install)', () => {
  it('is bounded to the listing kinds — never a kanban or canvas template', async () => {
    const { db, seen } = capturingDb();
    expect(await resolveListingBySlug(db, 'some-slug')).toBeNull();
    expect(seen.where?.sql).toMatch(/"kind" in \(/);
    expect(seen.where?.params).toEqual(expect.arrayContaining([...LISTING_KIND_IDS]));
    expect(seen.where?.params).not.toContain('kanban_template');
    expect(seen.where?.params).not.toContain('canvas_template');
  });

  it('requires a row that was published (a withdrawn listing still resolves, a draft does not)', async () => {
    const { db, seen } = capturingDb();
    await resolveListingBySlug(db, 'some-slug');
    expect(seen.where?.sql).toMatch(/"published_at" is not null/);
    // Withdrawal flips visibility to private and keeps published_at, so the
    // read must not filter on visibility — the licence rule decides that.
    expect(seen.where?.sql).not.toMatch(/"visibility"/);
  });
});

describe('getPublicListing (the public listing page)', () => {
  it('is bounded to the listing kinds and to public rows', async () => {
    const { db, seen } = capturingDb();
    expect(await getPublicListing(db, undefined as unknown as Env, 'some-slug')).toBeNull();
    expect(seen.where?.sql).toMatch(/"kind" in \(/);
    expect(seen.where?.sql).toMatch(/"visibility" = /);
    expect(seen.where?.params).not.toContain('kanban_template');
    expect(seen.where?.params).not.toContain('canvas_template');
  });
});
