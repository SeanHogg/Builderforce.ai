/**
 * The public salary guide — `/salary`, `/salary/:role`, `/salary/:role/:city`.
 *
 * Entirely public and entirely cached, which is the opposite call from
 * `/api/tools/:id/analyze` and for the opposite reason: this keyspace is BOUNDED
 * (sixteen roles × fourteen cities, both declared as data in `salaryDirectory.ts`)
 * and the answer changes only when the compensation anchors do.
 *
 * The caching itself is NOT here. `application/career/salaryGuides.ts` owns it,
 * because a route reaching into `infrastructure/` is the layering violation this
 * file used to be — and because the TTL belongs next to the data whose half-life
 * justifies it, not next to the URL that happens to read it.
 *
 * No tenant data is read, so there is nothing to scope and nothing to leak.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import {
  readSalaryCityGuide,
  readSalaryDirectory,
  readSalaryRoleGuide,
} from '../../application/career/salaryGuides';

export function createSalaryRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // The index — every published address, for the hub page and the sitemap.
  router.get('/', async (c) => c.json(await readSalaryDirectory(c.env as Env)));

  router.get('/:role', async (c) => {
    const guide = await readSalaryRoleGuide(c.env as Env, c.req.param('role'));
    return guide ? c.json({ guide }) : c.json({ error: 'Unknown role' }, 404);
  });

  router.get('/:role/:city', async (c) => {
    const guide = await readSalaryCityGuide(c.env as Env, c.req.param('role'), c.req.param('city'));
    return guide ? c.json({ guide }) : c.json({ error: 'Unknown role or city' }, 404);
  });

  return router;
}
