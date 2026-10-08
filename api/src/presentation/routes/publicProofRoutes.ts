/**
 * `GET /api/public/proof` — live platform counts for marketing social proof.
 * Public and uncredentialed by design; served from a one-hour cache
 * (`application/marketing/platformProof.ts`).
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { loadPlatformProof } from '../../application/marketing/platformProof';

export function createPublicProofRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.get('/', async (c) => {
    const proof = await loadPlatformProof(db, c.env);
    c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return c.json(proof);
  });
  return router;
}
