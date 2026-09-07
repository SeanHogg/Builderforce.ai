/**
 * The OWNER's half of a canvas invite link: mint, list, revoke.
 *
 * Mounted on `/api/creation-sessions` beside the email-invite routes but kept in its
 * own module rather than added to `creationSessionRouteService.ts` — that file is
 * already the place every canvas feature has been appended to, and link sharing is a
 * separate reason to change. Everything it needs is a port (`canvasInviteLinks.ts`)
 * that other callers read too, so nothing here is a second copy of a rule — including
 * "may this person share this board", which is `ownedCanvasSession` and not a query
 * of its own.
 *
 * OWNER-GATED, like the email invite: minting a link is giving access away, and unlike
 * an addressed invitation a link can be forwarded by whoever holds it.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { parseBody, z } from './requestBody';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import {
  CANVAS_LINK_ROLES,
  listCanvasInviteLinks,
  mintCanvasInviteLink,
  ownedCanvasSession,
  revokeCanvasInviteLink,
} from '../../application/creation/canvasInviteLinks';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The role is `z.enum(CANVAS_LINK_ROLES)` and not a hand-written union, so the one list
 * that says what a URL may carry is the one the API validates against: adding a fourth
 * role to the port cannot leave this route refusing it, and removing one cannot leave
 * this route still accepting it.
 */
const MintBody = z.object({
  role: z.enum(CANVAS_LINK_ROLES).default('editor'),
  /** Hours until the link stops working. Omit for a link that does not expire. */
  expiresInHours: z.number().int().positive().nullish(),
  /** How many people may take it. Omit for "anyone with this link". */
  maxUses: z.number().int().positive().nullish(),
});

export function createCanvasInviteLinkRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const shareableSession = (c: Context<HonoEnv>) => {
    const sessionId = c.req.param('id') ?? '';
    if (!UUID_RE.test(sessionId)) return Promise.resolve(null);
    return ownedCanvasSession(db, {
      sessionId,
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
    });
  };

  router.get('/:id/invite-links', async (c) => {
    const session = await shareableSession(c);
    if (!session) return c.json({ error: 'Session not found or not shareable' }, 404);
    return c.json({ links: await listCanvasInviteLinks(db, c.env as Env, session) });
  });

  router.post('/:id/invite-links', async (c) => {
    const session = await shareableSession(c);
    if (!session) return c.json({ error: 'Session not found or not shareable' }, 404);
    const body = await parseBody(c, MintBody);
    const link = await mintCanvasInviteLink(db, c.env as Env, {
      session,
      role: body.role,
      createdBy: c.get('userId') as string,
      expiresInHours: body.expiresInHours ?? null,
      maxUses: body.maxUses ?? null,
    });
    return c.json(link, 201);
  });

  router.delete('/:id/invite-links/:linkId', async (c) => {
    const session = await shareableSession(c);
    if (!session) return c.json({ error: 'Session not found or not shareable' }, 404);
    const linkId = c.req.param('linkId');
    if (!UUID_RE.test(linkId)) return c.json({ error: 'Invalid link id' }, 400);
    const revoked = await revokeCanvasInviteLink(db, c.env as Env, session, linkId);
    if (!revoked) return c.json({ error: 'Link not found' }, 404);
    return c.body(null, 204);
  });

  return router;
}
