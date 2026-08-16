/**
 * `GET /projects/:id/site` — the shape that crosses the wire.
 *
 * `project_sites.total_bytes` is an int8, read with a `::text` cast because
 * Drizzle's bigint mapper is the thing that would truncate it. The route then
 * used to pass that STRING straight out, against a client type
 * (`frontend/src/lib/api.ts` `SiteInfo.totalBytes`) that declares `number`. So
 * every consumer was doing arithmetic on a string: nothing looked broken,
 * because `formatBytes('1048576')` happens to coerce — and the next
 * `totalBytes + x` would have concatenated instead of adding.
 *
 * The cast stays (it is what keeps the precision); the coercion happens once, at
 * the route boundary, exactly as `siteReleases.listReleases` already does.
 */
import { describe, expect, it, vi } from 'vitest';

const TENANT = 77;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('userId', 'user-abc');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const db = vi.hoisted(() => ({ answers: [] as unknown[][] }));

vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: () => ({
    // Every read on this path is the same `select().from().where().limit()`
    // chain, so the fake answers them in call order: the tenant gate first, the
    // site row second.
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => db.answers.shift() ?? [] }),
      }),
    }),
  }),
}));

const { createIdeRoutes } = await import('./ideRoutes');

const siteRow = (totalBytes: string | null) => ({
  subdomain: 'sunday-rsvp',
  mode: 'static',
  status: 'active',
  version_token: 'v7',
  asset_count: 12,
  total_bytes: totalBytes,
  published_at: null,
});

async function readSite(row: Record<string, unknown> | null) {
  db.answers = [[{ present: 1 }], row ? [row] : []];
  const res = await createIdeRoutes().request('/projects/42/site', {}, {});
  return { status: res.status, body: (await res.json()) as { site: Record<string, unknown> | null } };
}

describe('GET /projects/:id/site', () => {
  it('answers with totalBytes as a NUMBER, not the text the column was read as', async () => {
    const { status, body } = await readSite(siteRow('1048576'));
    expect(status).toBe(200);
    expect(body.site?.totalBytes).toBe(1_048_576);
    expect(typeof body.site?.totalBytes).toBe('number');
    // The failure this exists to stop.
    expect((body.site?.totalBytes as number) + 1).toBe(1_048_577);
  });

  it('reports a site with nothing published as zero rather than null', async () => {
    const { body } = await readSite(siteRow(null));
    expect(body.site?.totalBytes).toBe(0);
  });

  it('still answers site: null for a project that was never published', async () => {
    const { body } = await readSite(null);
    expect(body.site).toBeNull();
  });
});
