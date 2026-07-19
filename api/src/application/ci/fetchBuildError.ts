/**
 * fetchBuildError — pull a concise, human/LLM-readable summary of WHY a CI build
 * failed, so a build failure can be handed to the agent to fix (the auto-fix loop)
 * and shown in-product.
 *
 * One shape, three providers — each stops at the coarsest unit the provider exposes
 * cheaply, which is enough for the agent to localize the failure (full logs are
 * archives/streams that are impractical to parse in a Worker):
 *   - github    `GET /repos/{o}/{r}/actions/runs/{runId}/jobs`   → failed jobs + steps
 *   - gitlab    `GET /projects/{o%2Fr}/pipelines/{runId}/jobs`   → failed jobs + stage
 *   - bitbucket `GET /repositories/{o}/{r}/pipelines/{n}/steps/` → failed steps
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
interface GhJob { name?: string; conclusion?: string; html_url?: string; steps?: GhStep[] }
interface GlJob { name?: string; stage?: string; status?: string }
interface BbStep { name?: string; state?: { name?: string; result?: { name?: string } } }

/** One `• Job "x" failed…` line per failed unit, plus the run link. Shared by all
 *  providers so the agent sees ONE summary shape regardless of where CI runs. */
function summarize(lines: string[], runUrl: string | null): string {
  return [
    `The CI build failed. Failing jobs/steps:`,
    ...lines,
    runUrl ? `\nFull run: ${runUrl}` : '',
  ].filter(Boolean).join('\n').slice(0, 4000);
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
  return { summary: summarize(lines, coords.runUrl), failedJobs, runUrl: coords.runUrl };
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
  return { summary: summarize(lines, coords.runUrl), failedJobs, runUrl: coords.runUrl };
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
