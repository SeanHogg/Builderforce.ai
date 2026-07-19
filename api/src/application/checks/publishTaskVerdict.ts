/**
 * publishTaskVerdict — turn a platform verdict about a TASK into a visible
 * signal on that task's GitHub PR.
 *
 * This is the seam between "the platform decided something" and "a reviewer on
 * github.com can see it". Callers (the cloud-run finalizer, the QA sweep, the
 * security audit) hand over a verdict; this module does the tedious resolution —
 * find the open PR, resolve the best credential, get the current head SHA — and
 * delegates the actual publish to publishCheckRun, which picks Check Run vs
 * commit status based on what that credential is allowed to do.
 *
 * EVERYTHING HERE IS BEST-EFFORT BY DESIGN. A task may legitimately have no PR
 * (work not pushed yet), the repo may be GitLab, the App may not be installed.
 * None of those are errors worth failing the run that produced the verdict over,
 * so every path returns a tagged reason and nothing throws.
 */
import { findOpenPullRequestByTask } from '../repos/recordPullRequestRow';
import { getPullRequestDetail, invalidatePullRequestDetail } from '../repos/getPullRequestDetail';
import { resolveRepoAuth } from '../repos/githubClient';
import { publishCheckRun, type CheckAnnotation, type CheckConclusion } from './publishCheckRun';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * Check names are namespaced under a single prefix so the platform's verdicts
 * group together in the PR merge box and never collide with the repository's own
 * CI contexts. Changing a name orphans the previous one on in-flight PRs (GitHub
 * keys replacement on name/context), so these are effectively stable identifiers.
 */
const CHECK_PREFIX = 'Builderforce';

export const CHECK_NAMES = {
  agentRun: `${CHECK_PREFIX} · Agent run`,
  qa: `${CHECK_PREFIX} · QA exploration`,
  security: `${CHECK_PREFIX} · Security audit`,
} as const;

export type CheckName = (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES];

export interface TaskVerdict {
  name: CheckName;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: CheckConclusion;
  title: string;
  summary: string;
  text?: string;
  annotations?: CheckAnnotation[];
  detailsUrl?: string;
}

export type PublishVerdictOutcome =
  | { published: true; via: 'check_run' | 'commit_status'; degraded: boolean }
  | { published: false; reason: string };

/**
 * Resolve the secret used to decrypt integration credentials. Mirrors the
 * convention already established in pollPrCiStatus / handleCiEventOutcome —
 * INTEGRATION_ENCRYPTION_SECRET is the real key, JWT_SECRET the legacy fallback
 * for deployments predating that split.
 */
function credentialSecret(env: Env): string {
  return env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
}

export async function publishTaskVerdict(
  env: Env,
  db: Db,
  tenantId: number,
  taskId: number,
  verdict: TaskVerdict,
): Promise<PublishVerdictOutcome> {
  try {
    const pr = await findOpenPullRequestByTask(db, tenantId, taskId);
    if (!pr) return { published: false, reason: 'no open pull request for task' };
    if (!pr.repoId) return { published: false, reason: 'pull request row has no repo' };
    if (pr.number == null) return { published: false, reason: 'pull request has no provider number yet' };

    const auth = await resolveRepoAuth(env, db, credentialSecret(env), tenantId, pr.repoId);
    if (!auth.ok) return { published: false, reason: auth.error };
    if (auth.auth.repo.provider !== 'github') {
      return { published: false, reason: `provider '${auth.auth.repo.provider}' has no checks API` };
    }

    // A check must target the CURRENT head. getPullRequestDetail is cached for
    // 30s keyed on the PR row's updatedAt, and an agent that just pushed will
    // very often be inside that window — posting to the pre-push SHA would put
    // the check on a commit no longer in the PR, where nobody ever sees it.
    // Busting first costs one extra request and removes that whole failure mode.
    const versionToken = String(Date.now());
    await invalidatePullRequestDetail(env, pr.id, versionToken).catch(() => {});
    const detail = await getPullRequestDetail(env, pr.id, versionToken, {
      provider: auth.auth.repo.provider,
      host: auth.auth.coords.host,
      owner: auth.auth.coords.owner,
      repo: auth.auth.coords.repo,
      token: auth.auth.token,
      number: pr.number,
    });

    if (!detail.headSha) {
      return { published: false, reason: detail.error ?? 'could not resolve PR head SHA' };
    }

    const result = await publishCheckRun(auth.auth, {
      name: verdict.name,
      headSha: detail.headSha,
      status: verdict.status,
      conclusion: verdict.conclusion,
      title: verdict.title,
      summary: verdict.summary,
      text: verdict.text,
      annotations: verdict.annotations,
      detailsUrl: verdict.detailsUrl,
    });

    if (!result.ok) return { published: false, reason: result.reason };
    return { published: true, via: result.via, degraded: result.degraded };
  } catch (e) {
    // Publishing a verdict must never take down the run that produced it.
    return { published: false, reason: (e as Error).message };
  }
}

/**
 * Convenience wrapper for the most common case: an agent run finished and we
 * want that outcome on the PR.
 *
 * `status` here is the platform's execution status, mapped onto GitHub's
 * conclusion vocabulary. Note `cancelled` maps to `cancelled` rather than
 * `failure` — a human stopping a run is not a red build, and marking it as one
 * would train reviewers to ignore the check.
 */
export async function publishAgentRunVerdict(
  env: Env,
  db: Db,
  tenantId: number,
  taskId: number,
  run: {
    executionId: number;
    outcome: 'completed' | 'failed' | 'cancelled';
    summary: string;
    filesChanged?: string[];
    appBaseUrl?: string | null;
  },
): Promise<PublishVerdictOutcome> {
  const conclusion: CheckConclusion =
    run.outcome === 'completed' ? 'success' : run.outcome === 'cancelled' ? 'cancelled' : 'failure';

  const files = run.filesChanged ?? [];
  const fileList = files.length
    ? `\n\n**Files changed (${files.length})**\n${files.slice(0, 50).map((f) => `- \`${f}\``).join('\n')}${
        files.length > 50 ? `\n- …and ${files.length - 50} more` : ''
      }`
    : '';

  return publishTaskVerdict(env, db, tenantId, taskId, {
    name: CHECK_NAMES.agentRun,
    status: 'completed',
    conclusion,
    title:
      run.outcome === 'completed'
        ? `Agent run completed${files.length ? ` · ${files.length} file(s) changed` : ''}`
        : run.outcome === 'cancelled'
          ? 'Agent run cancelled'
          : 'Agent run failed',
    summary: run.summary,
    text: fileList || undefined,
    detailsUrl: run.appBaseUrl ? `${run.appBaseUrl}/executions/${run.executionId}` : undefined,
  });
}
