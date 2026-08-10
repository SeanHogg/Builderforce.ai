/**
 * projectConnectionStatus — the ONE composer for "what is this project wired to,
 * and is that wiring healthy right now".
 *
 * WHY THIS EXISTS
 * A project can be bound to source control (`project_repositories`) and to an
 * external board (`board_connections`), but nothing on the projects widget said
 * so: you had to open the details panel → Integrations tab to learn whether a
 * repo was even attached, let alone whether its build was green. This module
 * composes that answer once, for every project in a tenant, so the card and the
 * list row render the same status without an N+1 per-card fetch.
 *
 * WHAT IS LIVE AND WHAT IS RECORDED
 * - Build status + open-PR count for a GitHub repo are read LIVE from the
 *   provider (Actions runs + open pulls), because the recorded `pull_requests`
 *   rows only ever describe PRs Builderforce itself opened — a repo whose CI
 *   runs on `main` would otherwise look like it had never built.
 * - Everything else (which connections exist, board sync health, last sync time)
 *   is DB-derived and needs no provider round-trip.
 * - When the live probe cannot run (no credential, non-GitHub provider, probe
 *   budget spent) the entry falls back to the RECORDED open-PR count and reports
 *   `health: 'unknown'` rather than inventing a green tick.
 *
 * COST
 * Two grouped DB queries + one cached probe per GitHub repo. Each probe is
 * itself read-through cached (`repo-delivery:*`, 60s KV / 30s L1) and the whole
 * composed payload is cached per tenant by the route, so the steady state for a
 * dashboard load is zero provider subrequests. {@link LIVE_PROBE_BUDGET} caps a
 * cold read so a tenant with many repos cannot exhaust the Worker's subrequest
 * allowance; default repos are probed first.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { boardConnections, projectRepositories, pullRequests } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { githubRequest, repoPath, resolveRepoAuth } from './githubClient';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Max GitHub repos probed live in one composition. Defaults are probed first. */
const LIVE_PROBE_BUDGET = 20;

export type ProjectConnectionKind = 'source_control' | 'board';

/** ok = reachable/syncing · degraded = syncing with errors · error = broken · unknown = not probed. */
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

export interface ProjectConnection {
  kind: ProjectConnectionKind;
  /** github | gitlab | bitbucket | jira | freshworks | rally | … */
  provider: string;
  /** `owner/repo` for source control; the external board id (or provider) for a board. */
  label: string;
  /** Deep link to the connected thing, when one can be derived. */
  url: string | null;
  health: ProjectConnectionHealth;
  reason: ProjectConnectionReason;
  /** True for the repo agents dispatch against by default. */
  isDefault: boolean;
  /** Open pull/merge requests. Live when probed, else the Builderforce-recorded count. */
  openPullRequests: number | null;
  /** True when `openPullRequests` counts only Builderforce-opened PRs (probe unavailable). */
  openPullRequestsRecordedOnly: boolean;
  /** Latest CI verdict on the repo's default branch. Null = no runs / not probed. */
  buildStatus: ProjectBuildStatus;
  /** Link to the run that produced `buildStatus`. */
  buildUrl: string | null;
  buildBranch: string | null;
  /** ISO timestamp of that run. */
  buildAt: string | null;
  /** ISO timestamp of the last successful sync/poll, when the connection tracks one. */
  lastSyncedAt: string | null;
}

export interface ProjectConnectionsSummary {
  projectId: number;
  connections: ProjectConnection[];
}

/** Read-through cache key for one repo's live delivery signals. */
function repoDeliveryKey(tenantId: number, repoId: string): string {
  return `repo-delivery:t:${tenantId}:r:${repoId}`;
}

/** Read-through cache key for a tenant's composed project-connections payload. */
export function projectConnectionsKey(tenantId: number): string {
  return `project-connections:t:${tenantId}`;
}

/**
 * Drop a tenant's composed connections payload AND the per-repo probe behind it.
 * Called from every repo/board write so attaching a repo shows up immediately
 * instead of after the 60s TTL. `repoId` is optional — omit it for board writes.
 */
export async function invalidateProjectConnections(env: Env, tenantId: number, repoId?: string): Promise<void> {
  await Promise.all([
    invalidateCached(env, projectConnectionsKey(tenantId)),
    ...(repoId ? [invalidateCached(env, repoDeliveryKey(tenantId, repoId))] : []),
  ]);
}

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
function runToBuildStatus(run: GithubRun | undefined): ProjectBuildStatus {
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
function totalFromLinkHeader(headers: Headers, itemsOnPage: number): number {
  const link = headers.get('link');
  if (!link) return itemsOnPage;
  const last = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return last ? Number(last[1]) : itemsOnPage;
}

interface RepoDeliveryProbe {
  health: ProjectConnectionHealth;
  reason: ProjectConnectionReason;
  openPullRequests: number | null;
  buildStatus: ProjectBuildStatus;
  buildUrl: string | null;
  buildBranch: string | null;
  buildAt: string | null;
}

/**
 * Live delivery signals for ONE GitHub repo: is it reachable, how many pulls are
 * open, and what did its most recent workflow run conclude. Two subrequests,
 * cached together so a widget refresh costs nothing.
 *
 * Only GitHub is probed. GitLab/Bitbucket repos are perfectly usable — they just
 * have no equivalent single call here yet — so they report `unknown` rather than
 * a false failure.
 */
async function probeRepoDelivery(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  repoId: string,
): Promise<RepoDeliveryProbe> {
  return getOrSetCached<RepoDeliveryProbe>(
    env,
    repoDeliveryKey(tenantId, repoId),
    async () => {
      const auth = await resolveRepoAuth(env, db, secret, tenantId, repoId);
      if (!auth.ok) {
        return {
          health: 'error', reason: 'no_credential', openPullRequests: null,
          buildStatus: null, buildUrl: null, buildBranch: null, buildAt: null,
        };
      }
      if (auth.auth.repo.provider !== 'github') {
        return {
          health: 'unknown', reason: 'not_probed', openPullRequests: null,
          buildStatus: null, buildUrl: null, buildBranch: null, buildAt: null,
        };
      }

      const { coords, token } = auth.auth;
      const branch = auth.auth.repo.defaultBranch?.trim();
      const [pulls, runs] = await Promise.all([
        githubRequest<Array<unknown>>({
          coords, token,
          path: repoPath(coords, '/pulls?state=open&per_page=1'),
        }),
        githubRequest<{ total_count?: number; workflow_runs?: GithubRun[] }>({
          coords, token,
          path: repoPath(
            coords,
            `/actions/runs?per_page=1&exclude_pull_requests=true${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`,
          ),
        }),
      ]);

      // The pulls listing is the liveness probe: it exists on every repo, so a
      // failure there is a real access problem. The Actions listing can 404 on a
      // repo with Actions disabled, which is not a connection fault.
      if (!pulls.ok) {
        return {
          health: 'error', reason: pulls.code === 'unsupported' ? 'provider_error' : pulls.code,
          openPullRequests: null,
          buildStatus: null, buildUrl: null, buildBranch: null, buildAt: null,
        };
      }

      const run = runs.ok ? runs.data.workflow_runs?.[0] : undefined;
      return {
        health: 'ok',
        reason: null,
        openPullRequests: totalFromLinkHeader(pulls.headers, pulls.data.length),
        buildStatus: runToBuildStatus(run),
        buildUrl: run?.html_url ?? null,
        buildBranch: run?.head_branch ?? branch ?? null,
        buildAt: run?.updated_at ?? null,
      };
    },
    { kvTtlSeconds: 60, l1TtlMs: 30_000 },
  ).catch(() => ({
    health: 'unknown' as const, reason: 'provider_error' as const, openPullRequests: null,
    buildStatus: null, buildUrl: null, buildBranch: null, buildAt: null,
  }));
}

/** Browser URL for a repo, so the status chip can link somewhere useful. */
function repoWebUrl(provider: string, host: string | null, owner: string, repo: string): string | null {
  const h = host?.trim() || (provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : provider === 'bitbucket' ? 'bitbucket.org' : null);
  return h ? `https://${h}/${owner}/${repo}` : null;
}

/** board_connections.status → the shared health vocabulary. */
function boardHealth(status: string): { health: ProjectConnectionHealth; reason: ProjectConnectionReason } {
  if (status === 'degraded') return { health: 'degraded', reason: 'provider_error' };
  if (status === 'disabled') return { health: 'error', reason: 'disabled' };
  return { health: 'ok', reason: null };
}

const toIso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

/**
 * Compose every project's connection statuses for a tenant.
 *
 * Returns only projects that HAVE at least one connection — a project with
 * nothing wired up contributes no entry, so the consumer renders nothing for it
 * rather than an empty "no connections" row on every card.
 */
export async function buildProjectConnections(
  env: Env,
  db: Db,
  tenantId: number,
): Promise<ProjectConnectionsSummary[]> {
  const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';

  const [repos, boards] = await Promise.all([
    db
      .select({
        id: projectRepositories.id,
        projectId: projectRepositories.projectId,
        provider: projectRepositories.provider,
        host: projectRepositories.host,
        owner: projectRepositories.owner,
        repo: projectRepositories.repo,
        isDefault: projectRepositories.isDefault,
        credentialId: projectRepositories.credentialId,
        lastSyncedAt: projectRepositories.lastSyncedAt,
      })
      .from(projectRepositories)
      .where(eq(projectRepositories.tenantId, tenantId))
      .orderBy(desc(projectRepositories.isDefault), projectRepositories.createdAt),
    db
      .select({
        projectId: boardConnections.projectId,
        provider: boardConnections.provider,
        externalBoardId: boardConnections.externalBoardId,
        status: boardConnections.status,
        lastPolledAt: boardConnections.lastPolledAt,
      })
      .from(boardConnections)
      .where(eq(boardConnections.tenantId, tenantId)),
  ]);

  if (repos.length === 0 && boards.length === 0) return [];

  // Recorded open-PR counts — the fallback when a repo cannot be probed live.
  // One grouped query for the whole tenant (never per repo).
  const repoIds = repos.map((r) => r.id);
  const recordedOpen = repoIds.length
    ? await db
        .select({ repoId: pullRequests.repoId, open: sql<number>`count(*)` })
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.tenantId, tenantId),
            inArray(pullRequests.repoId, repoIds),
            inArray(pullRequests.status, ['open', 'draft']),
          ),
        )
        .groupBy(pullRequests.repoId)
    : [];
  const recordedOpenByRepo = new Map<string, number>(
    recordedOpen.filter((r) => r.repoId != null).map((r) => [r.repoId as string, Number(r.open)]),
  );

  // Live probes, budget-capped. `repos` is already ordered defaults-first, so the
  // repo agents actually dispatch against is the one that always gets probed.
  const probable = repos.filter((r) => r.provider === 'github').slice(0, LIVE_PROBE_BUDGET);
  const probes = new Map<string, RepoDeliveryProbe>(
    await Promise.all(
      probable.map(async (r) => [r.id, await probeRepoDelivery(env, db, secret, tenantId, r.id)] as const),
    ),
  );

  const byProject = new Map<number, ProjectConnection[]>();
  const push = (projectId: number, conn: ProjectConnection) => {
    const list = byProject.get(projectId);
    if (list) list.push(conn);
    else byProject.set(projectId, [conn]);
  };

  for (const r of repos) {
    const probe = probes.get(r.id);
    const recorded = recordedOpenByRepo.get(r.id) ?? 0;
    // A repo with no credential and no probe is still a real connection — it just
    // cannot be verified. Say 'unknown', never a green tick.
    const fallbackReason: ProjectConnectionReason = r.credentialId ? 'not_probed' : 'no_credential';
    push(r.projectId, {
      kind: 'source_control',
      provider: r.provider,
      label: `${r.owner}/${r.repo}`,
      url: repoWebUrl(r.provider, r.host, r.owner, r.repo),
      health: probe?.health ?? 'unknown',
      reason: probe ? probe.reason : fallbackReason,
      isDefault: r.isDefault,
      openPullRequests: probe?.openPullRequests ?? recorded,
      openPullRequestsRecordedOnly: probe?.openPullRequests == null,
      buildStatus: probe?.buildStatus ?? null,
      buildUrl: probe?.buildUrl ?? null,
      buildBranch: probe?.buildBranch ?? null,
      buildAt: probe?.buildAt ?? null,
      lastSyncedAt: toIso(r.lastSyncedAt),
    });
  }

  for (const b of boards) {
    const { health, reason } = boardHealth(b.status);
    push(b.projectId, {
      kind: 'board',
      provider: b.provider,
      label: b.externalBoardId ?? b.provider,
      url: null,
      health,
      reason,
      isDefault: false,
      openPullRequests: null,
      openPullRequestsRecordedOnly: false,
      buildStatus: null,
      buildUrl: null,
      buildBranch: null,
      buildAt: null,
      lastSyncedAt: toIso(b.lastPolledAt),
    });
  }

  return [...byProject.entries()].map(([projectId, connections]) => ({ projectId, connections }));
}
