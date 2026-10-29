/**
 * `notePrescriptionPreview` records a preview a PERSON built from the IDE publish panel
 * on the fix it was published for — and only on a hosted fix of THIS project in THIS
 * workspace that is still `applied`. Anything else is a silent no-op: a publish can
 * never attach a preview to another tenant's (or another project's) prescription.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSite: vi.fn(),
  bump: vi.fn(async () => {}),
}));
vi.mock('./replaySites', () => ({ getSite: mocks.getSite }));
vi.mock('./replayCacheKeys', () => ({ bumpSiteVersion: mocks.bump, bumpReplaySitesVersion: vi.fn() }));
vi.mock('./replayDatabase', () => ({ replayTelemetryDb: (_env: unknown, db: unknown) => db }));
vi.mock('../marketing/experimentation', () => ({ createTest: vi.fn(), setVariants: vi.fn(), startTest: vi.fn(), ExperimentError: class extends Error {} }));
vi.mock('../ide/siteReleases', () => ({ restoreSiteRelease: vi.fn() }));
vi.mock('../ide/appsDatabase', () => ({ appsDatabaseOf: (db: unknown) => db }));
vi.mock('../ide/siteHosting', () => ({ HOSTING_APEX: 'example.test' }));

import { notePrescriptionPreview } from './prescriptionReleases';

const RX = '11111111-2222-4333-8444-555555555555';
const SITE_ID = '22222222-2222-4333-8444-555555555555';
const env = {} as never;
let row: Record<string, unknown> | undefined;
let updates: Array<Record<string, unknown>>;

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => { updates.push(values); return { where: async () => {} }; } }),
} as never;
const note = (over: Partial<{ tenantId: number; projectId: number; prescriptionId: string }> = {}) =>
  notePrescriptionPreview(env, db, { tenantId: 7, projectId: 42, prescriptionId: RX, versionToken: 'abc123def456', ...over });

beforeEach(() => {
  updates = [];
  mocks.bump.mockClear();
  row = { id: RX, siteId: SITE_ID, status: 'applied', actionKind: 'fix', actionRef: 't=77', finding: {} };
  mocks.getSite.mockResolvedValue({ id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42 });
});

describe('notePrescriptionPreview', () => {
  it('records the preview on an applied fix of this project and workspace', async () => {
    expect(await note()).toBe(true);
    expect(updates[0]).toMatchObject({ actionRef: 't=77;p=abc123def456' });
    expect(mocks.bump).toHaveBeenCalledWith(env, SITE_ID);
  });

  it('refuses another workspace’s prescription', async () => {
    expect(await note({ tenantId: 8 })).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses a prescription whose site belongs to another project', async () => {
    expect(await note({ projectId: 43 })).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses an external site, a fix not yet applied, a non-fix action and a bad id', async () => {
    mocks.getSite.mockResolvedValue({ id: SITE_ID, tenantId: 7, kind: 'external', projectId: null });
    expect(await note()).toBe(false);
    mocks.getSite.mockResolvedValue({ id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42 });
    row = { ...row, status: 'proposed' };
    expect(await note()).toBe(false);
    row = { ...row, status: 'applied', actionKind: 'ticket' };
    expect(await note()).toBe(false);
    expect(await note({ prescriptionId: 'not-a-uuid' })).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
