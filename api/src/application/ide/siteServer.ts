/**
 * Public surface of a published site — assets, its data API, and its counter.
 *
 * Serves built assets from R2 (`sites/<subdomain>/...`) with SPA fallback. No
 * auth — these are public websites. Three addressing modes now:
 *   - Host-based (production): `<sub>.builderforce.ai/<path>`, delivered by the
 *     worker's wildcard route.
 *   - Custom domain: a tenant's own hostname, once it is verified AND has a
 *     certificate (`application/ide/customDomain.ts`). Resolved through the same
 *     `resolveSiteForHost` as the platform label, so the two cannot serve
 *     different content.
 *   - Path-based (works without the wildcard route): `/api/sites/<sub>/<path>`.
 *
 * THREE THINGS THAT ARE NOT ASSET SERVING happen on this host:
 *   1. `POST /__api/collections/<name>` — the site's datastore. A form on a
 *      published page posts here. Public reads are deliberately absent; see
 *      `application/ide/siteData.ts`.
 *   2. `/api/<route>` — the site's SERVER CODE. The project's canvas handlers,
 *      the same specs a provider reaches at `/hooks/<token>/<route>`, answering
 *      on the site's own origin so a published page can just `fetch('/api/…')`.
 *      One executor serves both addresses (`application/backend/ingress.ts`), so
 *      the friendlier URL is not a weaker one. A handler that responds with
 *      `text/html` is a server-rendered page; one with a `data` step reads the
 *      site's own collections back.
 *   3. Traffic counting — every served request feeds the in-isolate buffer that
 *      flushes to `site_traffic_daily`. Done here rather than in a separate
 *      middleware so a request cannot be served without being counted.
 */
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { backendByProject } from '../backend';
import { dispatchIngressRequest } from '../backend/ingress';
import {
  contentTypeFor,
  isImmutableAsset,
  lookupSite,
  resolveSiteForHost,
  type SiteRecord,
} from './siteHosting';
import { listOwnedSiteRecords, submitSiteRecord } from './siteData';
import {
  SESSION_TTL_MS,
  requestSiteSignIn,
  resolveSiteUser,
  signOutSiteUser,
  siteSessionCookie,
  siteSessionCookieHeader,
  verifySiteSignIn,
} from './siteAuth';
import { sendRawEmail } from '../../infrastructure/email/EmailService';
import {
  flushTrafficDeltas,
  invalidateSiteTraffic,
  isPageView,
  sharedTrafficBuffer,
  utcDay,
  visitorHash,
  visitorSalt,
} from './siteTraffic';
import { buildDatabase } from '../../infrastructure/database/connection';
import { fireEventTriggers } from '../workflow/eventTriggers';
import { SITE_LANDING_KEY } from './siteLandingPage';
import { jsonResponse, readSubmission, corsHeaders } from './siteServer.http';
import { handleSiteBilling } from '../marketplace/siteBilling';
import { forkedDocumentHeaders, landingPageApplies, resolveSiteVisitor } from './siteVisitor';

/** Path prefix reserved for the site's datastore. A published site cannot use
 *  it for assets — enforced by checking it before R2 is consulted. */
export const SITE_API_PREFIX = '/__api/';

/** Path prefix a published site's own handlers answer on. Unlike
 *  {@link SITE_API_PREFIX} this is NOT reserved: a request here falls back to a
 *  real file when no handler claims the route, so a site that already ships a
 *  static `/api/config.json` keeps working. */
export const SITE_BACKEND_PREFIX = '/api/';

type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * Make a single-page app's entry document work when it is served for a nested
 * route.
 *
 * A Vite/CRA build emits `<script src="./assets/app.js">` (or `assets/app.js`).
 * Served at `/`, that resolves correctly. Served as the SPA fallback for
 * `/docs/getting-started`, the browser resolves it against `/docs/`, asks for
 * `/docs/assets/app.js`, gets a 404, and the visitor sees a blank page — the
 * deep-link failure that makes a published site look broken precisely when
 * someone shares an inner page.
 *
 * `<base href="/">` fixes every relative URL in the document at once, which is
 * why it is preferable to rewriting each `src`/`href`. A document that already
 * declares its own base is left untouched: the author has said what they mean.
 */
export function withRootBase(html: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = '<base href="/">';
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    return html.slice(0, htmlTag.index + htmlTag[0].length) + `<head>${tag}</head>` + html.slice(htmlTag.index + htmlTag[0].length);
  }
  return tag + html;
}

/** True when serving the entry document for this path would break relative URLs
 *  — i.e. the browser's base is not the site root. */
function needsRootBase(assetPath: string): boolean {
  return assetPath.replace(/^\/+/, '').includes('/');
}

/** Serve one asset of a published site from an already-resolved site record.
 *  `exactOnly` suppresses the SPA fallback — used on the backend prefix, where
 *  answering an unmatched `/api/…` with the app's HTML would hand a `fetch()` a
 *  document instead of an error. */
async function serveAsset(
  env: Env & { UPLOADS?: R2Bucket },
  site: SiteRecord,
  assetPath: string,
  exactOnly = false,
): Promise<{ response: Response; bytes: number }> {
  if (!env.UPLOADS) {
    return { response: new Response('Storage not configured', { status: 503 }), bytes: 0 };
  }

  const rel = assetPath.replace(/^\/+/, '');
  const tryKeys: string[] = [];
  if (rel && rel !== '/') tryKeys.push(site.r2Prefix + rel);
  // Directory / client-route request → SPA entry document.
  const looksLikeFile = /\.[a-z0-9]+$/i.test(rel);
  const fallbackKey = site.r2Prefix + site.indexDocument;
  if (!looksLikeFile && !exactOnly) tryKeys.push(fallbackKey);

  for (const key of tryKeys) {
    const obj = await env.UPLOADS.get(key);
    if (!obj) continue;
    const servedPath = key.slice(site.r2Prefix.length);
    const headers = new Headers();
    headers.set('Content-Type', contentTypeFor(servedPath));
    // Build-hashed assets are immutable; everything else (incl. the entry doc)
    // gets a short TTL so a republish is picked up quickly.
    headers.set(
      'Cache-Control',
      isImmutableAsset(servedPath) ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    );
    // Only the SPA FALLBACK is rewritten, and only for a nested path: a direct
    // request for an HTML file resolves its own relative URLs correctly and must
    // be served byte-for-byte.
    if (key === fallbackKey && key !== site.r2Prefix + rel && needsRootBase(rel)) {
      const body = withRootBase(await obj.text());
      return { response: new Response(body, { headers }), bytes: body.length };
    }
    return { response: new Response(obj.body, { headers }), bytes: obj.size ?? 0 };
  }
  if (exactOnly) return { response: new Response(null, { status: 404 }), bytes: 0 };

  const notFound = await env.UPLOADS.get(site.r2Prefix + '404.html');
  if (notFound) {
    return {
      response: new Response(notFound.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      bytes: notFound.size ?? 0,
    };
  }
  return { response: new Response('Not found', { status: 404 }), bytes: 0 };
}

/** Serve one asset of a published site by subdomain + asset path. */
export async function serveHostedSite(
  env: Env & { UPLOADS?: R2Bucket },
  subdomain: string,
  assetPath: string,
): Promise<Response> {
  const site = await lookupSite(env, subdomain);
  if (!site) return new Response('Site not found', { status: 404 });
  const { response } = await serveAsset(env, site, assetPath);
  return response;
}

/**
 * Record one served request. Never awaited on the response path — the visitor
 * gets their bytes whether or not the counter lands.
 */
async function countRequest(
  env: Env,
  site: SiteRecord,
  request: Request,
  path: string,
  bytes: number,
  /** Override the path-derived classification. A backend call has no file
   *  extension, so it would otherwise be counted as a page view — and one page
   *  that calls three handlers on load would report four visits. */
  pageViewOverride?: boolean,
): Promise<void> {
  const day = utcDay(Date.now());
  const buffer = sharedTrafficBuffer();
  const pageView = pageViewOverride ?? isPageView(path);
  // Only page views need a visitor hash; hashing every asset fetch would triple
  // the crypto work on the hot path for no additional signal.
  const visitor = pageView
    ? await visitorHash(
        visitorSalt(env),
        request.headers.get('cf-connecting-ip') ?? undefined,
        request.headers.get('user-agent') ?? undefined,
        day,
      )
    : undefined;

  const shouldFlush = buffer.record({
    siteId: site.siteId,
    tenantId: site.tenantId,
    projectId: site.projectId,
    day,
    pageView,
    bytes,
    visitor,
  });

  // A `page-view` workflow trigger fires on the view itself, not on the batched
  // flush — a workflow that reacts to "somebody hit /pricing" is worthless if it
  // waits for the buffer to fill. This is the hottest path in the product, so the
  // dispatch is gated by the CACHED listener check inside fireEventTriggers: a
  // tenant with no such workflow pays no database round-trip at all.
  if (pageView) {
    await fireEventTriggers(buildDatabase(env), {
      tenantId: site.tenantId,
      env,
      eventType: 'page-view',
      payload: { siteId: site.siteId, projectId: site.projectId, path, day },
      match: { pagePath: path },
    }).catch(() => undefined);
  }

  if (!shouldFlush) return;

  const deltas = buffer.drain();
  try {
    await flushTrafficDeltas(buildDatabase(env), deltas);
    // The summary is read-through cached, so without this a user who just
    // shared their link would watch a stale zero for the whole TTL — exactly
    // the moment the number matters most. Only the projects in THIS batch.
    await Promise.all([...new Set(deltas.map((d) => d.projectId))]
      .map((projectId) => invalidateSiteTraffic(env, projectId)));
  } catch (error) {
    // Losing a batch of counters must never surface to a site visitor, and
    // re-queueing risks unbounded growth if the database is down. The metric is
    // explicitly approximate (see application/ide/siteTraffic.ts) — but a
    // PERSISTENTLY failing flush means the numbers are silently wrong, so it is
    // reported even though it is not raised.
    reportCaughtError(error, { source: 'application/ide/siteServer.ts', operation: 'flushSiteTraffic' });
  }
}

/** Handle a request to the site's own backend (`/__api/...`). */
async function handleSiteApi(
  env: Env,
  site: SiteRecord,
  request: Request,
  path: string,
): Promise<Response> {
  const rest = path.slice(SITE_API_PREFIX.length);

  if (request.method === 'OPTIONS') {
    // A form posted from the site itself is same-origin, but a static export
    // hosted elsewhere is a legitimate caller too, so the write endpoint is
    // deliberately open — it can only ever CREATE a record in one collection.
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ── The generated app's own accounts ──────────────────────────────────────
  // Sign-in for END USERS of the published app (`site_users`), which is a
  // separate identity space from Builderforce's own — see `siteAuth.ts`. This is
  // what lets a generated app be something other than a brochure with a form.
  if (rest.startsWith('auth/')) return handleSiteAuth(env, site, request, rest.slice('auth/'.length));

  // ── Paying the person who built this app ──────────────────────────────────
  // The consumer is a `site_user` — no Builderforce account, no workspace, no
  // second signup and no second invoice. Served on the app's OWN origin because
  // that is where they already are.
  if (rest.startsWith('billing/')) {
    return handleSiteBilling(env, site, request, rest.slice('billing/'.length));
  }

  const match = /^collections\/([a-z0-9-]{1,64})\/?$/i.exec(rest);
  if (!match) return jsonResponse({ error: 'Unknown endpoint.' }, 404);
  const collectionName = match[1]!;
  const db = buildDatabase(env);

  // A GET is answered ONLY for a signed-in end user, ONLY from collections whose
  // owner set `read_policy = 'owner'`, and ONLY with that user's own rows. The
  // module's rule that there is no public read is intact: this is not one.
  if (request.method === 'GET') {
    const identity = await resolveSiteUser(db, site.siteId, site.tenantId, siteSessionCookie(request.headers.get('cookie')));
    if (!identity) return jsonResponse({ error: 'Sign in to read your records.' }, 401);
    const owned = await listOwnedSiteRecords({
      db,
      siteId: site.siteId,
      tenantId: site.tenantId,
      collectionName,
      siteUserId: identity.userId,
      limit: Number(new URL(request.url).searchParams.get('limit')) || undefined,
    });
    if (!owned.ok) return jsonResponse({ error: owned.error }, owned.status);
    return jsonResponse({ ok: true, records: owned.records }, 200);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Use POST to submit.' }, 405);
  }

  const body = await readSubmission(request);
  if (body === null) return jsonResponse({ error: 'Could not read the submission.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') ?? undefined;
  const day = utcDay(Date.now());
  const ipHash = ip ? await visitorHash(visitorSalt(env), ip, undefined, day) : null;
  // A submission from a signed-in end user is OWNED by them, which is what makes
  // it readable back. Anonymous posts keep owner null and behave exactly as before.
  const author = await resolveSiteUser(db, site.siteId, site.tenantId, siteSessionCookie(request.headers.get('cookie')));

  const result = await submitSiteRecord({
    db,
    siteId: site.siteId,
    tenantId: site.tenantId,
    collectionName,
    body,
    siteUserId: author?.userId ?? null,
    ipHash,
    userAgent: request.headers.get('user-agent'),
    referrer: request.headers.get('referer'),
    env,
  });

  if (!result.ok) return jsonResponse({ error: result.error }, result.status);
  return jsonResponse({ ok: true, id: result.recordId }, 201);
}

/**
 * `/__api/auth/*` — request a code, redeem it, read the session, end it.
 *
 * Every answer here is deliberately uninformative about whether an address is
 * known: `request` always reports success, so the endpoint cannot be used to
 * enumerate a site's users. The code itself is delivered out of band.
 */
async function handleSiteAuth(
  env: Env,
  site: SiteRecord,
  request: Request,
  action: string,
): Promise<Response> {
  const db = buildDatabase(env);
  const cookie = siteSessionCookie(request.headers.get('cookie'));

  if (action === 'me' && request.method === 'GET') {
    const identity = await resolveSiteUser(db, site.siteId, site.tenantId, cookie);
    return identity
      ? jsonResponse({ ok: true, signedIn: true, user: identity }, 200)
      : jsonResponse({ ok: true, signedIn: false, user: null }, 200);
  }

  if (action === 'signout' && request.method === 'POST') {
    await signOutSiteUser(db, site.siteId, site.tenantId, cookie);
    return jsonResponse({ ok: true }, 200, { 'set-cookie': siteSessionCookieHeader(null, 0) });
  }

  if (action === 'request' && request.method === 'POST') {
    const body = await readSubmission(request);
    const started = await requestSiteSignIn(db, site.siteId, site.tenantId, (body as { email?: unknown } | null)?.email, env);
    if (started.ok) {
      // Delivery is best-effort and its failure must not tell the caller whether
      // the address exists. A code that could not be sent simply expires.
      try {
        await deliverSiteSignInCode(env, new URL(request.url).hostname, started.email, started.code);
      } catch (error) {
        reportCaughtError(error, { source: 'application/ide/siteServer.ts', operation: 'deliverSiteSignInCode' });
      }
    }
    // Always the same answer — see this function's contract.
    return jsonResponse({ ok: true, sent: true }, 200);
  }

  if (action === 'verify' && request.method === 'POST') {
    const body = await readSubmission(request) as { email?: unknown; code?: unknown } | null;
    const verified = await verifySiteSignIn(db, site.siteId, site.tenantId, body?.email, body?.code);
    if (!verified.ok) return jsonResponse({ error: verified.error }, verified.status);
    return jsonResponse(
      { ok: true, user: { userId: verified.userId, email: verified.email } },
      200,
      { 'set-cookie': siteSessionCookieHeader(verified.token, Math.floor(SESSION_TTL_MS / 1000)) },
    );
  }

  return jsonResponse({ error: 'Unknown endpoint.' }, 404);
}


/**
 * Run the project's canvas handlers for a `/api/<route>` request on the site's
 * own origin. Returns null to mean "not ours" — the caller then tries a real
 * file, so a site that ships a static `/api/…` asset is unaffected.
 *
 * WHY THIS ADDRESS EXISTS AT ALL. The handlers were only reachable at
 * `/hooks/<opaque-token>/<route>`, an address built for pasting into a provider
 * console. A published page could not call its own backend without embedding
 * that token in client-side JavaScript — so in practice a site could store a
 * form submission and nothing else. Same specs, same executor, same rules; the
 * only difference is a URL a person can type.
 *
 * The backend row gates it: a project with no backend, or one whose kill switch
 * is on, resolves to null and every `/api/…` falls through to static serving.
 */
async function serveSiteBackend(
  env: Env & { UPLOADS?: R2Bucket },
  site: SiteRecord,
  request: Request,
  path: string,
): Promise<Response | null> {
  const db = buildDatabase(env);
  const backend = await backendByProject(env, db, site.projectId);
  if (!backend) return null;

  const origin = new URL(request.url).origin;
  const result = await dispatchIngressRequest({
    env,
    db,
    request,
    route: path.slice(SITE_BACKEND_PREFIX.length - 1),
    target: {
      projectId: site.projectId,
      tenantId: site.tenantId,
      // Callback URLs a handler builds must come back to the site's own origin —
      // a live call handed off to a different host mid-leg is a dropped call.
      ingressUrl: `${origin}${SITE_BACKEND_PREFIX.replace(/\/$/, '')}`,
      // Per SITE, so a busy site cannot spend the webhook address's budget.
      rateLimitKey: `site-ingress:${site.siteId}`,
    },
  });

  if (result.matched) return result.response;

  // No handler claimed it. Try an exact file before giving up, then answer as an
  // API would — never with the SPA document, which a `fetch()` cannot use.
  const asset = await serveAsset(env, site, path.replace(/^\/+/, ''), true);
  if (asset.response.status !== 404) return asset.response;
  // Deliberately NOT `jsonResponse`: that one carries the datastore's open
  // `Access-Control-Allow-Origin: *`, which here would let any page on the
  // internet map a site's backend by reading which routes this 404 names.
  // Cross-origin access to handlers is opt-in per handler (`cors` on the spec).
  return new Response(JSON.stringify({ error: result.detail }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}




/**
 * Deliver an end user's sign-in code.
 *
 * Plain, unbranded and deliberately minimal: this mail is sent on behalf of a
 * TENANT'S app, not on behalf of Builderforce, so it must not carry Builderforce
 * marketing, an unsubscribe footer for a list the recipient is not on, or any
 * claim about who is writing to them beyond the app's own name.
 *
 * `sendRawEmail` rather than the lifecycle sender for the same reason: there is
 * no consent question to ask about a code the person just requested, and no
 * category for them to opt out of.
 */
async function deliverSiteSignInCode(env: Env, host: string, email: string, code: string): Promise<void> {
  // The app names itself by the host the visitor is on — which is the name they
  // will recognise, and is correct for a custom domain as well as a platform one.
  const appName = host;
  await sendRawEmail(env as Parameters<typeof sendRawEmail>[0], {
    to: email,
    subject: `${code} is your ${appName} sign-in code`,
    html: [
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">',
      `<p>Your sign-in code for <strong>${appName}</strong>:</p>`,
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">${code}</p>`,
      '<p style="color:#666;font-size:13px">It expires in 10 minutes. If you did not ask to sign in, ignore this message — nothing has changed.</p>',
      '</div>',
    ].join(''),
  });
}

/**
 * Host-based hosting hook for the top-level middleware. Returns a served
 * response when the request Host is a published site (platform subdomain OR a
 * verified custom domain), or null to let normal API routing continue.
 */
export async function tryServeHostedSite(
  env: Env & { UPLOADS?: R2Bucket },
  request: Request,
  waitUntil?: WaitUntil,
): Promise<Response | null> {
  const site = await resolveSiteForHost(env, request.headers.get('host') ?? undefined);
  if (!site) return null;

  const url = new URL(request.url);
  const path = url.pathname;
  // One counting call for every exit, so a new branch cannot forget it.
  const count = async (bytes: number, pageView?: boolean): Promise<void> => {
    const pending = countRequest(env, site, request, path, bytes, pageView);
    if (waitUntil) waitUntil(pending);
    else await pending;
  };

  if (path.startsWith(SITE_API_PREFIX)) {
    const response = await handleSiteApi(env, site, request, path);
    // A submission is a page-level event; count it so form conversion shows up
    // in the same series as the views that produced it.
    await count(0);
    return response;
  }

  if (path.startsWith(SITE_BACKEND_PREFIX)) {
    const served = await serveSiteBackend(env, site, request, path);
    if (served) {
      await count(0, false);
      return served;
    }
  }

  // ── The shop window ─────────────────────────────────────────────────────────
  // One additive fork, on the ENTRY DOCUMENT only. A site with no landing page never
  // reaches the database here — `landingPageApplies` reads a field already on the
  // cached record — so nothing about serving an app changes for anyone who has not
  // authored one.
  if (landingPageApplies(site, url)) {
    const visitor = await resolveSiteVisitor(env, buildDatabase(env), site, request);
    // A not-yet-entitled visitor sees the shop window to subscribe, same as always.
    // A LIVE subscriber holding an old version sees it ONCE MORE, on this same
    // document, for the commerce widget to offer the update — never a second
    // rendering, and `ENTER_APP_PARAM` (already respected by `landingPageApplies`)
    // is how either visitor reaches the app instead.
    if (!visitor.entitled || visitor.updateAvailable) {
      const landing = await serveLandingDocument(env, site);
      if (landing) {
        await count(landing.bytes, true);
        return landing.response;
      }
      // The pointer said there is a shop window and R2 did not have it. Serving the
      // app is the right failure: the visitor gets the product rather than an error
      // page, and the next publish rewrites the document.
    }
  }

  const { response, bytes } = await serveAsset(env, site, path.replace(/^\/+/, ''));
  await count(bytes);
  return response;
}

/** Read the rendered landing document out of the release's own prefix. Null when it
 *  is not there, which the caller treats as "serve the app". */
async function serveLandingDocument(
  env: Env & { UPLOADS?: R2Bucket },
  site: SiteRecord,
): Promise<{ response: Response; bytes: number } | null> {
  if (!env.UPLOADS) return null;
  const object = await env.UPLOADS.get(site.r2Prefix + SITE_LANDING_KEY);
  if (!object) return null;
  return {
    response: new Response(object.body, { headers: forkedDocumentHeaders() }),
    bytes: object.size ?? 0,
  };
}

