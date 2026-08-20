/**
 * Git proxy routes – /api/git-proxy/:repoId/...
 *
 * An agent runs isomorphic-git (browser) or plain git (headless) against these
 * endpoints; the proxy forwards to the real provider with the tenant's
 * credential injected SERVER-SIDE. The push/clone token never reaches the
 * executor — that is the boundary that makes remote coding safe (per the
 * runtime decision).
 *
 *   GET  /api/git-proxy/:repoId/info/refs?service=git-upload-pack|git-receive-pack
 *   POST /api/git-proxy/:repoId/git-upload-pack    (fetch/clone)
 *   POST /api/git-proxy/:repoId/git-receive-pack   (push)
 *
 * Auth is `hostOrTenantAuth`: a browser worker presents the operator's tenant
 * JWT, a non-browser executor presents its agent-host API key. Only the three
 * smart-HTTP sub-paths above are proxied (gitProxy.isAllowedGitPath), and the
 * request itself is served by the shared {@link handleGitProxyRequest}.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { hostOrTenantAuth } from '../middleware/hostOrTenantAuth';
import { GIT_PROXY_SUBPATHS, handleGitProxyRequest } from './gitProxyHandler';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createGitProxyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', hostOrTenantAuth(db));

  for (const { subPath, method } of GIT_PROXY_SUBPATHS) {
    const path = `/:repoId/${subPath}`;
    const handler = (c: Context<HonoEnv>) =>
      handleGitProxyRequest(c, db, c.get('tenantId') as number, c.req.param('repoId')!, subPath, method);
    if (method === 'GET') router.get(path, handler);
    else router.post(path, handler);
  }

  return router;
}
