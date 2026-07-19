/**
 * githubActionsDispatch — queue an agent run onto a repo's GitHub Actions runners.
 *
 * This is the outbound half of the Actions surface; the inbound half is
 * presentation/routes/githubActionsRoutes.ts. See that file's header for why the
 * surface exists and why its trust model is OIDC rather than a shared secret.
 *
 * The container surface can PROVE liveness before committing a run to it
 * (probeContainerHealth hits a live process). Nothing equivalent exists here: an
 * Actions runner does not exist until GitHub schedules one, so the only
 * meaningful pre-flight is "can this run be QUEUED" — i.e. the repo is a GitHub
 * repo, we hold a credential that can dispatch, and the agent workflow is
 * actually present on the default branch. That is what {@link githubActionsAvailable}
 * answers, and it is why chooseCloudExecutor takes an availability flag for this
 * surface instead of a health flag.
 */
import { githubRequest, repoPath, resolveRepoAuth } from '../repos/githubClient';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { AGENT_WORKFLOW_PATH, renderAgentWorkflow } from './githubActionsWorkflow';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { resolveAppBaseUrl } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Just the workflow file's basename — the dispatch endpoint keys on it. */
const WORKFLOW_FILE = AGENT_WORKFLOW_PATH.split('/').pop() as string;

function credentialSecret(env: Env): string {
  return env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
}

export type ActionsDispatchResult =
  | { ok: true; queued: true }
  | { ok: false; code: string; reason: string };

/**
 * Is the agent workflow present in this repo?
 *
 * Cached: this is consulted on the dispatch hot path, the answer changes only
 * when someone (re-)enables the surface, and a miss costs a GitHub subrequest
 * inside a Worker with a tight budget. Invalidated by {@link ensureAgentWorkflow}
 * on write, so enabling the surface takes effect immediately rather than after
 * a TTL.
 */
export async function githubActionsAvailable(
  env: Env,
  db: Db,
  tenantId: number,
  repoId: string,
): Promise<boolean> {
  return getOrSetCached(
    env,
    workflowPresenceKey(tenantId, repoId),
    async () => {
      const auth = await resolveRepoAuth(env, db, credentialSecret(env), tenantId, repoId);
      if (!auth.ok || auth.auth.repo.provider !== 'github') return false;

      const res = await githubRequest<{ path: string }>({
        coords: auth.auth.coords,
        token: auth.auth.token,
        path: repoPath(auth.auth.coords, `/contents/${AGENT_WORKFLOW_PATH}`),
      });
      return res.ok;
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  ).catch(() => false);
}

function workflowPresenceKey(tenantId: number, repoId: string): string {
  return `gh-actions-workflow:t:${tenantId}:r:${repoId}`;
}

/**
 * Write (or refresh) the agent workflow into the repo's default branch.
 *
 * NOTE ON PERMISSIONS — this is the step most likely to fail in the field.
 * Committing a file under `.github/workflows/` requires the `workflow` scope on
 * a user PAT, or `workflows: write` on the GitHub App installation. Both are
 * separate from ordinary `contents` write, and a credential that can push code
 * perfectly well will still be refused here. The 403 is surfaced verbatim rather
 * than being flattened into a generic failure, because "add the workflow scope"
 * is the only useful thing the operator can be told.
 */
export async function ensureAgentWorkflow(
  env: Env,
  db: Db,
  tenantId: number,
  repoId: string,
): Promise<{ ok: true; created: boolean } | { ok: false; code: string; reason: string }> {
  const auth = await resolveRepoAuth(env, db, credentialSecret(env), tenantId, repoId);
  if (!auth.ok) return { ok: false, code: 'unresolved', reason: auth.error };
  if (auth.auth.repo.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `provider '${auth.auth.repo.provider}' has no Actions` };
  }

  const content = renderAgentWorkflow({ apiOrigin: resolveAppBaseUrl(env) });

  // Fetch the existing file's blob SHA — the contents API needs it to update
  // rather than reject with a 409. Absence simply means "create".
  const existing = await githubRequest<{ sha: string; content: string }>({
    coords: auth.auth.coords,
    token: auth.auth.token,
    path: repoPath(auth.auth.coords, `/contents/${AGENT_WORKFLOW_PATH}`),
  });

  const put = await githubRequest<{ content: unknown }>({
    coords: auth.auth.coords,
    token: auth.auth.token,
    path: repoPath(auth.auth.coords, `/contents/${AGENT_WORKFLOW_PATH}`),
    method: 'PUT',
    body: {
      message: 'chore: add Builderforce agent workflow',
      content: btoa(unescape(encodeURIComponent(content))),
      ...(existing.ok && existing.data?.sha ? { sha: existing.data.sha } : {}),
      ...(auth.auth.repo.defaultBranch ? { branch: auth.auth.repo.defaultBranch } : {}),
    },
  });

  if (!put.ok) return { ok: false, code: put.code, reason: put.reason };

  // The presence cache would otherwise keep saying "absent" for up to 5 minutes
  // after the operator enabled the surface.
  await invalidateCached(env, workflowPresenceKey(tenantId, repoId)).catch(() => {});
  return { ok: true, created: !existing.ok };
}

/**
 * Fire the workflow for one execution.
 *
 * `workflow_dispatch` returns 204 with no body: it means "accepted into the
 * queue", NOT "a runner started" and certainly not "the run succeeded". Nothing
 * downstream should treat a successful dispatch as progress — the run only
 * becomes real when the runner's first heartbeat arrives, which is precisely why
 * this surface needs its own (much larger) orphan-reaper ceiling. See
 * CLOUD_GITHUB_ACTIONS_SILENCE_MS in orphanReasons.ts.
 */
export async function dispatchGithubActionsRun(
  env: Env,
  db: Db,
  args: { tenantId: number; taskId: number; executionId: number; ref?: string },
): Promise<ActionsDispatchResult> {
  const defaultRepo = await resolveDefaultRepoForTask(db, args.tenantId, args.taskId);
  if (!defaultRepo) return { ok: false, code: 'no_repo', reason: 'no repository linked to this task' };

  const auth = await resolveRepoAuth(env, db, credentialSecret(env), args.tenantId, defaultRepo.repoId);
  if (!auth.ok) return { ok: false, code: 'unresolved', reason: auth.error };
  if (auth.auth.repo.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `provider '${auth.auth.repo.provider}' has no Actions` };
  }

  const ref = args.ref ?? auth.auth.repo.defaultBranch ?? 'main';

  const res = await githubRequest<undefined>({
    coords: auth.auth.coords,
    token: auth.auth.token,
    path: repoPath(auth.auth.coords, `/actions/workflows/${WORKFLOW_FILE}/dispatches`),
    method: 'POST',
    body: {
      ref,
      // workflow_dispatch inputs are strings on the wire regardless of declared
      // type; the runner parses.
      inputs: { execution_id: String(args.executionId) },
    },
  });

  if (!res.ok) {
    // 404 here almost always means the workflow file is missing on `ref` rather
    // than the repo being absent — GitHub does not distinguish. Say so, because
    // "run ensureAgentWorkflow" is the fix and the raw 404 does not suggest it.
    if (res.status === 404) {
      return {
        ok: false,
        code: 'workflow_missing',
        reason: `${AGENT_WORKFLOW_PATH} not found on '${ref}' — enable the GitHub Actions surface for this repo first`,
      };
    }
    return { ok: false, code: res.code, reason: res.reason };
  }

  return { ok: true, queued: true };
}
