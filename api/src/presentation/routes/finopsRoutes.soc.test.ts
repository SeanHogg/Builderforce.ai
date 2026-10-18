/**
 * SOC 1 coverage has ONE cached reader. `GET /soc/controls` is canonical; the old
 * `GET /soc/coverage` is the same handler, stamped deprecated with the successor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 21;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); c.set('segmentId', 's'); c.set('role', 'manager'); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const soc = vi.hoisted(() => ({ readControlCoverage: vi.fn(), addSocControl: vi.fn(), updateSocControl: vi.fn() }));
vi.mock('../../application/finops/socControls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/finops/socControls')>()),
  ...soc,
}));

import { createFinopsRoutes } from './finopsRoutes';

const coverage = { total: 1, implemented: 1, partial: 0, gap: 0, coveragePct: 100, seeded: false, controls: [] };
const app = () => createFinopsRoutes({} as any);

beforeEach(() => {
  vi.clearAllMocks();
  soc.readControlCoverage.mockResolvedValue(coverage);
});

describe('SOC 1 coverage reads', () => {
  it('serves /soc/controls through the cached reader', async () => {
    const res = await app().request('/soc/controls');
    expect(await res.json()).toEqual(coverage);
    expect(soc.readControlCoverage.mock.calls[0]![2]).toBe(TENANT);
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('serves /soc/coverage from the same reader, naming /soc/controls as successor', async () => {
    const res = await app().request('/soc/coverage');
    expect(await res.json()).toEqual(coverage);
    expect(soc.readControlCoverage).toHaveBeenCalledTimes(1);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/finops/soc/controls>; rel="successor-version"');
  });
});

describe('SOC 1 writes', () => {
  it('404s a PATCH to a control the tenant does not own', async () => {
    soc.updateSocControl.mockResolvedValue(null);
    const res = await app().request('/soc/controls/9', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'implemented' }),
    });
    expect(res.status).toBe(404);
    expect(soc.updateSocControl.mock.calls[0]!.slice(2)).toEqual([TENANT, 9, { status: 'implemented' }]);
  });

  it('creates a control through the shared use case', async () => {
    soc.addSocControl.mockResolvedValue(coverage);
    const res = await app().request('/soc/controls', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ controlRef: 'X-1', objective: 'Obj' }),
    });
    expect(res.status).toBe(201);
    expect(soc.addSocControl.mock.calls[0]![3]).toMatchObject({ controlRef: 'X-1', objective: 'Obj', category: 'general', status: 'gap' });
  });
});
