import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audienceWindow, getSiteAudienceSummary, siteAudienceCacheKey } from './siteAudienceSummary';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;
const site = { siteId: 9, subdomain: 'yard', customDomain: null };

/** Every bound primitive a Drizzle `where` carries — the window's cutoff day among them. */
function whereValues(where: unknown): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if ('value' in record && (typeof record.value === 'string' || typeof record.value === 'number')) found.push(record.value);
    if ('table' in record) return; // a column: its table back-reference is not part of the clause
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
      else walk(value, depth + 1);
    }
  };
  walk(where, 0);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('getSiteAudienceSummary', () => {
  it('is all zeros and unpublished when the project has no site — one lookup, no aggregates', async () => {
    const db = fakeDb([[]]);
    expect(await getSiteAudienceSummary(undefined, asDb(db), 7, 3)).toEqual({
      published: false, users: 0, newUsers: 0, visitors: 0, pageViews: 0, leads: 0, days: 30, approximateTraffic: true,
    });
    expect(db.calls).toHaveLength(1);
  });

  it('adds up users, new sign-ups, traffic and leads in one aggregate per table', async () => {
    // Postgres hands SUMs back as strings; the summary must be numbers.
    const db = fakeDb([[site], [{ users: 120, newUsers: 14 }], [{ visitors: '300', pageViews: '950' }], [{ leads: '42' }]]);
    expect(await getSiteAudienceSummary(undefined, asDb(db), 7, 3)).toEqual({
      published: true, users: 120, newUsers: 14, visitors: 300, pageViews: 950, leads: 42, days: 30, approximateTraffic: true,
    });
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'select', 'select', 'select']);
    // Bounded aggregates: no per-row reads, no paging.
    for (const call of db.calls.slice(1)) expect(call.chain).not.toContain('limit');
    // Every aggregate is scoped to the site AND the tenant.
    for (const call of db.calls.slice(1)) expect(whereColumns(call.where)).toEqual(expect.arrayContaining(['site_id', 'tenant_id']));
  });

  it('reads empty aggregates (no rows, null sums) as zero', async () => {
    const db = fakeDb([[site], [], [{ visitors: null, pageViews: null }], [{ leads: null }]]);
    const result = await getSiteAudienceSummary(undefined, asDb(db), 7, 3);
    expect(result).toMatchObject({ published: true, users: 0, newUsers: 0, visitors: 0, pageViews: 0, leads: 0 });
  });

  it('filters traffic to the requested window and carries that window through', async () => {
    const db = fakeDb([[site], [{ users: 5, newUsers: 1 }], [{ visitors: 3, pageViews: 8 }], [{ leads: 0 }]]);
    const result = await getSiteAudienceSummary(undefined, asDb(db), 7, 3, { days: 7 });
    expect(result.days).toBe(7);
    const traffic = db.calls[2]!;
    expect(whereColumns(traffic.where)).toContain('day');
    // Seven UTC days back from 2026-10-04.
    expect(whereValues(traffic.where)).toContain('2026-09-27');
  });

  it('clamps a window the UI does not offer to the 30-day default', async () => {
    const db = fakeDb([[site], [], [], []]);
    const result = await getSiteAudienceSummary(undefined, asDb(db), 7, 3, { days: 45 });
    expect(result.days).toBe(30);
    expect(whereValues(db.calls[2]!.where)).toContain('2026-09-04');
  });
});

describe('audienceWindow / siteAudienceCacheKey', () => {
  it('accepts only the offered windows', () => {
    expect(audienceWindow(7)).toBe(7);
    expect(audienceWindow(90)).toBe(90);
    expect(audienceWindow(365)).toBe(30);
    expect(audienceWindow(undefined)).toBe(30);
  });

  it('keys by tenant, project and window', () => {
    expect(siteAudienceCacheKey(7, 3, 30)).toBe('site-audience:t:7:p:3:d:30');
  });
});
