/**
 * The public startup directory — `/api/public/startups` (PRD 19 B2).
 *
 *   GET  /                 one page of listed companies, filtered      anyone
 *   GET  /:slug            one company's public profile               anyone
 *   POST /:slug/inquiries  express interest (writes the founder's deal flow)   anyone
 *
 * No session, because the visitor a directory exists to convert has none — the
 * same shape the web surface, prospect and form public routes draw. A bearer
 * token, when present, is READ (`optionalWebUserId`) to widen the profile to the
 * `member` tier; it never gates the read.
 *
 * Every rule — what a stranger may see, what an inquiry must carry, whether a
 * company is taking inquiries — is enforced in `startupDirectory.ts`. This file
 * translates HTTP.
 */

import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { optionalWebUserId } from '../middleware/webAuthMiddleware';
import { CompanyError } from '../../application/investor/companyWorkspace';
import { RevenueIntelError } from '../../application/sales/revenueIntelligence';
import {
  browseStartups,
  parseDirectoryFilters,
  startupBySlug,
  submitInvestorInquiry,
} from '../../application/investor/startupDirectory';
import { parseBody, z } from './requestBody';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CompanyError || error instanceof RevenueIntelError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const zInquiry = z.object({
  investorName: z.string().trim().min(1).max(160),
  investorEmail: z.string().trim().min(3).max(320),
  investorCompany: z.string().trim().max(255).nullish(),
  investorTitle: z.string().trim().max(160).nullish(),
  investorPhone: z.string().trim().max(40).nullish(),
  interestedAmount: z.number().nonnegative().nullish(),
  investmentType: z.string().trim().max(32).nullish(),
  timeframe: z.string().trim().max(32).nullish(),
  isAccredited: z.boolean().optional(),
  areasOfExpertise: z.array(z.string().trim().max(40)).max(10).optional(),
  investmentHistory: z.string().trim().max(2000).nullish(),
  message: z.string().trim().min(1).max(4000),
});

export function createPublicStartupRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', (c) => handle(async () => {
    const filters = parseDirectoryFilters(new URL(c.req.url).searchParams);
    return Response.json(await browseStartups(db, c.env as Env, filters));
  }));

  router.get('/:slug', (c) => handle(async () => {
    const viewer = (await optionalWebUserId(c)) ? 'member' : 'public';
    const profile = await startupBySlug(db, c.env as Env, c.req.param('slug'), viewer);
    if (!profile) return Response.json({ error: 'That company is not listed.' }, { status: 404 });
    return Response.json({ startup: profile });
  }));

  router.post('/:slug/inquiries', (c) => handle(async () => {
    const body = await parseBody(c, zInquiry);
    const receipt = await submitInvestorInquiry(db, c.env as Env, c.req.param('slug'), body);
    return Response.json({ inquiry: receipt }, { status: 201 });
  }));

  return router;
}
