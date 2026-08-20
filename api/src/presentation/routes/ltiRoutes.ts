/**
 * LTI 1.3 endpoints — /api/lti
 *
 * The four URLs an LMS administrator is asked for when they register a tool, plus the
 * two service calls the canvas makes back:
 *
 *   POST|GET /api/lti/login     OIDC third-party initiation → redirect to the platform
 *   POST     /api/lti/launch    the platform form-posts the signed id_token here
 *   GET      /api/lti/jwks      our public keys, so the platform can verify our assertions
 *   GET      /api/lti/config    the tool configuration JSON an admin pastes in
 *   POST     /api/lti/roster    pull a cohort roster through NRPS
 *   POST     /api/lti/score     push one mark back through AGS
 *
 * LAYER CONTRACT: this file parses, authorises and serialises. Every decision — what a
 * launch means, whether a nonce is fresh, what a role permits — is in
 * `application/lti/LtiService.ts` and `domain/lti/ltiClaims.ts`. The route never sees a
 * key, a table or a fetch.
 */
import { Hono, type Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import {
  buildLoginRedirect, fetchRoster, loadRegistrations, pushScore, registrationFor,
  rosterFromMembers, toolPublicJwks, verifyLaunch,
} from '../../application/lti/LtiService';
import { bridgeLaunch } from '../../application/lti/ltiLaunchBridge';
import {
  beginDeepLink, buildDeepLinkResponse, listLinkableObjects, readDeepLinkToken,
} from '../../application/lti/deepLinking';
import { LTI_MESSAGE_DEEP_LINK, canReturnGrades } from '../../domain/lti/ltiClaims';
import { mintSessionExchangeCode } from '../../application/auth/sessionExchange';
import type { Db } from '../../infrastructure/database/connection';

/** Read a form or query parameter, whichever binding the platform used. */
async function param(request: Request, name: string): Promise<string> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get(name);
  if (fromQuery) return fromQuery;
  if (request.method !== 'POST') return '';
  const form = await request.clone().formData().catch(() => null);
  const value = form?.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * `db` is INJECTED from the composition root rather than built here. A route that
 * calls `buildDatabase` is a presentation file reaching into infrastructure, which
 * `check:layering` refuses — and the reason it refuses is that the connection then
 * becomes untestable and unmockable from the one place that mounts the router.
 */
export function createLtiRoutes(db: Db) {
  const app = new Hono<HonoEnv>();

  /** The tool's public keys. Public by design — it is how the platform verifies us. */
  app.get('/jwks', async (c) => c.json(toolPublicJwks(await loadRegistrations(c.env))));

  /**
   * The configuration blob an administrator pastes into their LMS.
   *
   * Emitted rather than documented because every field is a URL that must match this
   * deployment exactly, and a hand-copied one is the single most common cause of a
   * registration that fails with `invalid_client` and no further detail.
   */
  app.get('/config', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      title: 'Builderforce Canvas',
      description: 'Cohorts, assignments, rubrics, marking and research boards on the Builderforce canvas.',
      oidc_initiation_url: `${origin}/api/lti/login`,
      target_link_uri: `${origin}/api/lti/launch`,
      public_jwk_url: `${origin}/api/lti/jwks`,
      scopes: [
        'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
        'https://purl.imsglobal.org/spec/lti-ags/scope/score',
        'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
      ],
      extensions: [{
        platform: 'canvas.instructure.com',
        privacy_level: 'public',
        settings: {
          placements: [
            { placement: 'course_navigation', message_type: 'LtiResourceLinkRequest' },
            // The two placements deep linking is REACHED from. Without them the
            // picker exists and no instructor can ever open it: a platform only
            // sends `LtiDeepLinkingRequest` for a placement declared to accept
            // one, so the endpoint would be dead wiring.
            { placement: 'assignment_selection', message_type: 'LtiDeepLinkingRequest', selection_width: 800, selection_height: 640 },
            { placement: 'link_selection', message_type: 'LtiDeepLinkingRequest', selection_width: 800, selection_height: 640 },
          ],
        },
      }],
    });
  });

  /** OIDC third-party initiation. Both bindings, because platforms differ. */
  const login = async (c: Context<HonoEnv>) => {
    const issuer = await param(c.req.raw, 'iss');
    const clientId = await param(c.req.raw, 'client_id');
    if (!issuer) return c.json({ error: 'Missing iss.' }, 400);

    const registration = await registrationFor(c.env, issuer, clientId || null);
    if (!registration) return c.json({ error: 'Unknown platform issuer.' }, 404);

    const origin = new URL(c.req.url).origin;
    const redirect = await buildLoginRedirect(c.env, registration, {
      iss: issuer,
      login_hint: await param(c.req.raw, 'login_hint'),
      lti_message_hint: await param(c.req.raw, 'lti_message_hint'),
    }, `${origin}/api/lti/launch`);

    // `state` rides a cookie so the launch POST can prove it belongs to this login.
    // SameSite=None because the whole exchange happens inside an LMS iframe, and
    // Secure because SameSite=None without it is dropped by every current browser.
    c.header('set-cookie', `lti_state=${redirect.state}; Path=/api/lti; Max-Age=600; HttpOnly; Secure; SameSite=None`);
    c.header('set-cookie', `lti_nonce=${redirect.nonce}; Path=/api/lti; Max-Age=600; HttpOnly; Secure; SameSite=None`, { append: true });
    return c.redirect(redirect.url, 302);
  };
  app.get('/login', login);
  app.post('/login', login);

  /** The platform form-posts the signed launch here. */
  app.post('/launch', async (c) => {
    const idToken = await param(c.req.raw, 'id_token');
    const state = await param(c.req.raw, 'state');
    if (!idToken) return c.json({ error: 'Missing id_token.' }, 400);

    const cookies = c.req.header('cookie') ?? '';
    const read = (name: string): string => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookies)?.[1] ?? '';
    if (!state || state !== read('lti_state')) {
      return c.json({ error: 'Launch state does not match the login request.' }, 401);
    }

    // The issuer is read from the UNVERIFIED payload only to select a registration;
    // `verifyLaunch` then checks the signature against THAT registration's JWKS and
    // re-checks the issuer, so a forged `iss` selects a registration whose key will
    // not verify the token.
    let issuer = '';
    try {
      const payloadSegment = idToken.split('.')[1] ?? '';
      const payload = JSON.parse(atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'))) as { iss?: string };
      issuer = typeof payload.iss === 'string' ? payload.iss : '';
    } catch {
      return c.json({ error: 'Malformed id_token.' }, 400);
    }
    const registration = await registrationFor(c.env, issuer, null);
    if (!registration) return c.json({ error: 'Unknown platform issuer.' }, 404);

    const result = await verifyLaunch(c.env, idToken, registration, read('lti_nonce') || null);
    if (!result.ok) return c.json({ error: result.error }, 401);

    const { context } = result;
    const wantsJson = (c.req.header('accept') ?? '').includes('application/json');

    // ── DEEP LINKING ────────────────────────────────────────────────────────
    // A different MESSAGE, not a different launch. `LtiDeepLinkingRequest` is
    // the LMS asking "what would you like to add to this course?", sent from
    // inside its content-picker dialog — so the answer is a PICKER, and landing
    // an instructor on a board there would be answering a question nobody asked.
    // The claim parser has always accepted both message types; until now nothing
    // read which one arrived, so every deep-linking launch opened a board.
    if (context.messageType === LTI_MESSAGE_DEEP_LINK) {
      const picker = await beginDeepLink(c.env, db, registration, context, result.deepLinking);
      if (!wantsJson) {
        const frontend = resolveAppBaseUrl(c.env);
        return picker.ok
          ? c.redirect(`${frontend}/lti/deep-link?token=${encodeURIComponent(picker.token)}`, 302)
          : c.redirect(`${frontend}/lti/launch?error=${encodeURIComponent(picker.error)}`, 302);
      }
      if (!picker.ok) return c.json({ error: picker.error }, picker.status as 400 | 403 | 409);
      return c.json({
        ok: true,
        messageType: context.messageType,
        deepLink: {
          token: picker.token,
          returnUrl: picker.session.settings.returnUrl,
          acceptMultiple: picker.session.settings.acceptMultiple,
          title: picker.session.settings.title,
        },
      });
    }

    // ── THE BRIDGE ──────────────────────────────────────────────────────────
    // This is what turns a verified launch into somewhere a person lands. It
    // resolves (or provisions) the launching user, resolves (or creates) the
    // board bound to the LMS course, stamps `ltiIssuer` / `ltiMembershipsUrl`
    // onto its cohort and `ltiLineItemUrl` onto the launched assignment, and
    // hands back where to go. Before this the route returned all of that as JSON
    // that nothing on the frontend read.
    //
    // A launch is a top-level browser navigation from the LMS, so the answer has
    // to be a REDIRECT and not a JSON body — except for a caller that asked for
    // JSON, which is how the contract stays testable and how a non-browser
    // integration can still read the service URLs.
    const bridged = await bridgeLaunch(db, registration, context);

    if (!wantsJson) {
      const frontend = resolveAppBaseUrl(c.env);
      if (!bridged.ok) {
        return c.redirect(`${frontend}/lti/launch?error=${encodeURIComponent(bridged.error)}`, 302);
      }
      // The SAME single-use exchange envelope the OAuth callback mints, and for
      // the same reason: a 24h session JWT in a URL is captured by analytics,
      // leaks through `Referer`, and stays in history. This code is an
      // HMAC-signed state envelope with a 60s life, useless as an API bearer,
      // and it is redeemed by the existing `POST /api/auth/oauth/exchange`.
      const code = await mintSessionExchangeCode(c.env.JWT_SECRET, {
        uid: bridged.userId,
        amr: 'lti',
        redirect: bridged.redirect,
      });
      return c.redirect(`${frontend}/auth/callback?code=${encodeURIComponent(code)}`, 302);
    }

    if (!bridged.ok) return c.json({ error: bridged.error }, bridged.status as 403 | 404 | 409);

    return c.json({
      ok: true,
      capability: context.capability,
      canReturnGrades: canReturnGrades(context),
      issuer: context.issuer,
      context: {
        courseCode: context.contextLabel,
        courseTitle: context.contextTitle,
        contextId: context.contextId,
        resourceLinkId: context.resourceLinkId,
        resourceLinkTitle: context.resourceLinkTitle,
      },
      user: { ref: context.subject, name: context.name, email: context.email },
      // The actual service URLs, not just whether they exist: a client that only
      // learns `roster: true` still cannot call `/api/lti/roster`, which needs
      // `membershipsUrl` in its body. Safe to return — neither URL is a secret, the
      // service ACCESS TOKEN they are called with is minted server-side and never
      // leaves this response.
      services: {
        roster: !!context.membershipsUrl,
        grades: canReturnGrades(context),
        membershipsUrl: context.membershipsUrl,
        lineItemUrl: context.lineItemUrl,
      },
      // Where the browser form of this launch would have gone. Returned so the
      // JSON and redirect answers cannot describe two different destinations.
      board: { sessionId: bridged.sessionId, redirect: bridged.redirect },
    });
  });

  /**
   * What the instructor may add, for a picker opened by a deep-linking launch.
   *
   * Authenticated by the PICKER TOKEN and nothing else. There is deliberately no
   * session here: the page runs inside the LMS's content dialog, where a
   * third-party cookie is blocked and our own session may not exist yet. The
   * token is the short-lived, HMAC-signed envelope minted from a launch that had
   * already passed every check — it names the tenant, and every query behind
   * this route is scoped to it.
   */
  app.get('/deep-link/options', async (c) => {
    const session = await readDeepLinkToken(c.env.JWT_SECRET, c.req.query('token') ?? '');
    if (!session) {
      return c.json({ error: 'This content picker has expired. Close it and add the tool again from your LMS.' }, 401);
    }
    const objects = session.bindingId == null
      ? []
      : await listLinkableObjects(c.env, db, session.tenantId, session.bindingId);
    return c.json({
      objects,
      settings: {
        acceptMultiple: session.settings.acceptMultiple,
        title: session.settings.title,
        text: session.settings.text,
      },
    });
  });

  /**
   * Sign the instructor's selection into the response the LMS expects.
   *
   * Returns `{ returnUrl, jwt }` rather than posting anything: LTI deep linking
   * ends with the BROWSER form-POSTing the JWT to the platform's return URL,
   * because that endpoint authenticates the instructor's own LMS session. A
   * server-to-server POST from here would arrive with nobody signed in and be
   * rejected — which is why the picker page renders a self-submitting form.
   */
  app.post('/deep-link/response', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { token?: string; objectIds?: unknown };
    const session = await readDeepLinkToken(c.env.JWT_SECRET, body.token ?? '');
    if (!session) {
      return c.json({ error: 'This content picker has expired. Close it and add the tool again from your LMS.' }, 401);
    }
    const objectIds = Array.isArray(body.objectIds)
      ? body.objectIds.filter((id): id is string => typeof id === 'string').slice(0, 50)
      : [];

    const origin = new URL(c.req.url).origin;
    const result = await buildDeepLinkResponse(c.env, db, session, objectIds, `${origin}/api/lti/launch`);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 502);
    return c.json({ returnUrl: result.returnUrl, jwt: result.jwt });
  });

  /** Pull a roster, projected onto the canvas cohort shape. */
  app.post('/roster', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { issuer?: string; membershipsUrl?: string };
    if (!body.issuer || !body.membershipsUrl) return c.json({ error: 'issuer and membershipsUrl are required.' }, 400);

    const registration = await registrationFor(c.env, body.issuer, null);
    if (!registration) return c.json({ error: 'Unknown platform issuer.' }, 404);

    const result = await fetchRoster(c.env, registration, body.membershipsUrl);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ roster: rosterFromMembers(result.members), memberCount: result.members.length });
  });

  /** Push one mark back. `released` decides whether the student sees it. */
  app.post('/score', async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      issuer?: string; lineItemUrl?: string; userId?: string;
      scoreGiven?: number; scoreMaximum?: number; comment?: string; released?: boolean;
    };
    if (!body.issuer || !body.lineItemUrl || !body.userId) {
      return c.json({ error: 'issuer, lineItemUrl and userId are required.' }, 400);
    }
    if (typeof body.scoreGiven !== 'number' || typeof body.scoreMaximum !== 'number' || body.scoreMaximum <= 0) {
      return c.json({ error: 'scoreGiven and a positive scoreMaximum are required.' }, 400);
    }
    const registration = await registrationFor(c.env, body.issuer, null);
    if (!registration) return c.json({ error: 'Unknown platform issuer.' }, 404);

    const result = await pushScore(c.env, registration, body.lineItemUrl, {
      userId: body.userId,
      scoreGiven: body.scoreGiven,
      scoreMaximum: body.scoreMaximum,
      released: body.released === true,
      timestamp: new Date().toISOString(),
      ...(body.comment ? { comment: body.comment } : {}),
    });
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ ok: true });
  });

  return app;
}
