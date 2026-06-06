/**
 * Git proxy routes – /api/git-proxy/:repoId/...
 *
 * A browser agent runs isomorphic-git against these endpoints; the proxy
 * forwards to the real provider with the tenant's credential injected
 * SERVER-SIDE. The push/clone token never reaches the browser — that is the
 * boundary that makes in-browser coding safe (per the runtime decision).
 *
 *   GET  /api/git-proxy/:repoId/info/refs?service=git-upload-pack|git-receive-pack
 *   POST /api/git-proxy/:repoId/git-upload-pack    (fetch/clone)
 *   POST /api/git-proxy/:repoId/git-receive-pack   (push)
 *
 * Only those three smart-HTTP sub-paths are proxied (gitProxy.isAllowedGitPath).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { executeGitProxy } from '../../application/repos/gitProxy';
import { resolveRepoCredential, isResolveError } from '../../application/repos/resolveRepoCredential';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type ProxyEnv = { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };

export function createGitProxyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  async function proxy(
    c: Context<HonoEnv>,
    repoId: string,
    subPath: string,
    method: 'GET' | 'POST',
  ): Promise<Response> {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as ProxyEnv;
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
    const resolved = await resolveRepoCredential(db, secret, tenantId, repoId);
    if (isResolveError(resolved)) return c.json({ error: resolved.error }, resolved.status);

    const result = await executeGitProxy({
      repo: resolved.repo,
      token: resolved.token,
      subPath,
      method,
      query: method === 'GET' ? new URL(c.req.url).searchParams.toString() : undefined,
      contentType: c.req.header('Content-Type'),
      body: method === 'POST' ? await c.req.arrayBuffer() : undefined,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return result.response;
  }

  router.get('/:repoId/info/refs', (c) => proxy(c, c.req.param('repoId'), 'info/refs', 'GET'));
  router.post('/:repoId/git-upload-pack', (c) => proxy(c, c.req.param('repoId'), 'git-upload-pack', 'POST'));
  router.post('/:repoId/git-receive-pack', (c) => proxy(c, c.req.param('repoId'), 'git-receive-pack', 'POST'));

  return router;
}
