/**
 * The capability set a cloud run holds, with the tenant's cost levers applied — the ONE
 * place the engine and its prep resolve it, so the identity a run is issued, the schemas
 * it is advertised and the services backing them come from the same set and cannot drift.
 *
 * There is one set for every cloud run. A run with a SANDBOX (`sandbox/runSandbox.ts`)
 * also holds what the sandbox backs (`shell`: `run_command`, the git tools,
 * `analyze_codebase`) — on every plan; the plan decides only what the run is charged.
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
import { cloudSurfaceCapsFor } from '../cloudAgentTools';
import { SANDBOX_CAPABILITIES } from '../sandbox/sandboxProvider';
import { delegationCaps, type CloudRunDelegation } from '../cloudRunDelegation';

/** The run's capability set: levers applied, the sandbox's capabilities when it has one,
 *  `repo.semantic` only with a repo, then narrowed by its place in a delegation tree. */
export function durableRunCaps(
  env: unknown,
  tenantId: number,
  delegation: CloudRunDelegation | undefined,
  repoCtx: TicketRepoContext | null,
  sandboxed = false,
): ReadonlySet<Capability> {
  const levered = prepSurfaceCaps(env, tenantId, sandboxed);
  const backed = repoCtx || !levered.has('repo.semantic')
    ? levered
    : new Set([...levered].filter((c) => c !== 'repo.semantic'));
  return delegationCaps(backed, delegation);
}

/** The capability set prep issues the run identity with and builds its prompt from. */
export function prepSurfaceCaps(env: unknown, tenantId: number, sandboxed: boolean): ReadonlySet<Capability> {
  const base = cloudSurfaceCapsFor(env, tenantId);
  return sandboxed ? new Set<Capability>([...base, ...SANDBOX_CAPABILITIES]) : base;
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
