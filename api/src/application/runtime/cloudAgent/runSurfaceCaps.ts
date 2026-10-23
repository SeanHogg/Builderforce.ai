/**
 * The capability set a cloud run holds, with the tenant's cost levers applied — the ONE
 * place the durable runner, its prep and the container `llm` op resolve it, so the
 * identity a run is issued, the schemas it is advertised and the services backing them
 * come from the same set and cannot drift.
 *
 * C5 (`c5_cloud_repo_map`) is the lever that adds a capability today: `repo.semantic`.
 * On the durable surface it is backed by `createCloudRepoSemantic` over the run's BASE
 * ref, so a run with no bound repository has nothing to back it and does not hold it —
 * never advertise a tool that is certain to fail.
 */
import type { Capability, RepoSemanticCapability } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { createCloudRepoSemantic } from '../../repos/cloudRepoMap';
import { cloudSurfaceCapsFor, containerSurfaceCapsFor } from '../cloudAgentTools';
import { delegationCaps, type CloudRunDelegation } from '../cloudRunDelegation';

/** The durable run's capability set: levers applied, `repo.semantic` only with a repo,
 *  then narrowed by its place in a delegation tree. */
export function durableRunCaps(
  env: unknown,
  tenantId: number,
  delegation: CloudRunDelegation | undefined,
  repoCtx: TicketRepoContext | null,
): ReadonlySet<Capability> {
  const levered = cloudSurfaceCapsFor(env, tenantId);
  const backed = repoCtx || !levered.has('repo.semantic')
    ? levered
    : new Set([...levered].filter((c) => c !== 'repo.semantic'));
  return delegationCaps(backed, delegation);
}

/** The capability set prep issues the run identity with and builds its prompt from. */
export function prepSurfaceCaps(env: unknown, tenantId: number, shell: boolean): ReadonlySet<Capability> {
  return shell ? containerSurfaceCapsFor(env, tenantId) : cloudSurfaceCapsFor(env, tenantId);
}

/** The durable surface's `repo.semantic` backing: the cloud repo map over the run's
 *  BASE branch (the cache holds across the run — see `cloudRepoMap.ts`). */
export function durableRepoSemantic(
  caps: ReadonlySet<Capability>,
  deps: { env: Env; tenantId: number; projectId: number; repoCtx: TicketRepoContext | null },
): RepoSemanticCapability | undefined {
  const { repoCtx } = deps;
  if (!caps.has('repo.semantic') || !repoCtx) return undefined;
  return createCloudRepoSemantic({
    env: deps.env, tenantId: deps.tenantId, projectId: deps.projectId,
    repo: { provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo, token: repoCtx.token, ref: repoCtx.base },
  });
}
