/**
 * Dashboards CRUD lives at `/api/dashboards` and `/api/dashboards/:id`. The old
 * stuttered `/api/dashboards/dashboards/*` is the SAME sub-router, stamped
 * deprecated with the concrete de-stuttered successor.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', 2); c.set('segmentId', 'seg'); c.set('role', 'manager'); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { Hono } from 'hono';
import { createDashboardsRoutes } from './dashboardsRoutes';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

function app(db: ReturnType<typeof fakeDb>) {
  const root = new Hono();
  root.route('/api/dashboards', createDashboardsRoutes(db as unknown as Db));
  return root;
}

describe('dashboards CRUD paths', () => {
  it('lists at the canonical /api/dashboards without deprecation headers', async () => {
    const res = await app(fakeDb([[]])).request('/api/dashboards');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dashboards: [] });
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('lists at the stuttered alias from the same handler', async () => {
    const res = await app(fakeDb([[]])).request('/api/dashboards/dashboards');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dashboards: [] });
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/dashboards>; rel="successor-version"');
  });

  it('names the de-stuttered :id successor on a nested alias path', async () => {
    const res = await app(fakeDb([[]])).request('/api/dashboards/dashboards/5/data');
    expect(res.headers.get('Link')).toBe('</api/dashboards/5/data>; rel="successor-version"');
  });

  it('keeps the metric catalogue on its own path', async () => {
    const res = await app(fakeDb([])).request('/api/dashboards/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('Deprecation')).toBeNull();
  });
});
