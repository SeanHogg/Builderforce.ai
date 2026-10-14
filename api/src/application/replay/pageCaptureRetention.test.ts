/**
 * Page-capture retention (PRD 33 §6 "Privacy"): captures live for the site's window or
 * 90 days, whichever is longer — rows and `replay/pages/…` objects alike — and a site
 * that no longer exists keeps no capture objects at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { replayPageCaptures } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { CAPTURE_MIN_RETENTION_DAYS, captureRetentionDays, purgeExpiredCaptures } from './pageCaptureRetention';

const DAY = 86_400_000;
const NOW = new Date('2026-10-13T00:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_GONE = '99999999-9999-4999-8999-999999999999';

/** A fake R2 bucket: `list` honours prefix, delimiter and a one-object page size (to walk cursors). */
function fakeBucket(objects: Record<string, Date>) {
  const store = new Map(Object.entries(objects));
  const deleted: string[] = [];
  const bucket = {
    async list({ prefix, delimiter, cursor }: { prefix: string; delimiter?: string; cursor?: string }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (delimiter) {
        const prefixes = [...new Set(keys.map((k) => k.slice(prefix.length)).filter((rest) => rest.includes(delimiter)).map((rest) => `${prefix}${rest.slice(0, rest.indexOf(delimiter) + 1)}`))];
        return { objects: [], delimitedPrefixes: prefixes, truncated: false };
      }
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + 1);
      const truncated = start + 1 < keys.length;
      return {
        objects: page.map((key) => ({ key, uploaded: store.get(key)! })),
        delimitedPrefixes: [],
        truncated,
        ...(truncated ? { cursor: String(start + 1) } : {}),
      };
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        store.delete(key);
        deleted.push(key);
      }
    },
  };
  return { bucket, store, deleted };
}

function fakeDb(sites: Array<{ id: string; tenantId: number; settings: unknown }>) {
  const deletes: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => sites }) }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          deletes.push({ table, condition });
          return [{ id: 'cap-old' }];
        },
      }),
    }),
  };
  return { db: db as unknown as Db, deletes };
}

describe('page capture retention', () => {
  it('keeps captures for the site window or 90 days, whichever is longer', () => {
    expect(captureRetentionDays(30)).toBe(CAPTURE_MIN_RETENTION_DAYS);
    expect(captureRetentionDays(90)).toBe(90);
    expect(captureRetentionDays(120)).toBe(120);
  });

  it('deletes expired capture objects of a live site, every object of a deleted site, and the expired rows', async () => {
    const prefixA = `replay/pages/t7/${SITE_A}/`;
    const prefixGone = `replay/pages/t7/${SITE_GONE}/`;
    const { bucket, store, deleted } = fakeBucket({
      [`${prefixA}rel-old/abc-desktop-screenshot.jpg`]: ago(120),
      [`${prefixA}rel-old/abc-desktop-rects.json`]: ago(91),
      [`${prefixA}rel-new/abc-desktop-fold.jpg`]: ago(10),
      [`${prefixA}after/rx-1-phone.jpg`]: ago(40),
      [`${prefixGone}rel/abc-phone-fold.jpg`]: ago(1),
      // Recording bytes are another sweep's: never touched here.
      [`replay/t7/${SITE_A}/2026-01-01/rec/000000.ndjson.gz`]: ago(300),
    });
    const { db, deletes } = fakeDb([{ id: SITE_A, tenantId: 7, settings: { retentionDays: 30 } }]);

    const result = await purgeExpiredCaptures({ UPLOADS: bucket } as unknown as Env, db, NOW);

    expect(deleted.sort()).toEqual([
      `${prefixA}rel-old/abc-desktop-rects.json`,
      `${prefixA}rel-old/abc-desktop-screenshot.jpg`,
      `${prefixGone}rel/abc-phone-fold.jpg`,
    ].sort());
    expect([...store.keys()].sort()).toEqual([
      `${prefixA}after/rx-1-phone.jpg`,
      `${prefixA}rel-new/abc-desktop-fold.jpg`,
      `replay/t7/${SITE_A}/2026-01-01/rec/000000.ndjson.gz`,
    ].sort());
    expect(deletes).toHaveLength(1);
    expect((deletes[0] as { table: unknown }).table).toBe(replayPageCaptures);
    expect(result).toEqual({ rows: 1, objects: 3 });
  });

  it('purges rows even without object storage bound', async () => {
    const { db } = fakeDb([{ id: SITE_A, tenantId: 7, settings: {} }]);
    const del = vi.spyOn(db, 'delete');
    expect(await purgeExpiredCaptures({} as Env, db, NOW)).toEqual({ rows: 1, objects: 0 });
    expect(del).toHaveBeenCalledWith(replayPageCaptures);
  });
});
