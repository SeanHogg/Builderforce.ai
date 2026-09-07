/**
 * The OWNER's half of a canvas invite link: mint, list, revoke.
 *
 * Mounted on `/api/creation-sessions` beside the email-invite routes but kept in its
 * own module rather than added to `creationSessionRouteService.ts` — that file is
 * already the place every canvas feature has been appended to, and link sharing is a
 * separate reason to change. Everything it needs is a port (`canvasInviteLinks.ts`) or
 * an access check (`sessionAccess.ts`) that other callers read too, so nothing here is
 * a second copy of a rule.
 *
 * OWNER-GATED, like the email invite: minting a link is giving access away, and unlike
 * an addressed invitation a link can be forwarded by whoever holds it.
 */

import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { creationSessions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { requireSessionRole } from '../../application/creation/sessionAccess';
import {
  asCanvasLinkRole,
  listCanvasInviteLinks,
  mintCanvasInviteLink,
  revokeCanvasInviteLink,
} from '../../application/creation/canvasInviteLinks';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MintBody {
  role?: unknown;
  expiresInHours?: unknown;
  maxUses?: unknown;
}

export function createCanvasInviteLinkRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** The board, if this caller owns it. Returns the `SessionRef` the port takes —
   *  never the whole row, so a route cannot start leaking board state through a
   *  sharing endpoint. */
  async function ownedSession(c: Context<HonoEnv>) {
    const sessionId = c.req.param('id') ?? '';
    if (!UUID_RE.test(sessionId)) return null;
    const tenantId = c.get('tenantId') as number;
    const access = await requireSessionRole(db, sessionId, tenantId, c.get('userId') as string, 'owner');
    if (!access) return null;
    const [row] = await db
      .select({ id: creationSessions.id, tenantId: creationSessions.tenantId, title: creationSessions.title })
      .from(creationSessions)
      .where(scopedToTenant(creationSessions, tenantId, eq(creationSessions.id, sessionId)))
      .limit(1);
    return row ?? null;
  }

  router.get('/:id/invite-links', async (c) => {
    const session = await ownedSession(c);
    if (!session) return c.json({ error: 'Session not found or not shareable' }, 404);
    return c.json({ links: await listCanvasInviteLinks(db, c.env as Env, session) });
  });

  router.post('/:id/invite-links', async (c) => {
    const session = await ownedSession(c);
    if (!session) return c.json({ error: 'Session not found or not shareable' }, 404);
    const body = await c.req.json<MintBody>().catch(() => ({} as MintBody));
    const role = asCanvasLinkRole(body.role ?? 'editor');
    if (!role) return c.json({ error: 'A link can grant viewer, commenter or editor access' }, 400);
    const expiresInHours = body.expiresInHours == null ? null : Number(body.expiresInHours);
    if (expiresInHours != null && !Number.isFinite(expiresInHours)) return c.json({ error: 'Invalid expiry' }, 400);
    const maxUses = body.maxUses == null ? null : Number(body.maxUses);
    if (maxUses != null && !Number.isFinite(maxUses)) return c.json({ error: 'Invalid use limit' }, 400);
    const link = await mintCanvasInviteLink(db, c.env as Env, {
      session,
      role,
      createdBy: c.get('userId') as string,
      expiresInHours,
      maxUses,
    });
    return c.json(link, 201);
  });

  router.delete('/:id/invite-links/:linkId', async (c) => {
    const session = await ownedSession(c);
    if (!session) return c.json({ error: 'Session not found or not shareable' }, 404);
    const linkId = c.req.param('linkId');
    if (!UUID_RE.test(linkId)) return c.json({ error: 'Invalid link id' }, 400);
    const revoked = await revokeCanvasInviteLink(db, c.env as Env, session, linkId);
    if (!revoked) return c.json({ error: 'Link not found' }, 404);
    return c.body(null, 204);
  });

  return router;
}
