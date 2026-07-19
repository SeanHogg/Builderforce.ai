/**
 * publishCheckRun — write the platform's own verdicts back onto the GitHub PR.
 *
 * WHY THIS EXISTS
 * The platform reads CI heavily (webhooks → ingestRepoCiEvent, pollPrCiStatus,
 * fetchBuildError) but never wrote anything back. Every verdict it produces —
 * agent run outcome, QA exploration findings, security audit results — lived
 * only in the Builderforce UI. A reviewer looking at the PR on github.com saw
 * nothing, so the agent's work was invisible exactly where the merge decision
 * actually gets made.
 *
 * ── The App-only constraint (the load-bearing detail) ────────────────────────
 * The Checks API (`POST /repos/{o}/{r}/check-runs`) requires the `checks:write`
 * permission, which ONLY a GitHub App installation token carries. A user PAT or
 * OAuth token gets a flat 403 "Resource not accessible by integration" — this is
 * not a scope you can request on a PAT, it does not exist for user tokens.
 *
 * Since GitHub App configuration is optional here (see githubClient.resolveRepoAuth),
 * a check-run-only implementation would silently do nothing for every tenant that
 * has not installed the App — i.e. all of them, on day one. So this module
 * publishes through whichever API the resolved credential can actually use:
 *
 *   App installation token  → Check Run   (rich: title, markdown body, annotations)
 *   User PAT / OAuth token  → Commit Status (degraded: 140-char description + URL)
 *
 * Both render in the PR's merge box. The commit-status path loses annotations and
 * the markdown body, which is a real downgrade — but a visible degraded verdict
 * beats an invisible rich one, and it means this feature ships before the App
 * rollout completes rather than after.
 */
import { githubRequest, repoPath, type GitHubCoords, type ResolvedRepoAuth } from '../repos/githubClient';

/** GitHub's terminal conclusions for a check run. */
export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required';

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
}

export interface CheckRunInput {
  /** Shown as the check's name in the PR merge box. Namespaced so the platform's
   *  checks are visually grouped and never collide with the repo's own CI. */
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  /** Required when status is 'completed'; ignored otherwise. */
  conclusion?: CheckConclusion;
  title: string;
  summary: string;
  /** Markdown body. Check Runs only — dropped on the commit-status path. */
  text?: string;
  /** Deep link back into the platform (the run, the audit, the QA report). */
  detailsUrl?: string;
  /** Inline file annotations. Check Runs only. */
  annotations?: CheckAnnotation[];
}

export type PublishCheckResult =
  | { ok: true; via: 'check_run' | 'commit_status'; id: number | null; degraded: boolean }
  | { ok: false; code: string; reason: string };

/**
 * GitHub caps annotations at 50 per request. Exceeding it fails the WHOLE call,
 * so the first batch goes with the create and the rest follow as updates.
 */
const MAX_ANNOTATIONS_PER_REQUEST = 50;

/** Commit-status descriptions are truncated by GitHub at 140 chars. */
const STATUS_DESCRIPTION_LIMIT = 140;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Map a check conclusion onto the much coarser commit-status state.
 * `neutral`/`cancelled` have no status equivalent; they become `success` rather
 * than `failure` because a skipped or non-applicable check must never block a
 * merge — treating "we had nothing to say" as a red X would be actively wrong.
 */
export function conclusionToStatusState(c: CheckConclusion | undefined): 'success' | 'failure' | 'pending' | 'error' {
  switch (c) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'timed_out':
    case 'action_required':
      return 'error';
    case 'neutral':
    case 'cancelled':
      return 'success';
    default:
      return 'pending';
  }
}

function toGitHubAnnotation(a: CheckAnnotation) {
  return {
    path: a.path,
    start_line: a.startLine,
    end_line: a.endLine,
    annotation_level: a.level,
    message: a.message,
    ...(a.title ? { title: a.title } : {}),
  };
}

/**
 * Publish a verdict to the PR head commit, choosing the richest API the resolved
 * credential is permitted to use. Never throws — a failure to annotate a PR must
 * not fail the run that produced the verdict.
 */
export async function publishCheckRun(
  auth: ResolvedRepoAuth,
  input: CheckRunInput,
  fetchFn: typeof fetch = fetch,
): Promise<PublishCheckResult> {
  if (auth.repo.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `checks not supported for provider '${auth.repo.provider}'` };
  }

  return auth.authKind === 'app_installation'
    ? publishAsCheckRun(auth.coords, auth.token, input, fetchFn)
    : publishAsCommitStatus(auth.coords, auth.token, input, fetchFn);
}

async function publishAsCheckRun(
  coords: GitHubCoords,
  token: string,
  input: CheckRunInput,
  fetchFn: typeof fetch,
): Promise<PublishCheckResult> {
  const all = input.annotations ?? [];
  const first = all.slice(0, MAX_ANNOTATIONS_PER_REQUEST);
  const rest = all.slice(MAX_ANNOTATIONS_PER_REQUEST);

  const created = await githubRequest<{ id: number }>({
    coords,
    token,
    path: repoPath(coords, '/check-runs'),
    method: 'POST',
    fetchFn,
    body: {
      name: input.name,
      head_sha: input.headSha,
      status: input.status,
      ...(input.status === 'completed' && input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: {
        title: truncate(input.title, 255),
        summary: input.summary,
        ...(input.text ? { text: input.text } : {}),
        ...(first.length ? { annotations: first.map(toGitHubAnnotation) } : {}),
      },
    },
  });

  if (!created.ok) return { ok: false, code: created.code, reason: created.reason };

  // Remaining annotation batches are best-effort: the check itself already
  // exists and carries the verdict, so a failure here degrades detail, not
  // correctness. Sequential rather than parallel to stay inside the Worker
  // subrequest budget and GitHub's secondary rate limits.
  for (let i = 0; i < rest.length; i += MAX_ANNOTATIONS_PER_REQUEST) {
    const batch = rest.slice(i, i + MAX_ANNOTATIONS_PER_REQUEST);
    const updated = await githubRequest({
      coords,
      token,
      path: repoPath(coords, `/check-runs/${created.data.id}`),
      method: 'PATCH',
      fetchFn,
      body: {
        output: {
          title: truncate(input.title, 255),
          summary: input.summary,
          annotations: batch.map(toGitHubAnnotation),
        },
      },
    });
    if (!updated.ok) {
      console.warn(`[checks] annotation batch ${i / MAX_ANNOTATIONS_PER_REQUEST + 2} failed: ${updated.reason}`);
      break;
    }
  }

  return { ok: true, via: 'check_run', id: created.data.id, degraded: false };
}

async function publishAsCommitStatus(
  coords: GitHubCoords,
  token: string,
  input: CheckRunInput,
  fetchFn: typeof fetch,
): Promise<PublishCheckResult> {
  // A queued/in-progress check maps to `pending`; only a completed one carries a
  // real conclusion.
  const state = input.status === 'completed' ? conclusionToStatusState(input.conclusion) : 'pending';

  const res = await githubRequest<{ id: number }>({
    coords,
    token,
    path: repoPath(coords, `/statuses/${encodeURIComponent(input.headSha)}`),
    method: 'POST',
    fetchFn,
    body: {
      state,
      // `context` is the status's identity — GitHub replaces same-context
      // statuses on the same SHA rather than appending, which is what makes
      // queued → completed transitions update in place instead of stacking.
      context: input.name,
      description: truncate(input.title, STATUS_DESCRIPTION_LIMIT),
      ...(input.detailsUrl ? { target_url: input.detailsUrl } : {}),
    },
  });

  if (!res.ok) return { ok: false, code: res.code, reason: res.reason };
  return { ok: true, via: 'commit_status', id: res.data?.id ?? null, degraded: true };
}
