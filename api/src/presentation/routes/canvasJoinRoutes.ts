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
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { mintWebSessionToken } from '../../infrastructure/auth/webSessionToken';
import {
  CANVAS_LINK_TOKEN_RE,
  claimCanvasInviteLink,
  previewCanvasInviteLink,
  type CanvasLinkClaim,
  type CanvasLinkClaimant,
} from '../../application/creation/canvasInviteLinks';
import { cleanGuestName, GUEST_ACCOUNT_TYPE } from '../../application/creation/canvasGuestAccount';
import { collaboratorLimitForTenant } from '../../application/creation/canvasCollaboratorCapacity';

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

  async function claim(
    c: Context<HonoEnv>,
    claimant: CanvasLinkClaimant,
  ) {
    const token = c.req.param('token') ?? '';
    if (!CANVAS_LINK_TOKEN_RE.test(token)) return { failed: c.json({ error: 'Invalid invitation link' }, 400) } as const;
    const target = await previewCanvasInviteLink(db, c.env as Env, token);
    if (!target) return { failed: c.json({ error: 'This invitation link is invalid, expired, or has been revoked' }, 410) } as const;
    const result = await claimCanvasInviteLink(db, c.env as Env, {
      token,
      claimant,
      collaboratorLimit: await collaboratorLimitForTenant(c.env as Env, target.tenantId, db),
    });
    if (!result.ok) {
      return result.reason === 'capacity'
        ? { failed: c.json(result.refusal, 403) } as const
        : { failed: c.json({ error: 'This invitation link is invalid, expired, or has been revoked' }, 410) } as const;
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
    if (!target) return c.json({ error: 'This invitation link is invalid, expired, or has been revoked' }, 410);
    return c.json({ title: target.title, role: target.role });
  });

  router.post('/:token/guest', async (c) => {
    const body = await c.req.json<{ displayName?: unknown }>().catch(() => ({} as { displayName?: unknown }));
    const outcome = await claim(c, { kind: 'guest', displayName: cleanGuestName(body.displayName) });
    if (outcome.failed) return outcome.failed;
    const guest = outcome.result.guest;
    if (!guest) return c.json({ error: 'This invitation link is invalid, expired, or has been revoked' }, 410);
    const { token: webToken } = await mintWebSessionToken(db, (c.env as Env).JWT_SECRET, {
      userId: guest.id,
      email: guest.email,
      username: guest.id,
      sessionName: 'Canvas guest',
      userAgent: c.req.header('user-agent') ?? null,
      // Thirty days, not the usual day. A guest has no password to sign back in with,
      // so an expired token is not an inconvenience — it is the permanent loss of the
      // only identity that holds their work on the board.
      expiresIn: 30 * 86_400,
    });
    return c.json({
      ...claimResponse(outcome.result),
      token: webToken,
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
