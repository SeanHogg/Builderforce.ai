/**
 * The INVITEE's half of a canvas invite link — including the person who does not want
 * an account.
 *
 * ── WHY THREE ROUTES AND NOT ONE ─────────────────────────────────────────────────
 * They differ in what proves who is calling, and an endpoint with two auth stories is
 * an endpoint where one of them is eventually forgotten:
 *
 *   GET  /:token           — nobody is authenticated. Describes the invitation so the
 *                            landing page can say what is being offered BEFORE asking
 *                            for a decision. Spends no use of the link.
 *   POST /:token/guest     — nobody is authenticated, and they have declined to be.
 *                            A passwordless identity is minted and a real session
 *                            issued for it.
 *   POST /:token/account   — a web session already exists. The link seats THAT person;
 *                            nothing is minted.
 *
 * ── WHY THE GUEST GETS A REAL SESSION ────────────────────────────────────────────
 * Because a durable canvas resolves through workspace membership and a user id, and
 * ~60 canvas endpoints already agree on that. Teaching every one of them a second
 * anonymous credential is the change where one endpoint does not learn. See
 * `application/creation/canvasGuestAccount.ts` for what that identity is and what it
 * costs the workspace (nothing billable — a collaborator, not a seat).
 *
 * ── WHAT STOPS A LEAKED LINK ─────────────────────────────────────────────────────
 * Three brakes, and all three are needed, because this is the one route in the product
 * where an unauthenticated caller causes a `users` row to exist: the link's own
 * `maxUses` and expiry (set by whoever minted it), the plan's collaborator cap (checked
 * before a use is spent, so a refusal does not burn the link), and the `/api/*` rate
 * limiter the app already applies — which is why this module adds no limiter of its
 * own. A second `rateLimitMiddleware` on the route would be a duplicate budget, not a
 * stricter one.
 */

import { Hono, type Context } from 'hono';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { parseBody, z } from './requestBody';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import {
  CANVAS_LINK_TOKEN_RE,
  claimCanvasInviteLink,
  previewCanvasInviteLink,
  type CanvasLinkClaim,
  type CanvasLinkClaimant,
} from '../../application/creation/canvasInviteLinks';
import {
  GUEST_ACCOUNT_TYPE,
  cleanGuestName,
  issueGuestSession,
} from '../../application/creation/canvasGuestAccount';
import { collaboratorLimitForTenant } from '../../application/creation/canvasCollaboratorCapacity';

/** Optional and unbounded HERE, because `cleanGuestName` is the one place that trims,
 *  collapses and caps it — a second length rule in a schema is a second answer. */
const GuestJoinBody = z.object({ displayName: z.string().optional() });

export function createCanvasJoinRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** One shaping of a claim into a response, so the guest and account paths cannot
   *  disagree about what a successful join looks like. */
  function claimResponse(claim: Extract<CanvasLinkClaim, { ok: true }>) {
    return {
      sessionId: claim.target.sessionId,
      tenantId: claim.target.tenantId,
      title: claim.target.title,
      role: claim.target.role,
      alreadyMember: claim.alreadyMember,
    };
  }

  /** ONE wording for a link that cannot be taken. A dead link, a revoked link and an
   *  exhausted one are deliberately indistinguishable: telling a holder WHICH is telling
   *  them whether the board exists. */
  const dead = (c: Context<HonoEnv>) =>
    c.json({ error: 'This invitation link is invalid, expired, or has been revoked' }, 410);

  async function claim(c: Context<HonoEnv>, claimant: CanvasLinkClaimant) {
    const token = c.req.param('token') ?? '';
    if (!CANVAS_LINK_TOKEN_RE.test(token)) return { failed: c.json({ error: 'Invalid invitation link' }, 400) } as const;
    const target = await previewCanvasInviteLink(db, c.env as Env, token);
    if (!target) return { failed: dead(c) } as const;
    const result = await claimCanvasInviteLink(db, c.env as Env, {
      token,
      claimant,
      collaboratorLimit: await collaboratorLimitForTenant(c.env as Env, target.tenantId, db),
    });
    if (!result.ok) {
      return result.reason === 'capacity'
        ? { failed: c.json(result.refusal, 403) } as const
        : { failed: dead(c) } as const;
    }
    return { failed: null, result } as const;
  }

  /** What this link offers. Public, and deliberately narrow: a board's TITLE and the
   *  access on offer, never its contents — an unclaimed link must not be a read of the
   *  canvas it points at. */
  router.get('/:token', async (c) => {
    const token = c.req.param('token') ?? '';
    if (!CANVAS_LINK_TOKEN_RE.test(token)) return c.json({ error: 'Invalid invitation link' }, 400);
    const target = await previewCanvasInviteLink(db, c.env as Env, token);
    if (!target) return dead(c);
    return c.json({ title: target.title, role: target.role });
  });

  router.post('/:token/guest', async (c) => {
    const body = await parseBody(c, GuestJoinBody);
    const outcome = await claim(c, { kind: 'guest', displayName: cleanGuestName(body.displayName) });
    if (outcome.failed) return outcome.failed;
    const guest = outcome.result.guest;
    if (!guest) return dead(c);
    const token = await issueGuestSession(db, (c.env as Env).JWT_SECRET, guest, {
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.json({
      ...claimResponse(outcome.result),
      token,
      user: {
        id: guest.id,
        email: guest.email,
        name: guest.name,
        accountType: GUEST_ACCOUNT_TYPE,
        accountTypeSelected: true,
        hasPassword: false,
      },
    }, 201);
  });

  router.post('/:token/account', webAuthMiddleware, async (c) => {
    const outcome = await claim(c, { kind: 'user', userId: c.get('userId') as string });
    if (outcome.failed) return outcome.failed;
    return c.json(claimResponse(outcome.result));
  });

  return router;
}
