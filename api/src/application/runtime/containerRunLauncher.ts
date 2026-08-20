/**
 * Starting (or RE-starting) a run on the long-lived Cloudflare Container.
 *
 * Extracted because there are now two callers and the shape must be identical for
 * both: the dispatch path (`runtimeRoutes` → first launch) and the resume path
 * (`executionResume` → relaunch after an `ask_human` pause). Everything the image
 * needs to be handed — the shell-variant prompts, the per-run callback token, the
 * tokened clone URL for its local workspace, the step budget — is assembled here
 * once, so a resumed container run cannot be given a subtly different world than
 * the run it continues.
 *
 * The only difference between the two is `resume`: a relaunch carries the paused
 * conversation, so the image seeds its loop from that instead of from the task
 * prompt. The repo state does NOT need carrying — the container commits every file
 * through the Worker onto the ticket branch, so a fresh clone of that branch IS the
 * work in progress.
 *
 * Deliberately returns a verdict instead of throwing: the caller decides what a
 * failed kickoff means (dispatch degrades to the durable executor; resume leaves
 * the run parked and answerable).
 */
import { CONTAINER_MAX_STEPS } from './cloudAgentTools';
import { previewStepForRun } from './previewDevServer';
import { containerGitCloneUrl, mintContainerRunToken } from './containerRunToken';
import { gitSecret, prepareCloudRun, stampExecutionSourceRef } from './cloudAgentEngine';
import { resolveTicketRepoContext } from '../repos/commitFileAsPendingChange';
import type { PausedLoopState } from './executionPause';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ResolvedArtifacts } from '../../domain/shared/types';

/** Just enough of a Durable Object stub to POST the run — keeps this module
 *  testable without a live binding. */
export interface ContainerRunTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * The floor on a RESUMED run's step budget. A question asked on step 38 of 40
 * would otherwise resume with two steps — not enough to read the answer, act on it
 * and finish, so the run would burn the human's answer and then die on the step
 * cap. Small enough that repeated pausing cannot mint unlimited budget.
 */
export const MIN_RESUMED_CONTAINER_STEPS = 8;

export type ContainerLaunchResult =
  | { ok: true }
  | { ok: false; reason: string; status?: number };

export async function launchContainerRun(
  env: Env,
  db: Db,
  stub: ContainerRunTarget,
  args: {
    tenantId: number;
    executionId: number;
    taskRow: { id: number; title: string; description: string | null; projectId: number };
    agentLabel: string;
    model?: string | undefined;
    cloudAgentRef?: string | undefined;
    artifacts?: ResolvedArtifacts | undefined;
    payload?: string | undefined;
    /** Present only on a resume — the conversation the previous process exited with. */
    resume?: PausedLoopState | null;
  },
): Promise<ContainerLaunchResult> {
  try {
    const { systemPrompt, userContent } = await prepareCloudRun(
      env, db, args.executionId,
      { id: args.taskRow.id, title: args.taskRow.title, description: args.taskRow.description },
      args.tenantId, args.taskRow.projectId, args.agentLabel, args.model, args.artifacts,
      args.cloudAgentRef, args.payload,
      { shell: true },
    );
    const token = await mintContainerRunToken(env.JWT_SECRET, args.executionId);
    const repo = await resolveTicketRepoContext(db, gitSecret(env), args.tenantId, args.taskRow.id);
    if (repo.ok) await stampExecutionSourceRef(db, args.tenantId, args.executionId, repo.ctx);
    // Clone the ticket's HEAD branch (ctx.branch — where prior runs commit their
    // WIP), not just the base. A container that clones only the base branch starts
    // every run from a stale default and cannot see earlier passes' work; carrying
    // headBranch lets the container check it out and fall back to base on run #1
    // when the branch doesn't exist yet.
    const internalBaseUrl = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
    const cloneSpec = repo.ok && repo.ctx.provider.startsWith('github')
      ? { cloneUrl: containerGitCloneUrl(internalBaseUrl, args.executionId, token), baseBranch: repo.ctx.base, headBranch: repo.ctx.branch }
      : null;
    const maxSteps = args.resume
      ? Math.max(MIN_RESUMED_CONTAINER_STEPS, CONTAINER_MAX_STEPS - args.resume.step)
      : CONTAINER_MAX_STEPS;
    // Live preview: everything the image needs to start a dev server on PREVIEW_PORT —
    // the port, the host-tuned config files to write (Vite `allowedHosts` + `hmr`
    // pointing at the public origin, Metro's packager host), the env, and the ordered
    // start candidates. `null` while PREVIEW_INGRESS_ENABLED is unset, and omitted from
    // the body entirely in that case, so an existing run is launched byte-identically.
    const preview = previewStepForRun(env);
    const res = await stub.fetch('https://agent-container/run', {
      method: 'POST',
      body: JSON.stringify({
        executionId: args.executionId,
        internalBaseUrl,
        token,
        systemPrompt,
        userContent,
        maxSteps,
        repo: cloneSpec,
        ...(preview ? { preview } : {}),
        ...(args.resume ? { resume: { messages: args.resume.messages, writtenPaths: args.resume.writtenPaths } } : {}),
      }),
    });
    if (!res.ok) return { ok: false, reason: `AgentContainerDO /run ${res.status}`, status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
