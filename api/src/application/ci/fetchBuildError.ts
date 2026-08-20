/**
 * fetchBuildError — pull a concise, human/LLM-readable summary of WHY a CI build
 * failed, so a build failure can be handed to the agent to fix (the auto-fix loop)
 * and shown in-product.
 *
 * One shape, three providers:
 *   - github    `GET /repos/{o}/{r}/actions/runs/{runId}/jobs`   → failed jobs + steps
 *   - gitlab    `GET /projects/{o%2Fr}/pipelines/{runId}/jobs`   → failed jobs + stage
 *   - bitbucket `GET /repositories/{o}/{r}/pipelines/{n}/steps/` → failed steps
 *
 * ── AND THE LOG TAIL ────────────────────────────────────────────────────────────
 * Step NAMES are not a build error. "Job \"build\" failed at step: Run npm test" tells
 * an agent which command failed and nothing about WHY, so the auto-fix run began by
 * guessing — which is what made the loop expensive and unreliable. Both providers that
 * can serve a plain-text trace do so per JOB (the whole-RUN endpoint is a zip archive,
 * which is the thing that is genuinely impractical in a Worker):
 *   - github  `GET /repos/{o}/{r}/actions/jobs/{jobId}/logs`  → 302 → text/plain
 *   - gitlab  `GET /projects/{o%2Fr}/jobs/{jobId}/trace`      → text/plain
 * The TAIL is what matters — a failing build prints its error last — so each failed
 * job contributes its last {@link LOG_TAIL_CHARS} characters, capped at
 * {@link MAX_LOG_JOBS} jobs so one pathological pipeline cannot blow the prompt or
 * the subrequest budget. A provider or repo that will not serve a trace degrades to
 * exactly the step-name summary it produced before.
 *
 * Bitbucket posts commit statuses with NO numeric run id, so its build number is
 * recovered from the status URL (`…/pipelines/results/123`); when it isn't there, the
 * summary degrades to the URL like any other unsupported case.
 *
 * Served through the read-through cache — a concluded run is immutable, so it is
 * keyed by the run identity (runId, or the run URL for Bitbucket).
 */
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { buildGitApiBaseUrl } from '../repos/gitProxy';
import type { Env } from '../../env';

/** How many trailing characters of a failed job's log to keep. A failing build prints
 *  its error last, so the tail is the diagnostic half of the log. */
export const LOG_TAIL_CHARS = 3000;
/** How many failed jobs may contribute a log tail. One pipeline can fail dozens of
 *  matrix jobs for the same reason; the first two carry the signal. */
export const MAX_LOG_JOBS = 2;

export interface BuildError {
  /** A short multi-line summary of the failed jobs/steps, safe to put in a prompt. */
  summary: string;
  /** Failed job names (for the UI / telemetry). */
  failedJobs: string[];
  /** Link to the run on the provider. */
  runUrl: string | null;
}

export interface BuildErrorCoords {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** Provider run id (GitHub `workflow_run.id`, GitLab `pipeline.id`). Bitbucket
   *  commit statuses carry none — the build number comes from `runUrl` instead. */
  runId: number | null;
  /** Fallback URL when the jobs API is unavailable / provider unsupported. */
  runUrl: string | null;
}

interface GhStep { name?: string; conclusion?: string; number?: number }
interface GhJob { id?: number; name?: string; conclusion?: string; html_url?: string; steps?: GhStep[] }
interface GlJob { id?: number; name?: string; stage?: string; status?: string }
interface BbStep { name?: string; state?: { name?: string; result?: { name?: string } } }

/** One `• Job "x" failed…` line per failed unit, then the log tails, then the run
 *  link. Shared by all providers so the agent sees ONE summary shape regardless of
 *  where CI runs. */
function summarize(lines: string[], runUrl: string | null, logs: LogTail[] = []): string {
  const logBlock = logs.flatMap((l) => [
    `\n--- last ${LOG_TAIL_CHARS} chars of "${l.jobName}" ---`,
    l.tail,
  ]);
  return [
    `The CI build failed. Failing jobs/steps:`,
    ...lines,
    ...logBlock,
    runUrl ? `\nFull run: ${runUrl}` : '',
  ].filter(Boolean).join('\n').slice(0, 4000 + LOG_TAIL_CHARS * MAX_LOG_JOBS);
}

/** The trailing slice of one failed job's log. */
interface LogTail { jobName: string; tail: string }

/**
 * GET a plain-text log and return its TAIL. Null on any failure — a repo whose token
 * cannot read logs, a provider that redirects to an expired blob, a job whose trace was
 * already pruned. Every caller degrades to the step-name summary it produced before.
 */
async function getLogTail(url: string, headers: Record<string, string>): Promise<string | null> {
  const res = await fetch(url, { headers, redirect: 'follow' }).catch(() => null);
  if (!res || !res.ok) return null;
  const text = await res.text().catch(() => null);
  if (!text) return null;
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return null;
  return trimmed.length > LOG_TAIL_CHARS ? trimmed.slice(-LOG_TAIL_CHARS) : trimmed;
}

/** GET + parse JSON; null on any network/HTTP/parse failure (callers degrade). */
async function getJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const res = await fetch(url, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

/** Bitbucket's build number as posted in a commit-status URL (`…/pipelines/results/123`). */
function bitbucketBuildNumber(runUrl: string | null): number | null {
  const m = /\/pipelines\/results\/(\d+)/.exec(runUrl ?? '');
  return m ? Number(m[1]) : null;
}

async function fetchGithub(coords: BuildErrorCoords, apiBase: string): Promise<BuildError | null> {
  if (coords.runId == null) return null;
  const body = await getJson<{ jobs?: GhJob[] }>(
    `${apiBase}/repos/${coords.owner}/${coords.repo}/actions/runs/${coords.runId}/jobs?per_page=100`,
    {
      Authorization: `Bearer ${coords.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BuilderForce-BuildError/1.0',
    },
  );
  const failed = (body?.jobs ?? []).filter((j) => (j.conclusion ?? '').toLowerCase() === 'failure');
  if (failed.length === 0) return null;

  const lines: string[] = [];
  const failedJobs: string[] = [];
  for (const job of failed) {
    const jobName = job.name ?? 'unnamed job';
    failedJobs.push(jobName);
    const failedSteps = (job.steps ?? [])
      .filter((s) => (s.conclusion ?? '').toLowerCase() === 'failure')
      .map((s) => s.name ?? `step ${s.number ?? '?'}`);
    lines.push(`• Job "${jobName}" failed${failedSteps.length ? ` at step(s): ${failedSteps.join('; ')}` : ''}.`);
  }

  // The actual error text. `/actions/jobs/{id}/logs` 302s to a plain-text blob (the
  // whole-RUN endpoint is a zip, which is the one that cannot be read in a Worker).
  const headers = {
    Authorization: `Bearer ${coords.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-BuildError/1.0',
  };
  const logs: LogTail[] = [];
  for (const job of failed.slice(0, MAX_LOG_JOBS)) {
    if (job.id == null) continue;
    const tail = await getLogTail(`${apiBase}/repos/${coords.owner}/${coords.repo}/actions/jobs/${job.id}/logs`, headers);
    if (tail) logs.push({ jobName: job.name ?? 'unnamed job', tail });
  }

  return { summary: summarize(lines, coords.runUrl, logs), failedJobs, runUrl: coords.runUrl };
}

/**
 * GitLab pipeline → its failed jobs. `runId` IS the pipeline id (the Pipeline Hook
 * puts `object_attributes.id` there), and the project is addressed by its
 * URL-encoded `owner/repo` path. GitLab has no per-step conclusions, so the STAGE
 * is the localizing detail (the analogue of GitHub's failed step names).
 */
async function fetchGitlab(coords: BuildErrorCoords, apiBase: string): Promise<BuildError | null> {
  if (coords.runId == null) return null;
  const project = encodeURIComponent(`${coords.owner}/${coords.repo}`);
  const jobs = await getJson<GlJob[]>(
    `${apiBase}/projects/${project}/pipelines/${coords.runId}/jobs?per_page=100`,
    { Authorization: `Bearer ${coords.token}`, 'PRIVATE-TOKEN': coords.token, Accept: 'application/json' },
  );
  const failed = (Array.isArray(jobs) ? jobs : []).filter((j) => (j.status ?? '').toLowerCase() === 'failed');
  if (failed.length === 0) return null;

  const failedJobs = failed.map((j) => j.name ?? 'unnamed job');
  const lines = failed.map((j) => {
    const name = j.name ?? 'unnamed job';
    return `• Job "${name}" failed${j.stage ? ` in stage: ${j.stage}` : ''}.`;
  });

  // `/jobs/{id}/trace` is GitLab's plain-text job log — the same diagnostic half the
  // GitHub path reads, under a different name.
  const headers = { Authorization: `Bearer ${coords.token}`, 'PRIVATE-TOKEN': coords.token, Accept: 'text/plain' };
  const logs: LogTail[] = [];
  for (const job of failed.slice(0, MAX_LOG_JOBS)) {
    if (job.id == null) continue;
    const tail = await getLogTail(`${apiBase}/projects/${project}/jobs/${job.id}/trace`, headers);
    if (tail) logs.push({ jobName: job.name ?? 'unnamed job', tail });
  }

  return { summary: summarize(lines, coords.runUrl, logs), failedJobs, runUrl: coords.runUrl };
}

/**
 * Bitbucket Pipelines build → its failed steps. A commit status carries no run id,
 * so the build number is recovered from the status URL; the steps endpoint reports
 * one `state.result` per step, which is Bitbucket's job/step unit in one.
 */
async function fetchBitbucket(coords: BuildErrorCoords, apiBase: string): Promise<BuildError | null> {
  const buildNumber = bitbucketBuildNumber(coords.runUrl);
  if (buildNumber == null) return null;
  const body = await getJson<{ values?: BbStep[] }>(
    `${apiBase}/repositories/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/pipelines/${buildNumber}/steps/?pagelen=100`,
    { Authorization: `Bearer ${coords.token}`, Accept: 'application/json' },
  );
  const failed = (body?.values ?? []).filter((s) => {
    const r = (s.state?.result?.name ?? '').toUpperCase();
    return r === 'FAILED' || r === 'ERROR';
  });
  if (failed.length === 0) return null;

  const failedJobs = failed.map((s) => s.name ?? 'unnamed step');
  const lines = failedJobs.map((name) => `• Step "${name}" failed.`);
  return { summary: summarize(lines, coords.runUrl), failedJobs, runUrl: coords.runUrl };
}

async function fetchUncached(coords: BuildErrorCoords): Promise<BuildError> {
  const fallback: BuildError = {
    summary: `The build failed.${coords.runUrl ? ` See the run: ${coords.runUrl}` : ''}`,
    failedJobs: [],
    runUrl: coords.runUrl,
  };

  // A self-hosted host the provider has no REST base for (e.g. Bitbucket Server) throws.
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl(coords.provider, coords.host); } catch { return fallback; }

  const detail =
    coords.provider === 'github' ? await fetchGithub(coords, apiBase)
    : coords.provider === 'gitlab' ? await fetchGitlab(coords, apiBase)
    : coords.provider === 'bitbucket' ? await fetchBitbucket(coords, apiBase)
    : null;
  return detail ?? fallback;
}

/**
 * Cached build-error summary. A concluded run is immutable, so the key is the run
 * identity: the numeric run id where the provider has one, else the run URL (which
 * embeds Bitbucket's build number).
 */
export async function fetchBuildError(env: Env, coords: BuildErrorCoords): Promise<BuildError> {
  const runKey = coords.runId != null ? String(coords.runId) : (coords.runUrl ?? 'unknown');
  return getOrSetCached(env, `build-error:${coords.provider}:${coords.owner}/${coords.repo}:${runKey}`, () => fetchUncached(coords), {
    kvTtlSeconds: 3600,
    l1TtlMs: 60_000,
  });
}
