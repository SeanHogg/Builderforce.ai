/**
 * fetchBuildError — pull a concise, human/LLM-readable summary of WHY a GitHub
 * Actions run failed, so a post-merge build failure can be handed to the agent to
 * fix (the auto-fix loop) and shown in-product.
 *
 * `GET /repos/{o}/{r}/actions/runs/{runId}/jobs` lists each job + its steps with
 * conclusions; we surface the failed jobs and their failed step names. Full step
 * logs are a zip (`/logs`) that's impractical to parse in a Worker, so we stop at
 * the step level — enough for the agent to localize the failure, with the run URL
 * for the human. Served through the read-through cache (a concluded run is
 * immutable, keyed by runId). GitHub-only; degrades to a URL-only summary.
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
  runId: number;
  /** Fallback URL when the jobs API is unavailable / provider unsupported. */
  runUrl: string | null;
}

interface GhStep { name?: string; conclusion?: string; number?: number }
interface GhJob { name?: string; conclusion?: string; html_url?: string; steps?: GhStep[] }

async function fetchUncached(coords: BuildErrorCoords): Promise<BuildError> {
  const fallback: BuildError = {
    summary: `The build failed.${coords.runUrl ? ` See the run: ${coords.runUrl}` : ''}`,
    failedJobs: [],
    runUrl: coords.runUrl,
  };
  if (coords.provider !== 'github') return fallback;

  const apiBase = buildGitApiBaseUrl(coords.provider, coords.host);
  const url = `${apiBase}/repos/${coords.owner}/${coords.repo}/actions/runs/${coords.runId}/jobs?per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${coords.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BuilderForce-BuildError/1.0',
    },
  }).catch(() => null);
  if (!res || !res.ok) return fallback;

  const body = (await res.json().catch(() => null)) as { jobs?: GhJob[] } | null;
  const jobs = body?.jobs ?? [];
  const failed = jobs.filter((j) => (j.conclusion ?? '').toLowerCase() === 'failure');
  if (failed.length === 0) return fallback;

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
  const summary = [
    `The CI build failed. Failing jobs/steps:`,
    ...lines,
    coords.runUrl ? `\nFull run: ${coords.runUrl}` : '',
  ].filter(Boolean).join('\n');

  return { summary: summary.slice(0, 4000), failedJobs, runUrl: coords.runUrl };
}

/** Cached build-error summary (a concluded run is immutable — key by runId). */
export async function fetchBuildError(env: Env, coords: BuildErrorCoords): Promise<BuildError> {
  return getOrSetCached(env, `build-error:${coords.owner}/${coords.repo}:${coords.runId}`, () => fetchUncached(coords), {
    kvTtlSeconds: 3600,
    l1TtlMs: 60_000,
  });
}
