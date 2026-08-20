/**
 * Dispute + mediation routes — `/api/disputes`.
 *
 * The CLIENT's and the MEDIATOR's half of `application/marketplace/disputes.ts`. The
 * freelancer's half lives on `/api/engagements/mine/disputes` under the web JWT, because
 * a for-hire account belongs to no workspace and has no tenant token to present.
 *
 * That split is the same one every escrow route draws and it is load-bearing here: it is
 * what makes "either party may raise a dispute" structural rather than a role check.
 * Each door authenticates a different subject and supplies its OWN `party` to the
 * application layer — neither ever reads a party off the request body, which is the one
 * way a freelancer could file as the client or the reverse.
 *
 * This file is a presentation adapter and holds no data access: every handler resolves
 * the caller's authority and calls the application layer, which owns the tables.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import {
  assignMediator,
  fileDisputeStatement,
  isDisputeOutcome,
  listTenantDisputes,
  resolveMediatorAuthority,
  openDisputeCount,
  readDispute,
  resolveDispute,
  withdrawDispute,
  type DisputeRefusal,
} from '../../application/marketplace/disputes';

/**
 * A dispute refusal as an HTTP answer.
 *
 * The SAME mapping `freelancerRoutes` uses, and deliberately so: `DisputeRefusal`
 * extends `EscrowRefusal`, so both doors onto the same machine must translate the same
 * code to the same status. A caller that got 409 from one and 400 from the other would
 * be looking at one subsystem with two error contracts.
 */
function refusalStatus(reason: DisputeRefusal): 400 | 403 | 404 | 409 {
  if (reason === 'not_found') return 404;
  if (reason === 'wrong_party' || reason === 'not_mediator') return 403;
  if (reason === 'wrong_status' || reason === 'conflict'
    || reason === 'already_disputed' || reason === 'already_closed'
    || reason === 'not_disputed') return 409;
  return 400;
}

export function createDisputeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * WHO MAY RULE, resolved once per request.
   *
   * A platform superadmin is the only genuinely neutral mediator this product has —
   * both parties to an escrow dispute sit inside the engagement, and the client IS the
   * workspace, so no workspace role can be a third party to its own dispute. The
   * workspace OWNER is allowed as a fallback because a self-hosted deployment has no
   * platform operator at all and a dispute with no possible resolver is worse than one
   * ruled by an interested party — but the authority is RECORDED on the row, so the
   * freelancer can see which kind of mediator ruled rather than being shown one word
   * that means two very different things.
   */
  const authorityFor = async (c: Context<HonoEnv>) =>
    resolveMediatorAuthority(
      c.env as Env,
      c.get('role') as string | undefined,
      c.get('userId') as string,
    );

  const disputeIdOf = (raw: string): number | null => {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  /** GET / — this workspace's dispute queue, plus how many are still waiting. */
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [disputes, openCount, authority] = await Promise.all([
      listTenantDisputes(db, c.env as Env, tenantId, Number(c.req.query('limit') ?? 100)),
      openDisputeCount(db, tenantId),
      authorityFor(c),
    ]);
    // The surface renders the mediator controls off this rather than guessing from a
    // role, for the same reason a milestone's `actions` are projected by the server: a
    // second copy of the authority rule in the browser is a second place it can drift.
    return c.json({ disputes, openCount, mediatorAuthority: authority });
  });

  /** GET /:id — one dispute with both sides' filings. */
  router.get('/:id', async (c) => {
    const id = disputeIdOf(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    const [dispute, authority] = await Promise.all([
      readDispute(db, c.env as Env, c.get('tenantId') as number, id),
      authorityFor(c),
    ]);
    return dispute
      ? c.json({ dispute, mediatorAuthority: authority })
      : c.json({ error: 'not_found' }, 404);
  });

  /** POST /:id/statement — the CLIENT files (or revises) their position. */
  router.post('/:id/statement', async (c) => {
    const id = disputeIdOf(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.json<{ position?: string; evidence?: unknown; asMediator?: boolean }>()
      .catch(() => ({} as { position?: string; evidence?: unknown; asMediator?: boolean }));
    const position = String(body.position ?? '').trim();
    if (!position) return c.json({ error: 'position is required' }, 400);

    // A mediator's reasoning is a filing like any other, but claiming to be one is not
    // something a request body may assert: the authority is re-derived here and a caller
    // without it files as the client, which is what they are.
    const authority = body.asMediator === true ? await authorityFor(c) : 'none';
    const party = authority !== 'none' ? 'mediator' : 'client';

    const result = await fileDisputeStatement(c.env as Env, db, {
      tenantId: c.get('tenantId') as number,
      disputeId: id,
      party,
      authorRef: c.get('userId') as string,
      position,
      evidence: body.evidence,
    });
    return result.ok
      ? c.json({ dispute: result.dispute })
      : c.json({ error: result.reason }, refusalStatus(result.reason));
  });

  /** POST /:id/mediate — take the dispute into mediation. */
  router.post('/:id/mediate', async (c) => {
    const id = disputeIdOf(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    const result = await assignMediator(c.env as Env, db, {
      tenantId: c.get('tenantId') as number,
      disputeId: id,
      mediatorUserId: c.get('userId') as string,
      authority: await authorityFor(c),
    });
    return result.ok
      ? c.json({ dispute: result.dispute })
      : c.json({ error: result.reason }, refusalStatus(result.reason));
  });

  /**
   * POST /:id/resolve — the RULING.
   *
   * `outcome` is validated against the closed set before it reaches the application
   * layer, so an unknown word is a 400 here rather than a `switch` fall-through
   * somewhere that moves money. `splitFreelancerCents` is the freelancer's share only;
   * the client's is the remainder, computed by `awardFor` — two independently supplied
   * halves are two numbers that can fail to add up, and the pot they must add up to is
   * somebody's held money.
   */
  router.post('/:id/resolve', async (c) => {
    const id = disputeIdOf(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.json<{ outcome?: unknown; splitFreelancerCents?: unknown; resolution?: unknown }>()
      .catch(() => ({} as Record<string, unknown>));
    if (!isDisputeOutcome(body.outcome)) return c.json({ error: 'unknown_outcome' }, 400);

    const result = await resolveDispute(c.env as Env, db, {
      tenantId: c.get('tenantId') as number,
      disputeId: id,
      mediatorUserId: c.get('userId') as string,
      authority: await authorityFor(c),
      outcome: body.outcome,
      splitFreelancerCents: typeof body.splitFreelancerCents === 'number' ? body.splitFreelancerCents : null,
      resolution: typeof body.resolution === 'string' ? body.resolution : null,
    });
    return result.ok
      // `settlement: 'manual'` on the returned dispute is not an error — the ledger is
      // correct either way and the surface says the transfer is pending an operator.
      ? c.json({ dispute: result.dispute })
      : c.json({ error: result.reason }, refusalStatus(result.reason));
  });

  /** POST /:id/withdraw — the CLIENT calls off a dispute they raised. The application
   *  layer refuses one raised by the other side, in the predicate rather than after it. */
  router.post('/:id/withdraw', async (c) => {
    const id = disputeIdOf(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    const result = await withdrawDispute(c.env as Env, db, {
      tenantId: c.get('tenantId') as number,
      disputeId: id,
      actorUserId: c.get('userId') as string,
    });
    return result.ok
      ? c.json({ dispute: result.dispute })
      : c.json({ error: result.reason }, refusalStatus(result.reason));
  });

  return router;
}
