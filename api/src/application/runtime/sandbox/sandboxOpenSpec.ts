/**
 * What the run sandbox is handed to open: the tokened clone URL for the ticket branch
 * (base on run #1), the per-run callback token its preview and timeline events use, the
 * cost-lever flags it obeys, and the live-preview plan.
 *
 * Extracted from the retired container launcher, which built the same world for a
 * container that ran its OWN loop. The sandbox runs none, so the prompts, the step budget
 * and the resume conversation are gone from it: the engine holds all three.
 *
 * Null when the run has nothing a sandbox can clone — no bound repository, or a provider
 * the Worker's git proxy does not serve. That run keeps the git-API tools and gets no
 * shell, which is what it had before (never advertise a tool certain to fail).
 */
import { integrationCredentialSecret } from '../../integrations/integrationCredentialSecret';
import { resolveTicketRepoContext, type TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { containerGitCloneUrl, mintContainerRunToken } from '../containerRunToken';
import { sandboxLevers } from '../costLoop/runLevers';
import { previewStepForRun, type PreviewDevServerStep } from '../previewDevServer';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';

export interface SandboxOpenSpec {
  executionId: number;
  internalBaseUrl: string;
  token: string;
  repo: { cloneUrl: string; baseBranch: string; headBranch: string };
  toolOutputPolicy: boolean;
  postEditChecks: boolean;
  preview?: PreviewDevServerStep;
}

/** Whether the Worker's git proxy can clone this repository for a sandbox. */
export function sandboxCanClone(repoCtx: Pick<TicketRepoContext, 'provider'> | null): boolean {
  return !!repoCtx && repoCtx.provider.startsWith('github');
}

export async function buildSandboxOpenSpec(
  env: Env,
  db: Db,
  run: { executionId: number; tenantId: number; projectId: number; taskId: number },
): Promise<SandboxOpenSpec | null> {
  const repo = await resolveTicketRepoContext(db, integrationCredentialSecret(env), run.tenantId, run.taskId);
  if (!repo.ok || !sandboxCanClone(repo.ctx)) return null;
  const token = await mintContainerRunToken(env.JWT_SECRET, run.executionId);
  const internalBaseUrl = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
  // Live preview: the port, the host-tuned config files, the env (project secrets) and the
  // ordered start candidates. Null while preview ingress is off or the plan lacks it.
  const preview = await previewStepForRun(env, db, run.tenantId, run.projectId);
  return {
    executionId: run.executionId,
    internalBaseUrl,
    token,
    // Clone the ticket's HEAD branch (where prior runs commit their work), falling back to
    // base on run #1 before the branch exists.
    repo: { cloneUrl: containerGitCloneUrl(internalBaseUrl, run.executionId, token), baseBranch: repo.ctx.base, headBranch: repo.ctx.branch },
    ...sandboxLevers(env, run.tenantId),
    ...(preview ? { preview } : {}),
  };
}
