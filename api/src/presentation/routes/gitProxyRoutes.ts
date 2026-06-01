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
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { projectRepositories, integrationCredentials } from '../../infrastructure/database/schema';
import { decryptCredentials } from '../../application/boardsync/drizzleStore';
import { buildUpstreamGitUrl, buildGitAuthHeader } from '../../application/repos/gitProxy';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type ProxyEnv = { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };

export function createGitProxyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  async function resolveRepoAndToken(
    c: Context<HonoEnv>,
    repoId: string,
  ): Promise<{ repo: { provider: string; host: string | null; owner: string; repo: string }; token: string } | { error: string; status: 400 | 404 }> {
    const tenantId = c.get('tenantId') as number;
    const [repo] = await db
      .select()
      .from(projectRepositories)
      .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.tenantId, tenantId)));
    if (!repo) return { error: 'Repository not found', status: 404 };
    if (!repo.credentialId) return { error: 'Repository has no linked credential', status: 400 };

    const [cred] = await db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, repo.credentialId), eq(integrationCredentials.tenantId, tenantId)));
    if (!cred) return { error: 'Credential not found', status: 404 };

    const env = c.env as ProxyEnv;
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
    const creds = await decryptCredentials(cred.credentialsEnc, cred.iv, secret);
    const token =
      (creds?.accessToken as string | undefined) ??
      (creds?.apiToken as string | undefined) ??
      (creds?.token as string | undefined);
    if (!token) return { error: 'Credential has no usable token', status: 400 };

    return { repo: { provider: repo.provider, host: repo.host, owner: repo.owner, repo: repo.repo }, token };
  }

  async function proxy(
    c: Context<HonoEnv>,
    repoId: string,
    subPath: string,
    method: 'GET' | 'POST',
  ): Promise<Response> {
    const resolved = await resolveRepoAndToken(c, repoId);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

    let upstreamUrl: string;
    try {
      const query = method === 'GET' ? new URL(c.req.url).searchParams.toString() : undefined;
      upstreamUrl = buildUpstreamGitUrl(resolved.repo, subPath, query || undefined);
    } catch {
      return c.json({ error: 'Disallowed git path' }, 400);
    }

    const headers: Record<string, string> = {
      Authorization: buildGitAuthHeader(resolved.repo.provider, resolved.token),
      'User-Agent': 'BuilderForce-Git-Proxy/1.0',
    };
    const contentType = c.req.header('Content-Type');
    if (contentType) headers['Content-Type'] = contentType;

    const init: RequestInit = { method, headers };
    if (method === 'POST') init.body = await c.req.arrayBuffer();

    const upstream = await fetch(upstreamUrl, init);
    const respHeaders = new Headers();
    const ct = upstream.headers.get('Content-Type');
    if (ct) respHeaders.set('Content-Type', ct);
    respHeaders.set('Cache-Control', 'no-cache');
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  router.get('/:repoId/info/refs', (c) => proxy(c, c.req.param('repoId'), 'info/refs', 'GET'));
  router.post('/:repoId/git-upload-pack', (c) => proxy(c, c.req.param('repoId'), 'git-upload-pack', 'POST'));
  router.post('/:repoId/git-receive-pack', (c) => proxy(c, c.req.param('repoId'), 'git-receive-pack', 'POST'));

  return router;
}
