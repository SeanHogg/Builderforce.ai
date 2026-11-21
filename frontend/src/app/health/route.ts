import { APP_VERSION } from '@/lib/buildVersion';

export const runtime = 'edge';

/**
 * Public, unauthenticated "which build is live?" probe for the frontend Worker — the
 * twin of the API's GET /health. `commit` is the GIT_SHA var release.yml's
 * deploy-frontend stamps at deploy (`wrangler deploy --var GIT_SHA:<sha>`); it is
 * read at REQUEST time (next-on-pages proxies Worker vars onto `process.env`), never
 * inlined at build, and is null when unstamped (local dev).
 *
 * The API's `deploy.status` tool reads this to tell an agent whether its commit is live.
 */
export function GET(): Response {
  const sha = process.env.GIT_SHA?.trim();
  return Response.json(
    { status: 'ok', worker: 'builderforce-frontend', version: APP_VERSION, commit: sha ? sha : null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
