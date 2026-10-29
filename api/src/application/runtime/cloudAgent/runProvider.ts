/**
 * The run's capability provider, composed in ONE place: the surface's built provider,
 * then the IDE workspace (a repo-less project's working tree), then the sandbox (the
 * shell and the clone), then the caller's decoration (rehearsal's shadow). The engine
 * calls this once per tick instead of growing each layer inline.
 *
 * The layers are ordered by what they back: the IDE workspace replaces the repo for a
 * project that has none; the sandbox sits over whichever repo backing remains, so its
 * reads fall back to it and its writes commit through it; a decoration sees the final
 * provider, so a rehearsal's shadow covers sandbox-mirrored writes too.
 */
import type { CapabilityProvider } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import type { WrittenFileHashes } from './writtenFileHashes';
import { withIdeWorkspace } from './ideWorkspaceProvider';
import { resolveIdeWorkspaceForRun } from './ideWorkspaceCoding';
import { sandboxShell, withSandbox } from '../sandbox/sandboxProvider';
import type { RunSandbox } from '../sandbox/runSandbox';
import type { VerifyShell } from '../sandbox/sandboxVerify';

export interface RunProviderArgs {
  env: Env;
  db: Db;
  built: CapabilityProvider;
  repoCtx: TicketRepoContext | null;
  run: { tenantId: number; taskId: number; executionId: number; agentLabel: string; cloudAgentRef?: string; writtenPaths: Set<string>; writtenHashes?: WrittenFileHashes };
  sandbox?: RunSandbox;
  /** The run's cancel signal (kills a running sandbox command). */
  signal: AbortSignal;
  /** Proves the run alive during a long sandbox command. */
  heartbeat: () => Promise<unknown>;
  decorate?: (provider: CapabilityProvider) => CapabilityProvider;
}

export interface RunProvider {
  provider: CapabilityProvider;
  /** The sandbox shell the run-end verify runs through (heartbeat + cancel), when sandboxed. */
  verify?: { sandbox: RunSandbox; shell: VerifyShell };
}

export async function composeRunProvider(a: RunProviderArgs): Promise<RunProvider> {
  const { env, db, built, repoCtx, run } = a;
  const ideWorkspace = repoCtx ? null : await resolveIdeWorkspaceForRun(env, db, run.tenantId, run.taskId);
  const backed = ideWorkspace
    ? withIdeWorkspace(built, ideWorkspace, {
      tenantId: run.tenantId, taskId: run.taskId, executionId: run.executionId, agentLabel: run.agentLabel,
      ...(run.cloudAgentRef ? { cloudAgentRef: run.cloudAgentRef } : {}), writtenPaths: run.writtenPaths,
      ...(run.writtenHashes ? { writtenHashes: run.writtenHashes } : {}),
    }, { env, db })
    : built;
  if (!a.sandbox) return { provider: a.decorate ? a.decorate(backed) : backed };
  const shellOpts = { signal: a.signal, heartbeat: a.heartbeat, ...(repoCtx?.branch ? { trackedBranch: repoCtx.branch } : {}) };
  const sandboxed = withSandbox(backed, a.sandbox, shellOpts);
  return {
    provider: a.decorate ? a.decorate(sandboxed) : sandboxed,
    verify: { sandbox: a.sandbox, shell: sandboxShell(a.sandbox, shellOpts) },
  };
}
