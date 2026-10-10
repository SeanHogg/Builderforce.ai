import { describe, it, expect, vi, beforeEach } from 'vitest';

const taken = new Set<string>();
vi.mock('./siteHosting', () => ({
  // Minimal stand-in for the shared availability rule: lowercase labels, `admin`
  // reserved, anything in `taken` held by another project.
  checkSubdomainAvailability: vi.fn(async (_db: unknown, raw: string) => {
    const label = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (label === 'admin') return { label: null, available: false, reason: 'reserved', host: null };
    if (!/^[a-z0-9-]+$/.test(label)) return { label: null, available: false, reason: 'invalid', host: null };
    const isTaken = taken.has(label);
    return { label, available: !isTaken, reason: isTaken ? 'taken' : 'ok', host: null };
  }),
}));

import { choosePublishSubdomain, claimSiteRow, PROJECT_SITES_SUBDOMAIN_CONSTRAINT } from './siteSubdomainClaim';

const db = {} as never;
const subdomainViolation = () =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${PROJECT_SITES_SUBDOMAIN_CONSTRAINT}"`), { code: '23505' });

beforeEach(() => taken.clear());

describe('choosePublishSubdomain', () => {
  it('uses a free requested subdomain', async () => {
    expect(await choosePublishSubdomain(db, { projectId: 1, projectName: 'Acme', requestedSubdomain: 'shop' }))
      .toEqual({ ok: true, subdomain: 'shop' });
  });

  it('answers 409 naming an explicitly requested subdomain that is taken', async () => {
    taken.add('shop');
    const res = await choosePublishSubdomain(db, { projectId: 1, projectName: 'Acme', requestedSubdomain: 'shop' });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(!res.ok && res.error).toContain('"shop"');
  });

  it('answers 409 when the subdomain the project already holds is now taken (it was chosen, not derived)', async () => {
    taken.add('held');
    const res = await choosePublishSubdomain(db, { projectId: 1, projectName: 'Acme', currentSubdomain: 'held' });
    expect(res).toMatchObject({ ok: false, status: 409 });
  });

  it('suffixes a subdomain derived from the project name past a collision', async () => {
    taken.add('my-app');
    taken.add('my-app-2');
    expect(await choosePublishSubdomain(db, { projectId: 1, projectName: 'My App' }))
      .toEqual({ ok: true, subdomain: 'my-app-3' });
  });

  it('answers 400 for a reserved label', async () => {
    expect(await choosePublishSubdomain(db, { projectId: 1, projectName: 'x', requestedSubdomain: 'admin' }))
      .toMatchObject({ ok: false, status: 400 });
  });
});

describe('claimSiteRow', () => {
  it('returns the upserted row on success', async () => {
    expect(await claimSiteRow(db, 'shop', 1, async () => [{ id: 9 }])).toEqual({ ok: true, row: [{ id: 9 }] });
  });

  it('answers 409 naming the subdomain when another project won the insert race', async () => {
    taken.add('shop');
    const upsert = vi.fn(async () => { throw subdomainViolation(); });
    const res = await claimSiteRow(db, 'shop', 1, upsert);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(!res.ok && res.error).toContain('"shop"');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('retries once as an update when the racing publish was THIS project', async () => {
    const upsert = vi.fn()
      .mockRejectedValueOnce(subdomainViolation())
      .mockResolvedValueOnce([{ id: 4 }]);
    expect(await claimSiteRow(db, 'shop', 1, upsert)).toEqual({ ok: true, row: [{ id: 4 }] });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('rethrows any other error', async () => {
    const other = Object.assign(new Error('duplicate key value violates unique constraint "project_sites_project_id_key"'), { code: '23505' });
    await expect(claimSiteRow(db, 'shop', 1, async () => { throw other; })).rejects.toBe(other);
  });
});
