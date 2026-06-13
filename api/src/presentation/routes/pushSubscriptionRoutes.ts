/**
 * Web Push subscription routes – /api/push
 *
 * GET    /api/push/public-key    Return the VAPID public key (applicationServerKey). Public.
 * POST   /api/push/subscribe     Store/refresh this browser's push subscription (tenant JWT).
 * DELETE /api/push/subscribe     Remove this browser's subscription (tenant JWT).
 * POST   /api/push/notify-deploy Fan out a "new version" push to every subscription.
 *                                Guarded by DEPLOY_NOTIFY_SECRET — called by cf-deploy, not users.
 */
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { pushSubscriptions } from '../../infrastructure/database/schema';
import { notifyDeployCompleted } from '../../application/notifications/deployNotificationService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createPushSubscriptionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── GET /api/push/public-key ─────────────────────────────────────────────
  // The browser needs this as the applicationServerKey when it subscribes.
  // Public (no JWT) — the public key is, by definition, public.
  router.get('/public-key', (c) => {
    const key = c.env.VAPID_PUBLIC_KEY;
    if (!key) return c.json({ error: 'Push notifications are not configured' }, 503);
    return c.json({ publicKey: key });
  });

  // ── POST /api/push/subscribe ─────────────────────────────────────────────
  // Body: { endpoint, keys: { p256dh, auth } } — the shape PushSubscription.toJSON()
  // produces. Upsert on endpoint so a re-subscribe from the same browser refreshes
  // rather than duplicating.
  router.post('/subscribe', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    }>();

    const endpoint = body.endpoint;
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return c.json({ error: 'endpoint and keys.{p256dh,auth} are required' }, 400);
    }

    await db
      .insert(pushSubscriptions)
      .values({
        tenantId,
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: c.req.header('user-agent')?.slice(0, 512) ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { tenantId, userId, p256dh, auth },
      });

    return c.json({ ok: true }, 201);
  });

  // ── DELETE /api/push/subscribe ───────────────────────────────────────────
  router.delete('/subscribe', authMiddleware, async (c) => {
    const body = await c.req.json<{ endpoint?: string }>().catch(() => ({}) as { endpoint?: string });
    if (!body.endpoint) return c.json({ error: 'endpoint is required' }, 400);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint));
    return c.body(null, 204);
  });

  // ── POST /api/push/notify-deploy ─────────────────────────────────────────
  // Called by the frontend's cf-deploy step after a successful deploy. Guarded by
  // a shared secret (Authorization: Bearer <DEPLOY_NOTIFY_SECRET> or ?secret=).
  // Body: { version: string, url?: string }.
  router.post('/notify-deploy', async (c) => {
    const expected = c.env.DEPLOY_NOTIFY_SECRET;
    const header = c.req.header('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : c.req.query('secret');
    if (!expected || provided !== expected) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = c.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return c.json({ error: 'Push notifications are not configured' }, 503);
    }

    const body = await c.req
      .json<{ version?: string; url?: string }>()
      .catch(() => ({}) as { version?: string; url?: string });
    const version = body.version ?? 'latest';

    const result = await notifyDeployCompleted(
      db,
      { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT },
      { version, url: body.url },
    );
    return c.json(result);
  });

  return router;
}
