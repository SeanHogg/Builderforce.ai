/**
 * Job distribution (FO-B4) — mounted by `atsRoutes.ts` under /api/ats/postings.
 *
 *   GET  /:postingId/distributions — where the posting is published (as each board
 *                                    confirmed it) and the connected boards it could
 *                                    go to next
 *   POST /:postingId/distributions — publish it to the chosen boards and answer with
 *                                    each board's verdict and the posting's whole list
 *
 * Its own module rather than more of `atsRoutes.ts`, which is the working surface's
 * index of a dozen resources: distribution is one resource with one use case
 * (`application/hiring/distributePosting.ts`), and a route file that only ever grows
 * is how `jobRoutes.ts` reached 1,300 lines. Thin, like its parent: a shape check and
 * an application call, with `AtsError` carrying the status to the global handler.
 *
 * THE GATE. Reading is DEVELOPER, like every ATS read. Publishing is MANAGER — it puts
 * the workspace's name on a public job board, the same accountable, outbound act as
 * creating the requisition (`POST /postings`) and sending an offer.
 *
 * Authentication is the parent's `authMiddleware`, applied to every route it mounts.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { TenantRole } from '../../domain/shared/types';
import { requireRole } from '../middleware/authMiddleware';
import { requireTenantId } from '../middleware/tenantContext';
import {
  distributePosting,
  MAX_BOARDS_PER_DISTRIBUTION,
  readPostingDistribution,
} from '../../application/hiring/distributePosting';
import { parseBody, z, zNonEmptyString } from './requestBody';

/** A card-held listing fact: absent, cleared (`null`), or text. */
const zListingText = z.string().trim().max(500).nullable().optional();

const DistributeBody = z.object({
  connectorKeys: z.array(zNonEmptyString).min(1).max(MAX_BOARDS_PER_DISTRIBUTION),
  listing: z.object({
    location: zListingText,
    employmentType: zListingText,
    seniority: zListingText,
    remote: z.boolean().nullable().optional(),
    applyUrl: z.string().trim().url().max(1000).nullable().optional(),
  }).optional(),
});

export function createPostingDistributionRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.get('/:postingId/distributions', requireRole(TenantRole.DEVELOPER), async (c) => c.json(
    await readPostingDistribution(db, c.env as Env, requireTenantId(c), c.req.param('postingId')),
  ));

  r.post('/:postingId/distributions', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await parseBody(c, DistributeBody);
    return c.json(await distributePosting(db, c.env as Env, {
      tenantId: requireTenantId(c),
      postingId: c.req.param('postingId'),
      connectorKeys: input.connectorKeys,
      ...(input.listing ? { listing: input.listing } : {}),
    }));
  });

  return r;
}
