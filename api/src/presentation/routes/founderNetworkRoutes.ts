/**
 * The founder's own network and outbound — `/api/cofounder`, `/api/pipeline`,
 * `/api/investor-updates`.
 *
 * Three small routers over three application services, in one module because
 * each is a handful of endpoints over an engine that already holds every rule,
 * and three near-empty files would be three places to look for the same shape.
 * They mount separately, so nothing about the grouping is load-bearing.
 *
 * Every one of them exists because the register found the same defect three
 * times: an act the canvas advertises, with no delivery behind it.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  CofounderError,
  discoverCofounders,
  myCofounderProfile,
  requestIntroduction,
  respondToIntroduction,
  upsertCofounderProfile,
} from '../../application/legal/cofounderMatching';
import { PipelineError, moveDeal, project } from '../../application/revenue/pipelineProjection';
import { InvestorUpdateError, sendInvestorUpdate } from '../../application/investor/investorUpdateDelivery';

/** One translation for all three, keyed on the error type each service throws —
 *  so a new endpoint cannot invent a different code for the same rejection. */
const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CofounderError || error instanceof PipelineError || error instanceof InvestorUpdateError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;
const actor = (c: Context<HonoEnv>) => String(c.get('userId') ?? '');

// ---------------------------------------------------------------------------
// Co-founder matching
// ---------------------------------------------------------------------------

export function createCofounderRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/profile', (c) => handle(async () =>
    Response.json({ profile: await myCofounderProfile(db, tenant(c), actor(c)) })));

  router.put('/profile', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await upsertCofounderProfile(db, tenant(c), actor(c), {
      headline: String(body.headline ?? ''),
      bio: typeof body.bio === 'string' ? body.bio : null,
      strength: String(body.strength ?? ''),
      seeking: String(body.seeking ?? ''),
      brings: body.brings,
      needs: body.needs,
      ...(typeof body.commitment === 'string' ? { commitment: body.commitment } : {}),
      equityExpectation: Number.isFinite(body.equityExpectation) ? Number(body.equityExpectation) : null,
      location: typeof body.location === 'string' ? body.location : null,
      remoteOk: body.remoteOk !== false,
      sectors: body.sectors,
      stage: typeof body.stage === 'string' ? body.stage : null,
      ...(typeof body.visibility === 'string' ? { visibility: body.visibility } : {}),
      ...(typeof body.status === 'string' ? { status: body.status } : {}),
    });
    return Response.json(result);
  }));

  /** The ranking, with its reasons. Never a "match" — see the engine's note on
   *  why the scorer ranks, a human asks, and the other human answers. */
  router.get('/matches', (c) => handle(async () =>
    Response.json(await discoverCofounders(db, tenant(c), actor(c)))));

  router.post('/introductions', (c) => handle(async () => {
    const body = await c.req.json<{ toProfileId?: unknown; message?: unknown }>();
    const result = await requestIntroduction(db, tenant(c), actor(c), Number(body.toProfileId), String(body.message ?? ''));
    return Response.json(result);
  }));

  router.post('/introductions/:id/respond', (c) => handle(async () => {
    const body = await c.req.json<{ decision?: unknown }>();
    const decision = body.decision === 'accepted' ? 'accepted' : 'declined';
    // Only the RECIPIENT may answer, enforced inside the service by matching the
    // introduction's target against the caller's own profile — not by trusting a
    // body field.
    await respondToIntroduction(db, tenant(c), actor(c), Number(c.req.param('id')), decision);
    return Response.json({ ok: true, status: decision });
  }));

  return router;
}

// ---------------------------------------------------------------------------
// The pipeline projection
// ---------------------------------------------------------------------------

export function createPipelineRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** The two query parameters, narrowed once. `laneBy` is a closed set, so an
   *  unrecognised value falls back to the default rather than reaching the
   *  service as a string it would have to re-validate. */
  const options = (c: Context<HonoEnv>): { pipelineRef: string | null; laneBy?: 'source' | 'owner' | 'none' } => {
    const raw = c.req.query('laneBy');
    const laneBy = raw === 'owner' || raw === 'none' || raw === 'source' ? raw : undefined;
    return { pipelineRef: c.req.query('pipelineRef') ?? null, ...(laneBy ? { laneBy } : {}) };
  };

  /** The board, read from the deals. The canvas object is overwritten from this,
   *  which is what makes it a projection rather than a second copy. */
  router.get('/', (c) => handle(async () =>
    Response.json({ pipeline: await project(db, tenant(c), options(c)) })));

  /**
   * Move a deal, and get the board back in the same response.
   *
   * ONE call on purpose: the failure this whole feature removes is the second
   * write somebody forgets. There is no "now mirror it" step to skip.
   */
  router.post('/deals/:id/stage', (c) => handle(async () => {
    const body = await c.req.json<{ stage?: unknown }>();
    const pipeline = await moveDeal(db, tenant(c), Number(c.req.param('id')), String(body.stage ?? ''), options(c));
    return Response.json({ pipeline });
  }));

  return router;
}

// ---------------------------------------------------------------------------
// Investor updates
// ---------------------------------------------------------------------------

export function createInvestorUpdateRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * Send the monthly update from the board that holds the metrics it quotes.
   *
   * The transport binding is passed through untouched to `campaignTransports`,
   * which already resolves platform / connected mailbox / SendGrid and already
   * knows which failures are worth retrying. This endpoint adds an audience and a
   * renderer, not a second sender.
   */
  router.post('/send', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const content = body.content as Record<string, unknown> | undefined;
    if (!content || typeof content.title !== 'string') {
      return Response.json({ error: 'Send the update itself — at minimum a title.' }, { status: 400 });
    }
    const result = await sendInvestorUpdate(db, c.env, tenant(c), {
      content: content as never,
      recipients: Array.isArray(body.recipients)
        ? body.recipients.flatMap((r) => {
            const row = r as { email?: unknown; name?: unknown; partyRef?: unknown };
            return typeof row.email === 'string'
              ? [{ email: row.email, name: typeof row.name === 'string' ? row.name : null, partyRef: typeof row.partyRef === 'string' ? row.partyRef : null }]
              : [];
          })
        : [],
      binding: (body.binding ?? { transport: 'platform', senderIdentity: null, mailboxConnectionId: null, connectorConnectionId: null, fromName: '' }) as never,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
    });
    return Response.json(result);
  }));

  return router;
}
