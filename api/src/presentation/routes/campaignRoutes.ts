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
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
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
import { isCampaignTransport } from '../../application/marketing/campaignTransports';
import {
  createAsset,
  createAssetFromSource,
  createTemplate,
  deleteAsset,
  deleteTemplate,
  listAssets,
  listTemplates,
  logoPrompt,
  fetchGeneratedImage,
  readAssetByToken,
  resolveAssetOrigin,
  updateTemplate,
  assetTooLargeMessage,
  isAssetKind,
  maxAssetBytes,
} from '../../application/marketing/templateLibrary';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

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
      transport?: string; mailboxConnectionId?: number; connectorConnectionId?: string;
      templateId?: number; fromName?: string;
    }>().catch(() => ({}) as never);
    if (!body.name?.trim()) return c.json({ error: 'Name the campaign.' }, 400);
    if (!Number.isInteger(body.audienceId)) return c.json({ error: 'Pick an audience.' }, 400);
    // An unrecognised transport is rejected rather than silently defaulted: the
    // caller asked to send through something specific, and quietly using the
    // platform sender instead would deliver from the wrong identity.
    if (body.transport !== undefined && !isCampaignTransport(body.transport)) {
      return c.json({ error: 'Unknown transport.' }, 400);
    }
    const result = await createCampaign(db, c.get('tenantId') as number, {
      name: body.name,
      audienceId: Number(body.audienceId),
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      senderIdentityId: body.senderIdentityId ?? null,
      transport: body.transport,
      mailboxConnectionId: body.mailboxConnectionId ?? null,
      connectorConnectionId: body.connectorConnectionId ?? null,
      templateId: body.templateId ?? null,
      fromName: body.fromName,
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
    const transport = (body as { transport?: unknown }).transport;
    if (transport !== undefined && !isCampaignTransport(transport)) {
      return c.json({ error: 'Unknown transport.' }, 400);
    }
    const result = await updateCampaign(db, c.get('tenantId') as number, campaignId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.campaign);
  });

  // ---- templates -------------------------------------------------------

  router.get('/templates', async (c) =>
    c.json({ templates: await listTemplates(db, c.get('tenantId') as number) }));

  /**
   * Create or IMPORT a template. One endpoint for both: an import is a create
   * whose body came from outside, and the sanitizer runs on either path — a
   * separate `/import` route would be a second place to forget it.
   */
  router.post('/templates', manager, async (c) => {
    const body = await c.req.json<{
      name?: string; subject?: string; bodyHtml?: string; description?: string;
      source?: string; assetId?: number;
    }>().catch(() => ({}) as never);
    if (!body.name?.trim()) return c.json({ error: 'Name the template.' }, 400);
    const result = await createTemplate(db, c.get('tenantId') as number, {
      name: body.name,
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      description: body.description,
      source: body.source === 'imported' || body.source === 'generated' ? body.source : 'custom',
      assetId: body.assetId ?? null,
      createdBy: c.get('userId') as string,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.template, 201);
  });

  router.patch('/templates/:id', manager, async (c) => {
    const templateId = Number(c.req.param('id'));
    if (!Number.isInteger(templateId)) return c.json({ error: 'Invalid template id.' }, 400);
    const body = await c.req.json<Record<string, never>>().catch(() => ({}) as never);
    const result = await updateTemplate(db, c.get('tenantId') as number, templateId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.template);
  });

  router.delete('/templates/:id', manager, async (c) => {
    const templateId = Number(c.req.param('id'));
    if (!Number.isInteger(templateId)) return c.json({ error: 'Invalid template id.' }, 400);
    await deleteTemplate(db, c.get('tenantId') as number, templateId);
    return c.body(null, 204);
  });

  // ---- assets (logos + images) -----------------------------------------

  router.get('/assets', async (c) => {
    const kind = c.req.query('kind');
    return c.json({
      assets: await listAssets(
        db,
        c.get('tenantId') as number,
        resolveAssetOrigin(c.env as Env),
        isAssetKind(kind) ? kind : undefined,
      ),
    });
  });

  /**
   * Upload an image or a video. multipart/form-data because the payload is
   * binary — a base64 JSON body would inflate a 2 MB logo to 2.7 MB on the wire.
   *
   * A JSON body `{ source }` is the SECOND encoding of the same act, for a
   * caller that does not hold a `File`: the Creation Canvas, whose generated
   * media lives in a `data:` URI or at a stock URL. It is the same route
   * because it is the same concept — "store this and give me its public
   * URL" — and a second endpoint would be a second place for the size, type and
   * tenant rules to drift apart from each other.
   *
   * The KIND is not restated here. `createAsset` derives it from the bytes, so a
   * caller that says nothing gets `image` for a PNG and `video` for an MP4; only
   * `logo` — a role, not a media type — has to be asked for.
   */
  router.post('/assets', manager, async (c) => {
    if ((c.req.header('content-type') ?? '').includes('application/json')) {
      const body = await c.req.json<{ source?: string; name?: string; kind?: string }>().catch(() => ({}) as never);
      if (!body.source?.trim()) return c.json({ error: 'Supply the file as a data URL or an https URL.' }, 400);
      const stored = await createAssetFromSource(db, c.env as Env, c.get('tenantId') as number, {
        source: body.source,
        name: String(body.name ?? 'Image'),
        ...(isAssetKind(body.kind) ? { kind: body.kind } : {}),
        createdBy: c.get('userId') as string,
      });
      if (!stored.ok) return c.json({ error: stored.error }, stored.status);
      return c.json(stored.asset, 201);
    }
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'Attach a file.' }, 400);
    }
    // Checked before the body is read into memory — the ArrayBuffer below is the
    // whole file, and a size check after it would have already paid the cost.
    // The ceiling depends on WHAT it is; an unknown type gets the smallest one,
    // and `createAsset` is what refuses it by name a moment later.
    const mimeType = file.type || 'application/octet-stream';
    if (file.size > maxAssetBytes(mimeType)) {
      return c.json({ error: assetTooLargeMessage(mimeType) }, 413);
    }

    const kindRaw = String(form?.get('kind') ?? '');
    const result = await createAsset(db, c.env as Env, c.get('tenantId') as number, {
      name: String(form?.get('name') ?? file.name ?? 'Image'),
      bytes: await file.arrayBuffer(),
      mimeType,
      ...(isAssetKind(kindRaw) ? { kind: kindRaw } : {}),
      source: 'uploaded',
      createdBy: c.get('userId') as string,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.asset, 201);
  });

  /**
   * Generate a logo and store it.
   *
   * Generation REPLAYS the app's own `/llm/v1/images/generations` route rather
   * than calling the image proxy directly, so the tenant's image-credit budget,
   * plan tier and paid-overflow ceiling are enforced by the one implementation
   * that owns them. Calling the service here would be a second, ungated door to
   * the same vendors.
   */
  router.post('/assets/generate', manager, async (c) => {
    const body = await c.req.json<{ description?: string; style?: string; name?: string }>()
      .catch(() => ({}) as never);
    const description = (body.description ?? '').trim();
    if (!description) return c.json({ error: 'Describe the brand or product.' }, 400);

    const prompt = logoPrompt(description, body.style);
    const auth = c.req.header('authorization');
    if (!auth) return c.json({ error: 'Not authorized.' }, 401);

    let image: { url?: string; b64_json?: string } | undefined;
    try {
      const res = await fetch(new URL('/llm/v1/images/generations', new URL(c.req.url).origin), {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, n: 1, size: '1024x1024', useCase: 'marketing-logo' }),
      });
      const payload = await res.json().catch(() => ({})) as {
        data?: Array<{ url?: string; b64_json?: string }>;
        error?: { message?: string };
      };
      // Pass the generator's own refusal through — "you are out of image credits"
      // is actionable; "logo generation failed" is not.
      if (!res.ok) {
        return c.json({ error: payload.error?.message ?? 'Image generation is unavailable.' }, 502);
      }
      image = payload.data?.[0];
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/campaignRoutes.ts', operation: 'generateLogo' });
      return c.json({ error: 'Image generation is unavailable.' }, 502);
    }
    if (!image) return c.json({ error: 'The generator returned no image. Try a simpler description.' }, 502);

    const fetched = await fetchGeneratedImage(image);
    if (!fetched) return c.json({ error: 'The generated image could not be stored.' }, 502);

    const result = await createAsset(db, c.env as Env, c.get('tenantId') as number, {
      name: (body.name ?? description).slice(0, 255),
      bytes: fetched.bytes,
      mimeType: fetched.mimeType,
      kind: 'logo',
      source: 'generated',
      prompt,
      createdBy: c.get('userId') as string,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.asset, 201);
  });

  router.delete('/assets/:id', manager, async (c) => {
    const assetId = Number(c.req.param('id'));
    if (!Number.isInteger(assetId)) return c.json({ error: 'Invalid asset id.' }, 400);
    await deleteAsset(db, c.env as Env, c.get('tenantId') as number, assetId);
    return c.body(null, 204);
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
    const started = await startCampaign(c.env as Env, db, tenantId, campaignId);
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

/**
 * Campaign logos and images. No auth, no tenant context — a recipient's MAIL
 * CLIENT is the caller, and it has no session to authenticate with, so an asset
 * behind `authMiddleware` renders as a broken image in every inbox.
 *
 * The unguessable per-asset token is the whole access model, which is why the
 * route takes a token and nothing else: there is no id to enumerate and no
 * tenant parameter to confuse.
 */
export function createMarketingAssetRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/:token', async (c) => {
    const token = c.req.param('token');
    const asset = await readAssetByToken(db, c.env as Env, token).catch(() => null);
    if (!asset) return c.notFound();
    return new Response(asset.body, {
      headers: {
        'content-type': asset.mimeType,
        // Immutable: the token is minted per asset and never reassigned, so a
        // cached copy can never be the wrong image. A logo re-fetched on every
        // open of every campaign would be a lot of pointless egress.
        'cache-control': 'public, max-age=31536000, immutable',
        // An SVG is a DOCUMENT and can carry script. These two headers are what
        // stop one from executing against our origin if a tenant uploads a
        // hostile one — the CSP neutralises the script, and nosniff stops a
        // mislabelled type being re-interpreted as HTML.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
      },
    });
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
