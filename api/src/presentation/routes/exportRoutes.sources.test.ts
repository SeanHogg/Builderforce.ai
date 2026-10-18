import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 5);
    c.set('segmentId', 'seg');
    c.set('role', 'developer');
    await next();
  },
}));
// The operator gate: refuse, so the test proves platform sources go through it.
vi.mock('../middleware/superAdminMiddleware', () => ({
  superAdminMiddleware: async (c: any) => c.json({ error: 'Superadmin access required' }, 403),
}));

import { createExportRoutes } from './exportRoutes';

describe('/api/exports/sources — the generic export door', () => {
  it('lists only the tenant sources the caller’s role may pull — never the operator ones', async () => {
    const res = await createExportRoutes().request('/sources', {}, {});
    expect(res.status).toBe(200);
    const { sources } = await res.json() as { sources: Array<{ id: string; formats: string[] }> };
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('pmo.capex-opex');          // any member
    expect(ids).toContain('governance.soc2-evidence'); // any member
    expect(ids).not.toContain('members.metrics');      // manager+
    expect(ids.some((id) => id.startsWith('admin.'))).toBe(false);
  });

  it('404s an unknown source', async () => {
    const res = await createExportRoutes().request('/sources/nope.nothing', {}, {});
    expect(res.status).toBe(404);
  });

  it('puts a platform source behind the superadmin gate, not the tenant session', async () => {
    const res = await createExportRoutes().request('/sources/admin.audit-log', {}, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Superadmin access required' });
  });
});
