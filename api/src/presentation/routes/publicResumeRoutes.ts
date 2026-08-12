import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { PublicResumeProjection } from '../../application/creation/publicResumeProjection';

export function createPublicResumeRoutes(resolve: (token: string) => Promise<PublicResumeProjection | null>): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.get('/:token', async (c) => {
    const resume = await resolve(c.req.param('token'));
    return resume ? c.json({ resume }) : c.json({ error: 'Resume not found' }, 404);
  });
  return router;
}
