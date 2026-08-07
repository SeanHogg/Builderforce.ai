/**
 * Tenant marketing — `/api/marketing/*` (authenticated) and
 * `/api/campaign-track/*` (public).
 *
 * Two routers because they have opposite audiences. The management surface is
 * tenant-scoped and MANAGER-gated for anything that can reach a real person's
 * inbox. The tracking surface is hit BY that person's mail client, so it takes
 * no auth at all and is addressed only by an unguessable per-recipient token —
 * which is also why it can never expose more than one send's state.
 *
 * The unsubscribe endpoint answers GET, deliberately. Mail clients and
 * List-Unsubscribe handlers issue a GET, and a one-click unsubscribe that needs
 * JavaScript or a second confirmation click is the kind of dark pattern that
 * gets a sending domain blocklisted.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../application/shared/dbPort';
import {
  addAudienceMembers,
  createAudience,
  createCampaign,
  createSender,
  listAudiences,
  listCampaigns,
  listSenders,
  recordClick,
  recordOpen,
  recordUnsubscribe,
  resolveTrackingOrigin,
  runCampaignBatch,
  startCampaign,
  suppressEmails,
  updateCampaign,
  verifySender,
  TRACKING_PIXEL,
} from '../../application/marketing/campaignEngine';

export function createGrowthRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const manager = requireRole(TenantRole.MANAGER);

  // ---- audiences -------------------------------------------------------

  router.get('/audiences', async (c) =>
    c.json({ audiences: await listAudiences(db, c.get('tenantId') as number) }));

  router.post('/audiences', manager, async (c) => {
    const body = await c.req.json<{ name?: string; description?: string; projectId?: number }>().catch(() => ({}) as never);
    if (!body.name?.trim()) return c.json({ error: 'Name the audience.' }, 400);
    const audience = await createAudience(db, c.get('tenantId') as number, {
      name: body.name,
      description: body.description,
      projectId: body.projectId ?? null,
    });
    return c.json(audience, 201);
  });

  router.post('/audiences/:id/members', manager, async (c) => {
    const audienceId = Number(c.req.param('id'));
    if (!Number.isInteger(audienceId)) return c.json({ error: 'Invalid audience id.' }, 400);
    const body = await c.req.json<{ members?: Array<{ email: string; name?: string }> }>().catch(() => ({}) as never);
    const members = Array.isArray(body.members) ? body.members.slice(0, 5_000) : [];
    if (members.length === 0) return c.json({ error: 'Add at least one email address.' }, 400);
    const result = await addAudienceMembers(db, c.get('tenantId') as number, audienceId,
      members.map((m) => ({ ...m, source: 'import' })));
    return c.json(result);
  });

  // ---- sender identities -----------------------------------------------

  router.get('/senders', async (c) =>
    c.json({ senders: await listSenders(db, c.get('tenantId') as number) }));

  router.post('/senders', manager, async (c) => {
    const body = await c.req.json<{ fromEmail?: string; fromName?: string; replyTo?: string }>().catch(() => ({}) as never);
    const result = await createSender(db, c.get('tenantId') as number, {
      fromEmail: String(body.fromEmail ?? ''),
      fromName: body.fromName,
      replyTo: body.replyTo,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.sender, 201);
  });

  router.post('/senders/:id/verify', manager, async (c) => {
    const senderId = Number(c.req.param('id'));
    if (!Number.isInteger(senderId)) return c.json({ error: 'Invalid sender id.' }, 400);
    const result = await verifySender(db, c.get('tenantId') as number, senderId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.sender);
  });

  // ---- suppression -----------------------------------------------------

  router.post('/suppressions', manager, async (c) => {
    const body = await c.req.json<{ emails?: string[] }>().catch(() => ({}) as never);
    const emails = Array.isArray(body.emails) ? body.emails.slice(0, 5_000) : [];
    const added = await suppressEmails(db, c.get('tenantId') as number, emails, 'manual');
    return c.json({ added });
  });

  // ---- campaigns -------------------------------------------------------

  router.get('/campaigns', async (c) =>
    c.json({ campaigns: await listCampaigns(db, c.get('tenantId') as number) }));

  router.post('/campaigns', manager, async (c) => {
    const body = await c.req.json<{
      name?: string; audienceId?: number; subject?: string; bodyHtml?: string;
      senderIdentityId?: number; projectId?: number; sessionId?: string;
    }>().catch(() => ({}) as never);
    if (!body.name?.trim()) return c.json({ error: 'Name the campaign.' }, 400);
    if (!Number.isInteger(body.audienceId)) return c.json({ error: 'Pick an audience.' }, 400);
    const result = await createCampaign(db, c.get('tenantId') as number, {
      name: body.name,
      audienceId: Number(body.audienceId),
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      senderIdentityId: body.senderIdentityId ?? null,
      projectId: body.projectId ?? null,
      sessionId: body.sessionId ?? null,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.campaign, 201);
  });

  router.patch('/campaigns/:id', manager, async (c) => {
    const campaignId = Number(c.req.param('id'));
    if (!Number.isInteger(campaignId)) return c.json({ error: 'Invalid campaign id.' }, 400);
    const body = await c.req.json<Record<string, never>>().catch(() => ({}) as never);
    const result = await updateCampaign(db, c.get('tenantId') as number, campaignId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.campaign);
  });

  /**
   * Start sending. This materializes the recipient list and immediately runs the
   * FIRST batch, so a small audience completes in one request and the user sees
   * a finished send rather than a spinner; the cron sweep picks up the rest.
   */
  router.post('/campaigns/:id/send', manager, async (c) => {
    const campaignId = Number(c.req.param('id'));
    if (!Number.isInteger(campaignId)) return c.json({ error: 'Invalid campaign id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const started = await startCampaign(db, tenantId, campaignId);
    if (!started.ok) return c.json({ error: started.error }, started.status);
    const batch = await runCampaignBatch(c.env, db, tenantId, campaignId, {
      trackingOrigin: resolveTrackingOrigin(c.env),
    });
    return c.json({ campaign: started.campaign, queued: started.queued, suppressed: started.suppressed, batch });
  });

  return router;
}

/**
 * Public tracking. No auth, no tenant context — a mail client is the caller.
 * Every handler is addressed only by the per-recipient token, and every handler
 * answers successfully even when the token is unknown: a broken pixel or a
 * scary error page in someone's inbox is worse than a silently ignored hit.
 */
export function createCampaignTrackRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/open/:token{.+\\.gif}', async (c) => {
    const token = c.req.param('token').replace(/\.gif$/i, '');
    await recordOpen(db, token).catch(() => undefined);
    return new Response(TRACKING_PIXEL, {
      headers: {
        'content-type': 'image/gif',
        // Never cache: a cached pixel would silently stop reporting.
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  });

  router.get('/click/:token', async (c) => {
    const target = c.req.query('u') ?? '';
    const destination = await recordClick(db, c.req.param('token'), target).catch(() => null);
    // An unresolvable destination must not become an open redirect — fall back
    // to our own origin rather than trusting the query string.
    if (!destination) return c.redirect(resolveTrackingOrigin(c.env), 302);
    return c.redirect(destination, 302);
  });

  router.get('/unsubscribe/:token', async (c) => {
    const email = await recordUnsubscribe(db, c.req.param('token')).catch(() => null);
    const message = email
      ? `${escapeHtml(email)} has been unsubscribed. You will not receive further emails.`
      : 'This unsubscribe link is no longer valid.';
    return c.html(unsubscribePage(message));
  });

  return router;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The unsubscribe confirmation. A standalone document rather than a redirect
 * into the app: the reader is not a Builderforce user and must not be asked to
 * sign in to stop receiving mail. Colours are set for both schemes because this
 * page is opened in a mail client's browser with no app shell around it.
 */
function unsubscribePage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#111827; --muted:#6b7280; --card:#f9fafb; --border:#e5e7eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0f19; --fg:#f3f4f6; --muted:#9ca3af; --card:#151b28; --border:#252d3d; }
  }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--fg); padding:24px;
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { width:100%; max-width:32rem; background:var(--card); border:1px solid var(--border);
          border-radius:12px; padding:clamp(20px,5vw,32px); }
  h1 { margin:0 0 12px; font-size:clamp(1.25rem,4vw,1.5rem); }
  p { margin:0; color:var(--muted); }
</style></head>
<body><main class="card"><h1>Unsubscribed</h1><p>${message}</p></main></body></html>`;
}
