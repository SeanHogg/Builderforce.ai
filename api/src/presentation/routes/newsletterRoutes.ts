import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { setNewsletterSubscription } from '../../application/marketing/newsletterSubscription';
import { normalizeEmail } from '../../application/shared/dnsVerification';
import { parseBody, z } from './requestBody';

/**
 * POST /api/auth/newsletter/subscribers — the public subscribe/unsubscribe door
 * the marketing surfaces call.
 *
 * Mounted at `/api/auth` so the URL every marketing page already posts to is
 * unchanged; it is its own module because a newsletter is not authentication.
 * Every field is loose on purpose — this form has always coerced rather than
 * refused (anything that is not `unsubscribe` subscribes) — but a body of the
 * wrong TYPE is now a 400 instead of a crash.
 */
const NewsletterBody = z.object({
  email: z.string().optional(),
  action: z.string().optional(),
  source: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  reason: z.string().optional(),
});

export function createNewsletterRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/newsletter/subscribers', async (c) => {
    const body = await parseBody(c, NewsletterBody);
    const email = normalizeEmail(body.email ?? '');
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    const result = await setNewsletterSubscription(db, {
      email,
      action: body.action === 'unsubscribe' ? 'unsubscribe' : 'subscribe',
      source: body.source?.trim() || 'marketing_site',
      firstName: body.firstName?.trim() || null,
      lastName: body.lastName?.trim() || null,
      reason: body.reason?.trim() || null,
    });
    return c.json({ ok: true, ...result });
  });

  return router;
}
