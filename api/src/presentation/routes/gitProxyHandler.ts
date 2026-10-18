/**
 * gitProxyHandler — the ONE route-level git smart-HTTP proxy handler.
 *
 * Three mounts need byte-identical behaviour: `/api/git-proxy/:repoId/...` (the
 * browser worker, tenant JWT or host key),
 * `/api/agent-hosts/:id/git-proxy/:repoId/...` (a deployed host's own path,
 * kept so already-shipped fleets keep working) and
 * `/api/runtime/internal/container-git/:executionId.git/...` (a cloud container,
 * authenticated by its run token, repo resolved from the run's ticket). They used
 * to be separate copies; a change to one — the allowed sub-paths, the request
 * marshalling, the error mapping — silently skipped the others. Only the DOOR
 * (auth + which repo) differs; {@link proxyGitSmartHttp} is the shared body.
 *
 * The security boundary is the point of the seam: the tenant's git credential is
 * decrypted and injected SERVER-SIDE, so a push/clone token never reaches the
 * executor. `executeGitProxy` owns the upstream fetch; this owns turning a Hono
 * request into its inputs and its result into a Response.
 */
import { integrationCredentialSecret } from '../../application/integrations/integrationCredentialSecret';
import type { Context } from 'hono';
import { executeGitProxy, type ProxyRepo } from '../../application/repos/gitProxy';
import { resolveRepoCredential, isResolveError } from '../../application/repos/resolveRepoCredential';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

/** The three smart-HTTP sub-paths a git client requests, and their methods. */
export const GIT_PROXY_SUBPATHS = [
  { subPath: 'info/refs', method: 'GET' },
  { subPath: 'git-upload-pack', method: 'POST' },
  { subPath: 'git-receive-pack', method: 'POST' },
] as const satisfies ReadonlyArray<{ subPath: string; method: 'GET' | 'POST' }>;

type ProxyEnv = { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };

/**
 * Proxy one smart-HTTP request for `repoId` on behalf of `tenantId`. The caller
 * has already established the tenant (JWT, host key, or either).
 */
export async function handleGitProxyRequest(
  c: Context<HonoEnv>,
  db: Db,
  tenantId: number,
  repoId: string,
  subPath: string,
  method: 'GET' | 'POST',
): Promise<Response> {
  const env = c.env as ProxyEnv;
  const secret = integrationCredentialSecret(env);
  const resolved = await resolveRepoCredential(db, secret, tenantId, repoId);
  if (isResolveError(resolved)) return c.json({ error: resolved.error }, resolved.status);

  return proxyGitSmartHttp(c, resolved.repo, resolved.token, subPath, method);
}

/**
 * Forward one smart-HTTP request to `repo` with `token` injected server-side. Every
 * mount calls this once it has authenticated the caller and resolved the repo.
 */
export async function proxyGitSmartHttp(
  c: Context,
  repo: ProxyRepo,
  token: string,
  subPath: string,
  method: 'GET' | 'POST',
): Promise<Response> {
  const result = await executeGitProxy({
    repo,
    token,
    subPath,
    method,
    query: method === 'GET' ? new URL(c.req.url).searchParams.toString() : undefined,
    contentType: c.req.header('Content-Type'),
    body: method === 'POST' ? await c.req.arrayBuffer() : undefined,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return result.response;
}
