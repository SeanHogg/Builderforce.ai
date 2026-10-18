import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
/**
 * repoDelivery — "is this repo's build green, and how many pulls are open",
 * for EVERY provider, read off a scheduled sweep rather than the request.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * `buildProjectConnections` used to answer that question by calling the provider
 * while composing the dashboard read. Two bounds fell out of doing it there, and
 * both showed the operator `unknown`:
 *
 *   (a) only GitHub had a reader, so every GitLab/Bitbucket card listed its
 *       connection and then had nothing to say about it;
 *   (b) a per-composition subrequest budget capped how many repos could be probed
 *       at all, so repo 21 of a many-repo tenant degraded for no visible reason.
 *
 * Both degraded honestly and neither showed the truth. Persisting the verdict
 * (`repo_delivery_status`, migration 0931) fixes both with one change: with no
 * provider call on the read path there is no budget left to protect, which is
 * what makes probing every provider affordable.
 *
 * ── THE SEAM ────────────────────────────────────────────────────────────────
 * {@link probeRepoDelivery} is the per-provider reader. Adding a provider is one
 * entry in {@link PROBES} — a map, not a chain of branches — and every one returns
 * the same {@link RepoDeliveryProbe} shape, so the sweep, the store and the
 * dashboard never learn which provider a repo is on.
 *
 * ── WHAT EACH PROVIDER IS ASKED ─────────────────────────────────────────────
 *   github    open pulls (`/pulls?state=open`) + latest Actions run on the
 *             default branch.
 *   gitlab    open merge requests (`X-Total` header) + latest pipeline on the
 *             default branch.
 *   bitbucket open pull requests (`size` on the page) + latest Pipelines run on
 *             the default branch.
 *
 * The PULLS listing is the liveness probe in every case: it exists on every repo,
 * so a failure there is a real access problem. The CI listing may legitimately
 * 404 (Actions disabled, no Pipelines configured), which is not a fault — the
 * connection is healthy and simply has no build to report.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { repoDeliveryStatus } from '../../infrastructure/database/schema';
import { loadSweepStamps } from '../../infrastructure/cache/sweepStampLedger';
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { githubRequest, repoPath, resolveRepoAuth, type ResolvedRepoAuth } from './githubClient';
import { makeRepoFetch } from './sources/RepoSource';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import type { Env } from '../../env';

/** ok = reachable · degraded = reachable with errors · error = broken · unknown = never probed. */
export type ProjectConnectionHealth = 'ok' | 'degraded' | 'error' | 'unknown';

/** Machine reason for a non-ok health. The frontend owns the localized wording. */
export type ProjectConnectionReason =
  | 'no_credential'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'provider_error'
  | 'disabled'
  | 'not_probed'
  | null;

export type ProjectBuildStatus = 'success' | 'failure' | 'pending' | 'cancelled' | null;

export interface RepoDeliveryProbe {
  health: ProjectConnectionHealth;
  reason: ProjectConnectionReason;
  openPullRequests: number | null;
  buildStatus: ProjectBuildStatus;
  buildUrl: string | null;
  buildBranch: string | null;
  buildAt: string | null;
}

/** Providers this module can read a delivery verdict from. */
export const PROBEABLE_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;

const unreachable = (reason: ProjectConnectionReason): RepoDeliveryProbe => ({
  health: 'error', reason, openPullRequests: null,
  buildStatus: null, buildUrl: null, buildBranch: null, buildAt: null,
});

/** What a reader is handed: resolved coordinates plus a token that works on them. */
interface ProbeContext {
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** The resolved credential when the provider is GitHub — carries the App
   *  token's refresh so a revoked installation re-mints rather than reading as
   *  `unauthorized` for the rest of the cache TTL. */
  auth?: ResolvedRepoAuth;
  branch: string | null;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

interface GithubRun {
  status: string | null;
  conclusion: string | null;
  html_url: string | null;
  head_branch: string | null;
  updated_at: string | null;
}

/**
 * Map a GitHub Actions run to the four-state verdict the UI renders. A run that
 * has not completed is `pending`; `neutral`/`skipped` are green because they are
 * how a workflow says "nothing to do here", not "this broke".
 */
export function runToBuildStatus(run: GithubRun | undefined): ProjectBuildStatus {
  if (!run) return null;
  if (run.status !== 'completed') return 'pending';
  switch (run.conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'success';
    case 'cancelled':
      return 'cancelled';
    case null:
    case undefined:
      return 'pending';
    default:
      return 'failure';
  }
}

/**
 * Exact result count from a `per_page=1` listing: with one item per page the
 * `rel="last"` page number IS the total. Falls back to the page length when the
 * response is a single page (GitHub omits `Link` entirely in that case).
 */
export function totalFromLinkHeader(headers: Headers, itemsOnPage: number): number {
  const link = headers.get('link');
  if (!link) return itemsOnPage;
  const last = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return last ? Number(last[1]) : itemsOnPage;
}

async function probeGithub(ctx: ProbeContext): Promise<RepoDeliveryProbe> {
  const coords = { host: ctx.host, owner: ctx.owner, repo: ctx.repo };
  const credential = ctx.auth ? { auth: ctx.auth } : { coords, token: ctx.token };
  const [pulls, runs] = await Promise.all([
    githubRequest<Array<unknown>>({ ...credential, path: repoPath(coords, '/pulls?state=open&per_page=1') }),
    githubRequest<{ workflow_runs?: GithubRun[] }>({
      ...credential,
      path: repoPath(coords, `/actions/runs?per_page=1&exclude_pull_requests=true${ctx.branch ? `&branch=${encodeURIComponent(ctx.branch)}` : ''}`),
    }),
  ]);
  if (!pulls.ok) return unreachable(pulls.code === 'unsupported' ? 'provider_error' : pulls.code);

  const run = runs.ok ? runs.data.workflow_runs?.[0] : undefined;
  return {
    health: 'ok', reason: null,
    openPullRequests: totalFromLinkHeader(pulls.headers, pulls.data.length),
    buildStatus: runToBuildStatus(run),
    buildUrl: run?.html_url ?? null,
    buildBranch: run?.head_branch ?? ctx.branch ?? null,
    buildAt: run?.updated_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

interface GlPipeline { status?: string; web_url?: string; ref?: string; updated_at?: string; created_at?: string }

/** GitLab pipeline status → the shared four-state verdict. */
export function pipelineToBuildStatus(status: string | undefined): ProjectBuildStatus {
  switch (status) {
    case 'success':
    case 'manual':      // waiting on a human gate, not a failure
      return 'success';
    case 'failed':
      return 'failure';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case undefined:
      return null;
    case 'skipped':
      return 'success';
    default:
      // created / waiting_for_resource / preparing / pending / running / scheduled
      return 'pending';
  }
}

/** Map an HTTP status onto the shared reason vocabulary. */
function reasonForStatus(status: number): ProjectConnectionReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'provider_error';
}

async function probeGitlab(ctx: ProbeContext, fetchFn = makeRepoFetch()): Promise<RepoDeliveryProbe> {
  const base = `https://${(ctx.host?.trim() || 'gitlab.com')}/api/v4`;
  const project = encodeURIComponent(`${ctx.owner}/${ctx.repo}`);
  // Both headers, matching GitLabRepoSource: Bearer works for OAuth, PRIVATE-TOKEN for a PAT.
  const headers = {
    Authorization: `Bearer ${ctx.token}`,
    'PRIVATE-TOKEN': ctx.token,
    'User-Agent': 'Builderforce/1.0',
    Accept: 'application/json',
  };

  const [mrs, pipelines] = await Promise.all([
    fetchFn(`${base}/projects/${project}/merge_requests?state=opened&per_page=1`, { headers }),
    fetchFn(`${base}/projects/${project}/pipelines?per_page=1${ctx.branch ? `&ref=${encodeURIComponent(ctx.branch)}` : ''}`, { headers }),
  ]);
  if (!mrs.ok) return unreachable(reasonForStatus(mrs.status));

  // GitLab reports the exact total in a header; the page body is the fallback.
  const page = (await mrs.json().catch(() => [])) as unknown[];
  const total = Number(mrs.headers.get('x-total'));
  const open = Number.isFinite(total) ? total : (Array.isArray(page) ? page.length : 0);

  const pipeline = pipelines.ok
    ? ((await pipelines.json().catch(() => [])) as GlPipeline[])[0]
    : undefined;
  return {
    health: 'ok', reason: null,
    openPullRequests: open,
    buildStatus: pipelineToBuildStatus(pipeline?.status),
    buildUrl: pipeline?.web_url ?? null,
    buildBranch: pipeline?.ref ?? ctx.branch ?? null,
    buildAt: pipeline?.updated_at ?? pipeline?.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Bitbucket
// ---------------------------------------------------------------------------

interface BbPipeline {
  state?: { name?: string; result?: { name?: string } };
  target?: { ref_name?: string };
  build_number?: number;
  completed_on?: string;
  created_on?: string;
}

/** Bitbucket Pipelines state/result → the shared four-state verdict. */
export function bitbucketPipelineToBuildStatus(pipeline: BbPipeline | undefined): ProjectBuildStatus {
  if (!pipeline?.state) return null;
  if (pipeline.state.name !== 'COMPLETED') return 'pending';
  switch (pipeline.state.result?.name) {
    case 'SUCCESSFUL':
      return 'success';
    case 'STOPPED':
      return 'cancelled';
    case undefined:
      return 'pending';
    default:
      return 'failure';
  }
}

async function probeBitbucket(ctx: ProbeContext, fetchFn = makeRepoFetch()): Promise<RepoDeliveryProbe> {
  const base = 'https://api.bitbucket.org/2.0';
  const slug = `${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`;
  const headers = { Authorization: `Bearer ${ctx.token}`, 'User-Agent': 'Builderforce/1.0', Accept: 'application/json' };

  const [prs, pipelines] = await Promise.all([
    fetchFn(`${base}/repositories/${slug}/pullrequests?state=OPEN&pagelen=1`, { headers }),
    fetchFn(
      `${base}/repositories/${slug}/pipelines/?sort=-created_on&pagelen=1${ctx.branch ? `&target.ref_name=${encodeURIComponent(ctx.branch)}` : ''}`,
      { headers },
    ),
  ]);
  if (!prs.ok) return unreachable(reasonForStatus(prs.status));

  const prPage = (await prs.json().catch(() => null)) as { size?: number; values?: unknown[] } | null;
  const pipelinePage = pipelines.ok
    ? ((await pipelines.json().catch(() => null)) as { values?: BbPipeline[] } | null)
    : null;
  const pipeline = pipelinePage?.values?.[0];
  return {
    health: 'ok', reason: null,
    openPullRequests: prPage?.size ?? prPage?.values?.length ?? 0,
    buildStatus: bitbucketPipelineToBuildStatus(pipeline),
    buildUrl: pipeline?.build_number
      ? `https://bitbucket.org/${ctx.owner}/${ctx.repo}/pipelines/results/${pipeline.build_number}`
      : null,
    buildBranch: pipeline?.target?.ref_name ?? ctx.branch ?? null,
    buildAt: pipeline?.completed_on ?? pipeline?.created_on ?? null,
  };
}

/** Provider → reader. Adding a provider is one entry, never a new branch. */
const PROBES: Record<string, (ctx: ProbeContext) => Promise<RepoDeliveryProbe>> = {
  github: probeGithub,
  gitlab: probeGitlab,
  bitbucket: probeBitbucket,
};

// ---------------------------------------------------------------------------
// The probe + the sweep
// ---------------------------------------------------------------------------

/**
 * Read one repo's live delivery verdict from its provider.
 *
 * GitHub resolves auth through {@link resolveRepoAuth} so an App installation
 * covers a tenant that stores no PAT; the other providers resolve the stored
 * credential directly (there is no App equivalent for them).
 */
export async function probeRepoDelivery(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  repoId: string,
): Promise<RepoDeliveryProbe> {
  const auth = await resolveRepoAuth(env, db, secret, tenantId, repoId);
  if (!auth.ok) return unreachable('no_credential');

  const provider = auth.auth.repo.provider;
  const probe = PROBES[provider];
  if (!probe) {
    return {
      health: 'unknown', reason: 'not_probed', openPullRequests: null,
      buildStatus: null, buildUrl: null, buildBranch: null, buildAt: null,
    };
  }

  // resolveRepoAuth hands back a GitHub App token for github; for the others it
  // returns the stored credential, which is exactly what their APIs want.
  return probe({
    host: auth.auth.coords.host,
    owner: auth.auth.coords.owner,
    repo: auth.auth.coords.repo,
    token: auth.auth.token,
    auth: auth.auth,
    branch: auth.auth.repo.defaultBranch?.trim() || null,
  });
}

/**
 * KV key of the sweep's "last probed" ledger (see `infrastructure/cache/sweepStampLedger`).
 * The sweep (`repoDeliverySweep.ts`) stamps it on every probe; `probed_at` is written only
 * with a verdict change. Readers take the newer of the two.
 */
export const REPO_DELIVERY_STAMPS_KEY = 'sweep:repo-delivery:probed';

/** Upsert one repo's verdict, `probed_at` included — the column moves only with a
 *  verdict, never on an unchanged probe (that is a KV stamp, see the sweep). */
export async function storeRepoDelivery(
  db: Db,
  tenantId: number,
  repoId: string,
  verdict: RepoDeliveryProbe,
): Promise<void> {
  const now = new Date();
  const row = {
    tenantId,
    repoId,
    health: verdict.health,
    reason: verdict.reason,
    openPullRequests: verdict.openPullRequests,
    buildStatus: verdict.buildStatus,
    buildUrl: verdict.buildUrl,
    buildBranch: verdict.buildBranch,
    buildAt: verdict.buildAt ? new Date(verdict.buildAt) : null,
    probedAt: now,
    updatedAt: now,
  };
  await db
    .insert(repoDeliveryStatus)
    .values(row)
    .onConflictDoUpdate({ target: repoDeliveryStatus.repoId, set: row });
}

export interface StoredRepoDelivery extends RepoDeliveryProbe {
  /** ISO timestamp of the sweep that produced this verdict — its age. */
  probedAt: string;
}

/**
 * Every persisted verdict for a tenant, keyed by repo id. ONE query, no provider calls.
 * `probedAt` is the newer of the sweep's KV stamp and the column (which only moves with
 * a verdict change), so an unchanged-but-recently-probed repo still reads as fresh.
 */
export async function loadRepoDelivery(db: Db, tenantId: number, env?: CacheEnv): Promise<Map<string, StoredRepoDelivery>> {
  const [rows, stamps] = await Promise.all([
    db.select().from(repoDeliveryStatus).where(eq(repoDeliveryStatus.tenantId, tenantId)),
    loadSweepStamps(env, REPO_DELIVERY_STAMPS_KEY),
  ]);
  return new Map(rows.map((r) => [r.repoId, {
    health: r.health as ProjectConnectionHealth,
    reason: (r.reason ?? null) as ProjectConnectionReason,
    openPullRequests: r.openPullRequests,
    buildStatus: (r.buildStatus ?? null) as ProjectBuildStatus,
    buildUrl: r.buildUrl,
    buildBranch: r.buildBranch,
    buildAt: r.buildAt ? new Date(r.buildAt).toISOString() : null,
    probedAt: new Date(stamps.lastChecked(r.repoId, r.probedAt) ?? r.probedAt).toISOString(),
  }]));
}

/** Probe + persist one repo NOW, so attaching a repo shows a verdict immediately
 *  instead of on the next sweep tick. Best-effort by contract. */
export async function refreshRepoDelivery(
  env: Env,
  db: Db,
  tenantId: number,
  repoId: string,
): Promise<void> {
  const secret = integrationCredentialSecret(env);
  const resolved = await resolveRepoCredential(db, secret, tenantId, repoId);
  if (isResolveError(resolved)) return;
  const verdict = await probeRepoDelivery(env, db, secret, tenantId, repoId);
  await storeRepoDelivery(db, tenantId, repoId, verdict);
}
