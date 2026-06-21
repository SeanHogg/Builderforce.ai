/**
 * resolveRepoCredential — the single source of truth for turning a
 * `project_repositories.id` into (a) the repo's provider coordinates and (b) the
 * decrypted git token for the tenant's linked integration credential.
 *
 * Both the git smart-HTTP proxy (browser isomorphic-git) and the server-side PR
 * opener need exactly this resolution; keeping it in one place means the
 * credential-decrypt path and the tenant-scoping guard never drift between them
 * (DRY — the token must be resolved identically wherever it is used).
 *
 * The token is NEVER returned to the browser; callers use it server-side only
 * (proxy header injection, or a direct provider API call).
 */
import { and, eq } from 'drizzle-orm';
import { projectRepositories, integrationCredentials } from '../../infrastructure/database/schema';
import { decryptCredentials } from '../boardsync/drizzleStore';
import type { Db } from '../../infrastructure/database/connection';

export interface ResolvedRepoCredential {
  repo: {
    id: string;
    provider: string;
    host: string | null;
    owner: string;
    repo: string;
    defaultBranch: string | null;
    projectId: number;
    segmentId: string | null;
  };
  token: string;
}

export interface ResolveRepoCredentialError {
  error: string;
  status: 400 | 404;
}

export function isResolveError(
  v: ResolvedRepoCredential | ResolveRepoCredentialError,
): v is ResolveRepoCredentialError {
  return 'error' in v;
}

/**
 * Resolve a repo + its decrypted git token, scoped to `tenantId`. Returns a
 * tagged error (with an HTTP status) rather than throwing so route handlers can
 * map it directly. `secret` is the integration-encryption secret (falls back to
 * JWT_SECRET at the call site, mirroring how credentials were encrypted).
 */
export async function resolveRepoCredential(
  db: Db,
  secret: string,
  tenantId: number,
  repoId: string,
): Promise<ResolvedRepoCredential | ResolveRepoCredentialError> {
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

  const creds = await decryptCredentials(cred.credentialsEnc, cred.iv, secret, tenantId);
  const token =
    (creds?.accessToken as string | undefined) ??
    (creds?.apiToken as string | undefined) ??
    (creds?.token as string | undefined);
  if (!token) return { error: 'Credential has no usable token', status: 400 };

  return {
    repo: {
      id: repo.id,
      provider: repo.provider,
      host: repo.host,
      owner: repo.owner,
      repo: repo.repo,
      defaultBranch: repo.defaultBranch,
      projectId: repo.projectId,
      segmentId: repo.segmentId,
    },
    token,
  };
}
