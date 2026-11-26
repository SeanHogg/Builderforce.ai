/**
 * recordRuntimeShieldEvent — the caller-scope gate (tenant, and segment when the session has one)
 * and the per-project cap of open client-attested incidents. The kind's floor/dedupe behaviour is
 * covered in findingIncidentKinds.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ownership = vi.hoisted(() => ({ loadProjectInTenant: vi.fn(), projectInTenantCached: vi.fn() }));
const openKindIncident = vi.hoisted(() => vi.fn());
vi.mock('../project/projectOwnership', () => ownership);
vi.mock('./findingIncidentKinds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./findingIncidentKinds')>()),
  openKindIncident,
}));

import { recordRuntimeShieldEvent } from './runtimeShieldIncidents';
import { SHIELD_OPEN_INCIDENTS_PER_PROJECT, type RuntimeShieldEvent } from './runtimeShieldEvent';

const actor = { type: 'human' as const, ref: 'u1', name: 'Dev' };
const event: RuntimeShieldEvent = {
  category: 'database', ruleId: 'db-ownership', severity: 'high', reasonCode: 'db.not_owner', action: 'quarantine',
  applicationId: 'app-1', serviceId: 'api', projectId: 42, evidence: {}, occurredAt: '2026-11-18T10:00:00.000Z',
};

/** A db whose cap query answers `openCount` open incidents (bounded by the query's limit). */
function fakeDb(openCount: number) {
  const limits: number[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (n: number) => {
            limits.push(n);
            return Array.from({ length: Math.min(openCount, n) }, (_, i) => ({ id: `inc-${i}` }));
          },
        }),
      }),
    }),
  };
  return { db: db as never, limits };
}

describe('recordRuntimeShieldEvent', () => {
  beforeEach(() => {
    ownership.loadProjectInTenant.mockReset();
    ownership.projectInTenantCached.mockReset();
    openKindIncident.mockReset().mockResolvedValue({ outcome: 'opened', incidentId: 'inc-1' });
  });

  it('refuses a project of another segment when the session is segment-scoped', async () => {
    ownership.loadProjectInTenant.mockResolvedValue({ segmentId: 'other-seg' });
    const { db } = fakeDb(0);
    expect(await recordRuntimeShieldEvent(undefined, db, actor, { tenantId: 7, segmentId: 'seg' }, event))
      .toEqual({ outcome: 'unknown_project' });
    expect(ownership.loadProjectInTenant).toHaveBeenCalledWith(db, 7, 42, expect.objectContaining({ segmentId: expect.anything() }));
    expect(openKindIncident).not.toHaveBeenCalled();
  });

  it('refuses a project of another tenant when the session is segment-scoped', async () => {
    ownership.loadProjectInTenant.mockResolvedValue(null);
    expect(await recordRuntimeShieldEvent(undefined, fakeDb(0).db, actor, { tenantId: 7, segmentId: 'seg' }, event))
      .toEqual({ outcome: 'unknown_project' });
  });

  it('records a project of the session segment', async () => {
    ownership.loadProjectInTenant.mockResolvedValue({ segmentId: 'seg' });
    expect(await recordRuntimeShieldEvent(undefined, fakeDb(0).db, actor, { tenantId: 7, segmentId: 'seg' }, event))
      .toEqual({ outcome: 'opened', incidentId: 'inc-1' });
    expect(ownership.projectInTenantCached).not.toHaveBeenCalled();
  });

  it('keeps the cached tenant gate for a session without a segment', async () => {
    ownership.projectInTenantCached.mockResolvedValue(false);
    expect(await recordRuntimeShieldEvent(undefined, fakeDb(0).db, actor, { tenantId: 7, segmentId: '' }, event))
      .toEqual({ outcome: 'unknown_project' });
    expect(ownership.loadProjectInTenant).not.toHaveBeenCalled();
  });

  it(`ignores a report with reason 'cap' once the project holds ${SHIELD_OPEN_INCIDENTS_PER_PROJECT} open incidents`, async () => {
    ownership.loadProjectInTenant.mockResolvedValue({ segmentId: 'seg' });
    const { db, limits } = fakeDb(SHIELD_OPEN_INCIDENTS_PER_PROJECT + 10);
    expect(await recordRuntimeShieldEvent(undefined, db, actor, { tenantId: 7, segmentId: 'seg' }, event))
      .toEqual({ outcome: 'ignored', reason: 'cap' });
    expect(limits).toEqual([SHIELD_OPEN_INCIDENTS_PER_PROJECT]);
    expect(openKindIncident).not.toHaveBeenCalled();
  });

  it('stores evidence VALUES redacted: a secret under a benign key is masked', async () => {
    ownership.loadProjectInTenant.mockResolvedValue({ segmentId: 'seg' });
    const secret = `sk-live-${'a1b2c3d4'.repeat(4)}`;
    await recordRuntimeShieldEvent(undefined, fakeDb(0).db, actor, { tenantId: 7, segmentId: 'seg' }, { ...event, evidence: { note: `rejected ${secret}`, path: '/api/orders' } });
    const stored = openKindIncident.mock.calls[0]![4] as RuntimeShieldEvent;
    expect(JSON.stringify(stored.evidence)).not.toContain(secret);
    expect(stored.evidence.path).toBe('/api/orders');
  });

  it('opens below the cap', async () => {
    ownership.loadProjectInTenant.mockResolvedValue({ segmentId: 'seg' });
    expect(await recordRuntimeShieldEvent(undefined, fakeDb(SHIELD_OPEN_INCIDENTS_PER_PROJECT - 1).db, actor, { tenantId: 7, segmentId: 'seg' }, event))
      .toMatchObject({ outcome: 'opened' });
  });

  it('ignores a probe or a medium reason without spending the cap query', async () => {
    ownership.loadProjectInTenant.mockResolvedValue({ segmentId: 'seg' });
    const { db, limits } = fakeDb(0);
    expect(await recordRuntimeShieldEvent(undefined, db, actor, { tenantId: 7, segmentId: 'seg' }, { ...event, action: 'monitor' }))
      .toEqual({ outcome: 'ignored' });
    expect(await recordRuntimeShieldEvent(undefined, db, actor, { tenantId: 7, segmentId: 'seg' }, { ...event, reasonCode: 'process.spawn_quota', severity: 'critical' }))
      .toEqual({ outcome: 'ignored' });
    expect(limits).toEqual([]);
    expect(openKindIncident).not.toHaveBeenCalled();
  });
});
