/**
 * builderforce-sites — the Worker that serves published sites on `*.builderforce.ai`.
 *
 * WHY A SECOND WORKER: every request to a tenant's published site (public traffic,
 * most of it from people who have never heard of Builderforce) used to boot the
 * whole API — about 21 MB of code, ~200 routers, every Durable Object class — to
 * stream a file out of R2. This entry imports ONLY the static half of the site
 * server (`application/ide/siteStaticServe.ts`), so a cold start parses what a site
 * visit needs and nothing else. A guard (`scripts/check-sites-worker-graph.mjs`)
 * fails the build if that import graph ever reaches the API again.
 *
 * Routing is unchanged in effect. `api.builderforce.ai` and `builderforce.ai/gateway/*`
 * stay bound to the API (more specific routes win), and the wildcard
 * `*.builderforce.ai/*` lands here. Anything this Worker does not serve itself — a
 * platform host, or a site request the static half reports as dynamic (the site's
 * datastore, sign-in and server code, the entitlement-checked landing page, a page
 * view a workflow listens to) — goes to the API over the `API` service binding: the
 * exact request the wildcard used to deliver to it, with no extra network hop.
 */
import type { Env } from './env';
import { serveStaticSiteRequest } from './application/ide/siteStaticServe';
import { configureCaughtErrorReporter } from './application/observability/caughtErrorReporter';
import { runInRequestScope } from './application/shared/requestScope';
import { persistCaughtError } from './infrastructure/observability/persistCaughtError';

configureCaughtErrorReporter(persistCaughtError);

export interface SitesWorkerEnv extends Env {
  UPLOADS?: R2Bucket;
  /** Service binding to the API Worker, for every request not served here. */
  API: Fetcher;
}

export default {
  async fetch(request: Request, env: SitesWorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return runInRequestScope({
      env,
      method: request.method,
      path: new URL(request.url).pathname,
      waitUntil: (task) => ctx.waitUntil(task),
    }, async () => {
      const outcome = await serveStaticSiteRequest(env, request, (task) => ctx.waitUntil(task));
      return outcome.kind === 'served' ? outcome.response : env.API.fetch(request);
    });
  },
};
