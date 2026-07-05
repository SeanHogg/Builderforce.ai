import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { isValidVisitorId, type MarketingTouch } from '../../application/marketing/MarketingService';
import { GuestChatService } from '../../application/guest/GuestChatService';
import { signGuestToken, guestBrainEnabled } from '../../application/guest/guestToken';
import { GUEST_CHAT_LIMITS } from '../../domain/tenant/PlanLimits';

/**
 * Guest (logged-out) Brain chat — PUBLIC session + usage routes.
 *
 * `POST /session` mints a short-lived guest token the browser sends to the Brain
 * gateway (`/llm/v1/chat/completions` detects the `bfguest_` prefix and meters
 * the call — see llmRoutes handleGuestChat). It also ensures a lead row exists so
 * the guest is tracked as an active lead and converts cleanly on sign-up. No
 * tenant data is touched; the opaque `visitorId` is the whole key.
 */
const GUEST_TOKEN_TTL_SECONDS = 3600;

export function createGuestRoutes(guest: GuestChatService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Mint a guest chat token + record the lead. Returns the token and the guest's
  // remaining daily allowance so the UI can show the "N left / sign up for more".
  router.post('/session', async (c) => {
    if (!guestBrainEnabled(c.env)) {
      return c.json({ error: 'Guest chat is disabled.', code: 'guest_brain_disabled' }, 503);
    }
    const body = await c.req
      .json<{ visitorId?: string; touch?: MarketingTouch }>()
      .catch((): { visitorId?: string; touch?: MarketingTouch } => ({}));
    if (!isValidVisitorId(body.visitorId)) {
      return c.json({ error: 'Invalid visitor id' }, 400);
    }
    const visitorId = body.visitorId;

    // Record the lead now (don't block the response on it).
    c.executionCtx.waitUntil(guest.ensureLead(visitorId, body.touch).catch(() => {}));

    const token = await signGuestToken(visitorId, c.env.JWT_SECRET, GUEST_TOKEN_TTL_SECONDS);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const cap = await guest.checkCap(c.env as Env, visitorId, ip);

    return c.json({
      token,
      expiresInSeconds: GUEST_TOKEN_TTL_SECONDS,
      remaining: cap.remaining,
      limit: cap.limit,
    });
  });

  // A guest's remaining daily allowance (for the composer's "N messages left").
  router.get('/usage/:visitorId', async (c) => {
    const visitorId = c.req.param('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const cap = await guest.checkCap(c.env as Env, visitorId, ip);
    return c.json({
      remaining: cap.remaining,
      limit: cap.limit,
      enabled: guestBrainEnabled(c.env),
      messagesDailyLimit: GUEST_CHAT_LIMITS.messagesDailyLimit,
    });
  });

  return router;
}
