/**
 * `/hooks/:ingressToken/*` — the PUBLIC front door for project backends.
 *
 * This is where a provider's webhook lands: an inbound SMS, an IVR leg on a live
 * call, a WhatsApp reply, a delivery-status callback.
 *
 * ── NO JWT, ON PURPOSE ──────────────────────────────────────────────────────
 * Twilio cannot present a Builderforce session, so this route is unauthenticated
 * at the transport level and authenticated at the MESSAGE level: each handler
 * declares a `verify` kind and the request is rejected before any step runs if it
 * does not check out. The ingress token in the path is NOT the authentication —
 * it prevents enumeration of other tenants' projects, nothing more. A handler
 * that genuinely wants to be open must say `"verify": "none"`, which is a choice
 * recorded in the spec rather than a default nobody noticed.
 *
 * The route itself is deliberately thin: resolving the token is the ONLY thing
 * unique to this address. Everything else — rate limit, body cap, verification,
 * step budget, request log — lives in `application/backend/ingress.ts`, shared
 * with the site-origin address (`<site-host>/api/...`), so the two cannot drift
 * into two different security postures.
 */

import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  backendByIngressToken,
  ingressUrlFor,
  loadHandlersCached,
  type ProjectBackend,
} from '../../application/backend';
import { dispatchIngressRequest } from '../../application/backend/ingress';

export function createHooksRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.all('/:token/*', async (c) => {
    const token = c.req.param('token');
    const env = c.env as Env & { UPLOADS?: R2Bucket };

    const backend = await backendByIngressToken(env, db, token);
    // An unknown token is a 404 with no detail: distinguishing "no such project"
    // from "that project has no such route" would make the token enumerable.
    if (!backend) return c.text('Not found', 404);

    // Everything after `/hooks/<token>` is the handler route.
    const prefix = `/hooks/${token}`;
    const result = await dispatchIngressRequest({
      env,
      db,
      request: c.req.raw,
      route: new URL(c.req.url).pathname.slice(prefix.length),
      target: {
        projectId: backend.projectId,
        tenantId: backend.tenantId,
        ingressUrl: ingressUrlFor(env, backend.ingressToken),
        rateLimitKey: `ingress:${token}`,
      },
    });
    // On this address an unmatched route IS the answer — there is nothing else
    // here to fall through to.
    if (!result.matched) return c.text(result.detail, 404);
    return result.response;
  });

  // A bare `/hooks/<token>` with no path is the URL a user is most likely to open
  // in a browser to check the ingress is alive. Answer usefully instead of 404ing.
  router.get('/:token', async (c) => {
    const env = c.env as Env & { UPLOADS?: R2Bucket };
    const backend = await backendByIngressToken(env, db, c.req.param('token'));
    if (!backend) return c.text('Not found', 404);
    if (!env.UPLOADS) return c.text('Storage not configured', 503);
    const { specs, errors } = await loadHandlersCached(env, env.UPLOADS, backend.projectId);
    return c.json({
      ingressUrl: ingressUrlFor(env, backend.ingressToken),
      strategy: backend.strategy,
      handlers: specs.map((s) => ({ name: s.name, method: s.method, route: s.route, verify: s.verify })),
      errors,
    });
  });

  return router;
}

export type { ProjectBackend };
