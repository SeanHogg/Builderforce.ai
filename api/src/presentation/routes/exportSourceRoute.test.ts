import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// The plan gate is the one collaborator that reaches billing; stand it in so the
// test can say "this source is premium and the caller's plan refuses it".
const planGate = vi.fn(async (_c: unknown, _feature: string): Promise<Response | null> => null);
vi.mock('../middleware/insightPlanGate', () => ({
  planFeatureGate: (c: unknown, feature: string) => planGate(c, feature),
}));

import { exportSourceHandler } from './exportSourceRoute';
import type { HonoEnv } from '../../env';
import type { ExportFormat, PlatformExportSource, TenantExportSource } from '../../application/export/exportSource';
import { TenantRole } from '../../domain/shared/types';

const seen: Array<{ tenantId?: number; year?: string; days?: string; format: ExportFormat }> = [];

const tenantSource: TenantExportSource = {
  id: 'test.tenant',
  label: 'Tenant test',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  formats: ['csv', 'json'],
  async load(ctx, format) {
    seen.push({ tenantId: ctx.tenantId, year: ctx.param('year'), days: ctx.param('days'), format });
    return { filename: `report-${ctx.param('year') ?? 'x'}`, table: { columns: ['a'], rows: [[1]] }, json: { ok: true } };
  },
};

const premiumSource: TenantExportSource = { ...tenantSource, id: 'test.premium', planFeature: 'advancedInsights' };

const platformSource: PlatformExportSource = {
  id: 'test.platform',
  label: 'Platform test',
  scope: 'platform',
  formats: ['csv'],
  async load() {
    return { filename: 'ops', table: { columns: ['b'], rows: [[2]] } };
  },
};

/** A router that authenticated the caller as `role` — the adapter's precondition. */
function app(role: string, mount: (r: Hono<HonoEnv>) => void) {
  const r = new Hono<HonoEnv>();
  r.use('*', async (c, next) => {
    c.set('tenantId', 7);
    c.set('segmentId', 'seg');
    c.set('role', role as never);
    c.set('db', {} as never);
    await next();
  });
  r.onError((err, c) => c.json({ error: err.name }, err.name === 'ForbiddenError' ? 403 : 500));
  mount(r);
  return r;
}

describe('exportSourceHandler — one adapter for every historical export path', () => {
  it('serves a tenant source with route params winning over the query string', async () => {
    seen.length = 0;
    const res = await app('manager', (r) => r.get('/report/:year/csv', exportSourceHandler(tenantSource)))
      .request('/report/2025/csv?days=90&year=1999', {}, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="report-2025.csv"');
    expect(seen).toEqual([{ tenantId: 7, year: '2025', days: '90', format: 'csv' }]);
  });

  it('honours ?format= within the declared set', async () => {
    const res = await app('owner', (r) => r.get('/x', exportSourceHandler(tenantSource))).request('/x?format=json', {}, {});
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses a caller below the source’s declared role, before loading anything', async () => {
    seen.length = 0;
    const res = await app('developer', (r) => r.get('/x', exportSourceHandler(tenantSource))).request('/x', {}, {});
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('applies the declared plan feature and returns its 402 unchanged', async () => {
    seen.length = 0;
    planGate.mockResolvedValueOnce(new Response('upgrade', { status: 402 }));
    const res = await app('manager', (r) => r.get('/x', exportSourceHandler(premiumSource))).request('/x', {}, {});
    expect(res.status).toBe(402);
    expect(planGate).toHaveBeenLastCalledWith(expect.anything(), 'advancedInsights');
    expect(seen).toHaveLength(0);
  });

  it('serves a platform source without a tenant role check (its router holds the superadmin gate)', async () => {
    const res = await app('viewer', (r) => r.get('/ops', exportSourceHandler(platformSource))).request('/ops', {}, {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('"b"\n"2"');
  });
});
