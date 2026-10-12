/**
 * pollCommitCiStatus — in-run CI for the durable cloud loop (ticket #3092).
 *
 * The Worker has no shell, so it cannot `npm test`. What it CAN do is the same
 * HTTP the rest of the product already uses for a PR's CI light: combined commit
 * status (and, on GitHub, check-runs — Actions often never publish a commit
 * status). `run_checks` and the pre-finish gate poll the ticket-branch HEAD so
 * a red or still-running build is visible BEFORE finish, instead of only after
 * the PR opens and a webhook auto-fix run starts.
 *
 * Never throws. An unreachable provider, a missing SHA, or a repo with no
 * checks configured all degrade to `{ status: 'none' }` so a finish is not
 * deadlocked on a network blip. PR-only workflows (`on: pull_request`) also
 * report `none` until a PR exists — webhook auto-fix + automerge-on-green stay
 * the backstop for that case.
 */
import { resolveRepoRefSha } from '../repos/commitFileToRepo';
import { collapseBitbucketBuildStates, resolveRepoApiTarget } from '../repos/repoApiTarget';

export type CommitCiStatus = 'success' | 'failure' | 'pending' | 'none';

export interface CommitCiVerdict {
  status: CommitCiStatus;
  sha: string;
  count: number;
  /** One-line, safe to put in a tool result or finish-block. */
  summary: string;
  url?: string | null;
  failed: string[];
}

/** Cap on finish attempts blocked because branch CI is still running. Durable
 *  ticks are one LLM call each, so waiting forever would burn the run. */
export const MAX_CI_PENDING_FINISH_BLOCKS = 2;
/** Cap on finish attempts blocked because branch CI is red. Automerge-on-green
 *  and the webhook auto-fix loop remain the backstop after we relent. */
export const MAX_CI_FAILURE_FINISH_BLOCKS = 3;

const NONE: Omit<CommitCiVerdict, 'sha' | 'summary'> = { status: 'none', count: 0, failed: [] };

function headersFor(flavor: string, token: string): Record<string, string> {
  if (flavor === 'github') {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BuilderForce-CI/1.0',
    };
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'BuilderForce-CI/1.0',
  };
}

function shortSha(sha: string): string {
  return sha ? sha.slice(0, 7) : 'HEAD';
}

function rank(status: CommitCiStatus): number {
  return status === 'failure' ? 3 : status === 'pending' ? 2 : status === 'success' ? 1 : 0;
}

function mergeParts(sha: string, parts: Array<{ status: CommitCiStatus; count: number; failed: string[]; url?: string | null }>): CommitCiVerdict {
  let status: CommitCiStatus = 'none';
  let count = 0;
  const failed: string[] = [];
  let url: string | null = null;
  for (const p of parts) {
    if (p.status === 'none' && p.count === 0) continue;
    count += p.count;
    failed.push(...p.failed);
    if (!url && p.url) url = p.url;
    if (rank(p.status) > rank(status)) status = p.status;
  }
  return {
    status,
    sha,
    count,
    failed,
    url,
    summary: formatSummary(status, sha, count, failed),
  };
}

function formatSummary(status: CommitCiStatus, sha: string, count: number, failed: string[]): string {
  const short = shortSha(sha);
  if (status === 'none') return `No CI checks on ${short} yet.`;
  if (status === 'success') return `CI green on ${short} (${count} check(s)).`;
  if (status === 'pending') return `CI pending on ${short} (${count} check(s)).`;
  return `CI failed on ${short} (${count} check(s))${failed.length ? `: ${failed.join(', ')}` : ''}.`;
}

type PartialResult = { status: CommitCiStatus; count: number; failed: string[]; url?: string | null };

function parseGithubCombined(body: unknown): PartialResult {
  const b = body as { state?: string; total_count?: number; statuses?: Array<{ state?: string; context?: string; target_url?: string }> } | null;
  const statuses = Array.isArray(b?.statuses) ? b!.statuses! : [];
  const count = typeof b?.total_count === 'number' ? b.total_count : statuses.length;
  if (count === 0 && statuses.length === 0) return { ...NONE };
  const failed = statuses.filter((s) => {
    const st = (s.state ?? '').toLowerCase();
    return st === 'failure' || st === 'error';
  }).map((s) => s.context || 'status');
  const state = (b?.state ?? '').toLowerCase();
  const status: CommitCiStatus =
    state === 'failure' || state === 'error' ? 'failure'
      : state === 'pending' ? 'pending'
        : state === 'success' ? 'success'
          : failed.length ? 'failure' : 'none';
  return { status, count: count || statuses.length, failed, url: statuses[0]?.target_url ?? null };
}

const GH_CHECK_FAILURE = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'stale']);

function parseGithubCheckRuns(body: unknown): PartialResult {
  const runs = Array.isArray((body as { check_runs?: unknown[] } | null)?.check_runs)
    ? (body as { check_runs: Array<{ name?: string; status?: string; conclusion?: string | null; html_url?: string }> }).check_runs
    : [];
  if (runs.length === 0) return { ...NONE };
  const failed = runs.filter((r) => GH_CHECK_FAILURE.has((r.conclusion ?? '').toLowerCase()));
  if (failed.length) {
    return { status: 'failure', count: runs.length, failed: failed.map((r) => r.name || 'check'), url: failed[0]?.html_url ?? null };
  }
  if (runs.some((r) => (r.status ?? '').toLowerCase() !== 'completed')) {
    return { status: 'pending', count: runs.length, failed: [], url: runs[0]?.html_url ?? null };
  }
  return { status: 'success', count: runs.length, failed: [], url: runs[0]?.html_url ?? null };
}

function parseGitlabStatuses(body: unknown): PartialResult {
  const rows = Array.isArray(body) ? body as Array<{ status?: string; name?: string; target_url?: string }> : [];
  if (rows.length === 0) return { ...NONE };
  const failed = rows.filter((r) => {
    const st = (r.status ?? '').toLowerCase();
    return st === 'failed' || st === 'canceled' || st === 'cancelled';
  });
  if (failed.length) {
    return { status: 'failure', count: rows.length, failed: failed.map((r) => r.name || 'job'), url: failed[0]?.target_url ?? null };
  }
  const pending = new Set(['pending', 'running', 'created', 'waiting_for_resource', 'preparing', 'scheduled', 'manual']);
  if (rows.some((r) => pending.has((r.status ?? '').toLowerCase()))) {
    return { status: 'pending', count: rows.length, failed: [], url: rows[0]?.target_url ?? null };
  }
  return { status: 'success', count: rows.length, failed: [], url: rows[0]?.target_url ?? null };
}

function parseBitbucketStatuses(body: unknown): PartialResult {
  const values = Array.isArray((body as { values?: unknown[] } | null)?.values)
    ? (body as { values: Array<{ state?: string; name?: string; key?: string; url?: string }> }).values
    : Array.isArray(body) ? body as Array<{ state?: string; name?: string; key?: string; url?: string }> : [];
  if (values.length === 0) return { ...NONE };
  const collapsed = collapseBitbucketBuildStates(values.map((v) => v.state ?? ''));
  const failed = values.filter((v) => {
    const st = (v.state ?? '').toUpperCase();
    return st === 'FAILED' || st === 'ERROR';
  }).map((v) => v.name || v.key || 'build');
  const status: CommitCiStatus = collapsed ?? 'none';
  return { status, count: values.length, failed, url: values[0]?.url ?? null };
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const res = await fetch(url, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * Combined CI for one commit. GitHub merges `/status` + `/check-runs` because
 * Actions frequently publish only the latter. Never throws.
 */
export async function pollCommitCiStatus(
  coords: { provider: string; host: string | null; owner: string; repo: string; token: string },
  sha: string,
): Promise<CommitCiVerdict> {
  if (!sha) return { ...NONE, sha: '', summary: 'No commit SHA to poll.' };
  try {
    const api = resolveRepoApiTarget(coords);
    const headers = headersFor(api.flavor, coords.token);
    if (api.flavor === 'github') {
      const [combined, checks] = await Promise.all([
        getJson(api.buildStatus(sha), headers),
        getJson(`${api.repoBase}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`, headers),
      ]);
      return mergeParts(sha, [
        combined ? parseGithubCombined(combined) : { ...NONE },
        checks ? parseGithubCheckRuns(checks) : { ...NONE },
      ]);
    }
    const body = await getJson(api.buildStatus(sha), headers);
    if (!body) return { ...NONE, sha, summary: formatSummary('none', sha, 0, []) };
    if (api.flavor === 'gitlab') return mergeParts(sha, [parseGitlabStatuses(body)]);
    return mergeParts(sha, [parseBitbucketStatuses(body)]);
  } catch {
    return { ...NONE, sha, summary: 'CI poll failed.' };
  }
}

/** Resolve the ticket branch HEAD, then poll CI on that SHA. Never throws. */
export async function pollBranchCi(
  ctx: { provider: string; host: string | null; owner: string; repo: string; token: string; branch: string },
): Promise<CommitCiVerdict> {
  try {
    const sha = await resolveRepoRefSha(ctx, ctx.branch);
    if (!sha) {
      return { ...NONE, sha: '', summary: `Could not resolve HEAD of '${ctx.branch}'.` };
    }
    return await pollCommitCiStatus(ctx, sha);
  } catch {
    return { ...NONE, sha: '', summary: 'CI poll failed.' };
  }
}

export interface CiFinishState {
  pendingBlocks: number;
  failureBlocks: number;
}

export interface CiFinishDecision {
  block: string | null;
  ciVerified: boolean;
  pendingBlocks: number;
  failureBlocks: number;
}

/**
 * Pure finish-gate for branch CI. Failure and pending block up to a cap so a
 * repo with no checks, a flaky pipeline, or a PR-only workflow cannot deadlock
 * the run; automerge-on-green still waits after we relent.
 */
export function ciFinishDecision(ci: CommitCiVerdict, state: CiFinishState): CiFinishDecision {
  const keep = { pendingBlocks: state.pendingBlocks, failureBlocks: state.failureBlocks };
  if (ci.status === 'success') {
    return { block: null, ciVerified: true, ...keep };
  }
  if (ci.status === 'failure' && state.failureBlocks < MAX_CI_FAILURE_FINISH_BLOCKS) {
    const failed = ci.failed.length ? `\nFailed: ${ci.failed.join(', ')}` : '';
    const url = ci.url ? `\n${ci.url}` : '';
    return {
      block:
        `Cannot finish — CI failed on ${shortSha(ci.sha)} (${ci.count} check(s)). ${ci.summary}${failed}${url}\n`
        + 'Fix the failures with write_file, then call run_checks and finish again. '
        + 'Do not claim tests passed until run_checks reports CI success.',
      ciVerified: false,
      pendingBlocks: state.pendingBlocks,
      failureBlocks: state.failureBlocks + 1,
    };
  }
  if (ci.status === 'pending' && state.pendingBlocks < MAX_CI_PENDING_FINISH_BLOCKS) {
    return {
      block:
        `Cannot finish — CI is still running on ${shortSha(ci.sha)} (${ci.count} check(s)). ${ci.summary}\n`
        + 'Call run_checks again shortly; do not claim tests passed until it reports success. '
        + 'This executor has no shell — branch CI is the in-run build/type-check/test.',
      ciVerified: false,
      pendingBlocks: state.pendingBlocks + 1,
      failureBlocks: state.failureBlocks,
    };
  }
  return { block: null, ciVerified: false, ...keep };
}
