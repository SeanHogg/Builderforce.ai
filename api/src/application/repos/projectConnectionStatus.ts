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
 * WHAT IS PROBED AND WHAT IS DB-DERIVED — AND WHY NOTHING IS PROBED HERE
 * Build status + open pulls come from `repo_delivery_status`, a table a scheduled
 * sweep (`repos/repoDelivery.ts` → `runRepoDeliverySweep`) keeps current for EVERY
 * provider. This composer used to call the provider itself, and that produced two
 * cohorts of permanent `unknown`: GitLab/Bitbucket repos, for which no reader
 * existed, and every repo past a per-composition subrequest budget. Moving the
 * conversation off the read path removed the budget's reason to exist, which is
 * what made the other providers affordable — one fix for both.
 *
 * Everything else (which connections exist, board sync health, last sync time) is
 * DB-derived and always was. A repo the sweep has not reached yet reports
 * `unknown` with `not_probed` and falls back to the Builderforce-recorded PR
 * count, exactly as before — never a green tick it cannot justify.
 *
 * COST
 * Three grouped DB queries, ZERO provider subrequests, however many repos the
 * tenant has. The composed payload is still cached per tenant by the route.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { boardConnections, projectRepositories, pullRequests } from '../../infrastructure/database/schema';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { loadRepoDelivery, refreshRepoDelivery } from './repoDelivery';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export type ProjectConnectionKind = 'source_control' | 'board';

// The health / reason / build vocabularies are declared ONCE, beside the probe
// that produces them, and re-exported here so every existing consumer of this
// module's types keeps working without a second definition to drift from.
export type {
  ProjectConnectionHealth,
  ProjectConnectionReason,
  ProjectBuildStatus,
} from './repoDelivery';
import type { ProjectConnectionHealth, ProjectConnectionReason, ProjectBuildStatus } from './repoDelivery';

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
  /** When the delivery sweep last reached this repo's provider. Null = never. The
   *  verdict's AGE, so a stale one can be shown as stale rather than as fresh. */
  buildProbedAt: string | null;
  /** ISO timestamp of the last successful sync/poll, when the connection tracks one. */
  lastSyncedAt: string | null;
}

export interface ProjectConnectionsSummary {
  projectId: number;
  connections: ProjectConnection[];
}

/** Read-through cache key for a tenant's composed project-connections payload. */
export function projectConnectionsKey(tenantId: number): string {
  return `project-connections:t:${tenantId}`;
}

/**
 * Drop a tenant's composed connections payload, and re-probe the repo that changed.
 *
 * Called from every repo/board write so attaching a repo shows up immediately. The
 * re-probe is what makes a NEWLY attached repo show a real verdict now rather than
 * `unknown` until the sweep's next tick — the read path no longer probes anything,
 * so without it the first thing an operator sees after connecting a repo would be
 * the absence of an answer. `repoId` is optional: omit it for board writes.
 */
export async function invalidateProjectConnections(env: Env, tenantId: number, repoId?: string, db?: Db): Promise<void> {
  await invalidateCached(env, projectConnectionsKey(tenantId));
  if (repoId && db) await refreshRepoDelivery(env, db, tenantId, repoId).catch(() => undefined);
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

  // The sweep's persisted verdicts — one query for the whole tenant, no provider
  // calls, no per-repo budget. A repo the sweep has not reached yet is simply absent.
  const probes = await loadRepoDelivery(db, tenantId);

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
      buildProbedAt: probe?.probedAt ?? null,
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
      buildProbedAt: null,
      lastSyncedAt: toIso(b.lastPolledAt),
    });
  }

  return [...byProject.entries()].map(([projectId, connections]) => ({ projectId, connections }));
}
