/**
 * knowledgeRepoGraph — {@link RepoGraphPort} over the cloud repo map (PRD 38 §4.5, code
 * pack on web hosts): the project's linked (default) repository is a knowledge root whose
 * code structure the server already holds per commit (`cloudRepoMap.ts`, R2 by sha), so a
 * web host gets the code pack's references without uploading the repository.
 *
 * Root id: `rootIdFor({ host: 'cloud', repoId })` — the PRD's `${host}:${repoId}` for the
 * repository root. The map is built from the repository's default branch.
 */
import { rootIdFor } from '@builderforce/agent-tools';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { commitShaFor, loadCloudRepoGraph, type CloudRepoMapDeps } from '../repos/cloudRepoMap';
import { resolveDefaultRepoForProject } from '../repos/resolveDefaultRepo';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import type { LinkedRepoRoot, RepoGraphPort } from './knowledgePorts';

export const linkedRepoRootId = (repoId: string): string => rootIdFor({ host: 'cloud', repoId, folderId: repoId });

export function cloudRepoGraphPort(env: Env, db: Db, tenantId: number, projectId: number): RepoGraphPort {
  let linked: Promise<LinkedRepoRoot | null> | null = null;
  const resolve = async (): Promise<LinkedRepoRoot | null> => {
    const ref = await resolveDefaultRepoForProject(db, tenantId, projectId);
    if (!ref) return null;
    const cred = await resolveRepoCredential(db, integrationCredentialSecret(env), tenantId, ref.repoId);
    if (isResolveError(cred)) return null;
    const deps: CloudRepoMapDeps = {
      env, tenantId, projectId,
      repo: {
        provider: cred.repo.provider, host: cred.repo.host, owner: cred.repo.owner, repo: cred.repo.repo,
        token: cred.token, ref: (cred.repo.defaultBranch ?? 'main').trim(),
      },
    };
    return {
      rootId: linkedRepoRootId(ref.repoId),
      async sha() {
        const r = await commitShaFor(deps);
        return r.ok ? r.sha : null;
      },
      async graph() {
        const r = await loadCloudRepoGraph(deps);
        return r.ok ? { graph: r.graph.graph.toJSON() } : null;
      },
    };
  };
  return { linked: () => (linked ??= resolve()) };
}
