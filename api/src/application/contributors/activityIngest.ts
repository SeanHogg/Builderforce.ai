/**
 * Activity ingestion core (the producer→store seam).
 *
 * One canonical path that turns provider events (GitHub commits / PRs / reviews /
 * issues, posted either by the live webhook or the REST ingest endpoint) into
 * `activity_events` rows — the stream every downstream surface reads (tenant
 * rollup, engagement, contributor metrics, consolidation/merge).
 *
 * Three responsibilities, all shared so the webhook and the REST endpoint behave
 * identically (DRY):
 *   1. {@link resolveOrCreateContributor} — map a provider author to a contributor,
 *      AUTO-CREATING the contributor + identity on first sight. This closes the
 *      "orphan activity" gap: an event is never dropped to contributor_id NULL just
 *      because the author wasn't pre-registered — a profile appears, ready for the
 *      owner to merge/link in the Workforce tab.
 *   2. {@link resolveProjectForRepo} — attribute the event to a project via the
 *      connected repo (project_repositories owner/repo, else the project's
 *      source_control_repo_full_name), so the rollup can break down by project.
 *   3. {@link ingestActivityEvents} — insert (idempotent), refresh the affected
 *      contributor-days' derived metrics once per (contributor, day), and bump the
 *      read-through cache version tokens so the rollup/engagement reflect it.
 *
 * Repo→project / repo→tenant resolution is a single indexed lookup, MEMOIZED per
 * call (a push delivers many commits for one repo — avoid the N+1) but deliberately
 * NOT cross-request cached: a freshly-linked repo's first events must attribute to
 * the new project immediately, and storing a stale NULL would be permanent.
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  activityEvents,
  contributorDailyMetrics,
  contributorIdentities,
  contributors,
  projectRepositories,
  projects,
} from '../../infrastructure/database/schema';
import { bumpWorkforceMetricsVersion } from '../metrics/workforceMetrics';
import { bumpTenantActivityVersion } from '../analytics/tenantActivity';

type ActivityInsert = typeof activityEvents.$inferInsert;
export type ActivityProvider = ActivityInsert['provider'];
export type ActivityEventType = ActivityInsert['eventType'];

/** A normalized activity event ready to ingest, independent of source transport. */
export interface IngestEvent {
  eventType: ActivityEventType;
  externalId?: string | null;
  /** Provider identifier for the author (GitHub login, else email). Auto-creates a
   *  contributor + identity when unseen; null/absent → event is stored unattributed. */
  contributorExternalId?: string | null;
  /** Optional author profile used when auto-creating the contributor. */
  authorDisplayName?: string | null;
  authorEmail?: string | null;
  authorAvatarUrl?: string | null;
  repositoryName?: string | null;
  repositoryFullName?: string | null;
  title?: string | null;
  url?: string | null;
  linesAdded?: number | null;
  linesRemoved?: number | null;
  filesChanged?: number | null;
  cycleTimeHours?: number | null;
  occurredAt: string | Date;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
}

// ── repo → project / tenant resolution ───────────────────────────────────────

/** Split "owner/repo" → its parts (lower-cased owner for case-insensitive match). */
function splitRepoFullName(repoFullName: string): { owner: string; repo: string } | null {
  const slash = repoFullName.indexOf('/');
  if (slash <= 0 || slash === repoFullName.length - 1) return null;
  return { owner: repoFullName.slice(0, slash), repo: repoFullName.slice(slash + 1) };
}

/**
 * The project a connected repo belongs to, within a known tenant. Prefers the
 * structured `project_repositories` link, falling back to the legacy
 * `projects.source_control_repo_full_name` field the issue-dispatch path uses.
 */
export async function resolveProjectForRepo(
  db: Db,
  tenantId: number,
  repoFullName: string,
): Promise<number | null> {
  const parts = splitRepoFullName(repoFullName);
  if (parts) {
    const [link] = await db
      .select({ projectId: projectRepositories.projectId })
      .from(projectRepositories)
      .where(and(
        eq(projectRepositories.tenantId, tenantId),
        eq(projectRepositories.owner, parts.owner),
        eq(projectRepositories.repo, parts.repo),
      ))
      .limit(1);
    if (link) return link.projectId;
  }
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.sourceControlRepoFullName, repoFullName)))
    .limit(1);
  return proj?.id ?? null;
}

export interface RepoLink { tenantId: number; projectId: number | null; }

/**
 * Resolve a repo to its owning tenant + project WITHOUT a tenant context — for the
 * webhook, which only knows the repo full name. A repo normally belongs to one
 * tenant; if linked by more than one we take the first (documented edge).
 */
export async function resolveRepoLink(db: Db, repoFullName: string): Promise<RepoLink | null> {
  const parts = splitRepoFullName(repoFullName);
  if (parts) {
    const [link] = await db
      .select({ tenantId: projectRepositories.tenantId, projectId: projectRepositories.projectId })
      .from(projectRepositories)
      .where(and(eq(projectRepositories.owner, parts.owner), eq(projectRepositories.repo, parts.repo)))
      .limit(1);
    if (link) return { tenantId: link.tenantId, projectId: link.projectId };
  }
  const [proj] = await db
    .select({ tenantId: projects.tenantId, id: projects.id })
    .from(projects)
    .where(eq(projects.sourceControlRepoFullName, repoFullName))
    .limit(1);
  return proj ? { tenantId: proj.tenantId, projectId: proj.id } : null;
}

// ── author → contributor (auto-create on first sight) ─────────────────────────

/**
 * Map a provider author to a contributor id, creating the contributor + identity
 * if this author has never been seen. Race-safe without an interactive transaction
 * (neon-http): if a concurrent insert wins the identity's unique key, we adopt the
 * winner and drop the contributor row we speculatively created.
 */
export async function resolveOrCreateContributor(
  db: Db,
  tenantId: number,
  provider: ActivityProvider,
  externalId: string,
  profile: { displayName?: string | null; email?: string | null; avatarUrl?: string | null },
): Promise<number> {
  const find = async (): Promise<number | null> => {
    const [row] = await db
      .select({ contributorId: contributorIdentities.contributorId })
      .from(contributorIdentities)
      .where(and(
        eq(contributorIdentities.tenantId, tenantId),
        eq(contributorIdentities.provider, provider),
        eq(contributorIdentities.externalId, externalId),
      ))
      .limit(1);
    return row?.contributorId ?? null;
  };

  const existing = await find();
  if (existing != null) return existing;

  const [created] = await db
    .insert(contributors)
    .values({
      tenantId,
      displayName: (profile.displayName?.trim() || externalId),
      email: profile.email ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      roleType: 'developer',
      kind: 'human',
    })
    .returning({ id: contributors.id });
  if (!created) {
    // Insert returned no row (shouldn't happen) — fall back to any identity that
    // may have appeared, else surface the failure rather than store a bad ref.
    const fallback = await find();
    if (fallback != null) return fallback;
    throw new Error('failed to create contributor');
  }

  const [identity] = await db
    .insert(contributorIdentities)
    .values({
      contributorId: created.id,
      tenantId,
      provider,
      externalId,
      externalEmail: profile.email ?? null,
      displayName: profile.displayName ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: contributorIdentities.id });

  if (identity) return created.id;

  // Lost the race: another writer created this identity. Adopt theirs and clean up
  // the contributor we just made so we don't leave a duplicate empty profile.
  const winner = await find();
  await db.delete(contributors).where(eq(contributors.id, created.id));
  return winner ?? created.id;
}

// ── derived daily metrics (one recompute per affected contributor-day) ─────────

/**
 * Rebuild one contributor's metrics for one UTC day straight from activity_events.
 * Upsert (not delete-then-insert) so re-ingesting the same day is idempotent.
 * Mirrors the weights in {@link recomputeContributorDailyMetrics}.
 */
export async function aggregateDailyMetrics(
  db: Db,
  tenantId: number,
  contributorId: number,
  date: Date,
): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const events = await db
    .select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.contributorId, contributorId),
      gte(activityEvents.occurredAt, dayStart),
      lte(activityEvents.occurredAt, dayEnd),
    ));

  const m = {
    commits:        events.filter((e) => e.eventType === 'commit').length,
    prsOpened:      events.filter((e) => e.eventType === 'pr_opened').length,
    prsMerged:      events.filter((e) => e.eventType === 'pr_merged').length,
    prsReviewed:    events.filter((e) => e.eventType === 'pr_reviewed').length,
    issuesCreated:  events.filter((e) => e.eventType === 'issue_created').length,
    issuesResolved: events.filter((e) => e.eventType === 'issue_resolved').length,
    linesAdded:     events.reduce((s, e) => s + (e.linesAdded ?? 0), 0),
    linesRemoved:   events.reduce((s, e) => s + (e.linesRemoved ?? 0), 0),
    filesChanged:   events.reduce((s, e) => s + (e.filesChanged ?? 0), 0),
  };

  // Weighted activity score: commits×1 + PRs×3 + reviews×2 + issues×1.5
  const activityScore = Math.round(
    m.commits * 1 +
    (m.prsOpened + m.prsMerged) * 3 +
    m.prsReviewed * 2 +
    (m.issuesCreated + m.issuesResolved) * 1.5,
  );
  const isActiveDay = m.commits > 0 || m.prsOpened > 0 || m.prsMerged > 0;

  await db
    .insert(contributorDailyMetrics)
    .values({ tenantId, contributorId, date: dayStart, ...m, activityScore, isActiveDay })
    .onConflictDoUpdate({
      target: [contributorDailyMetrics.tenantId, contributorDailyMetrics.contributorId, contributorDailyMetrics.date],
      set: { ...m, activityScore, isActiveDay, updatedAt: new Date() },
    });
}

// ── ingest core ──────────────────────────────────────────────────────────────

/**
 * Ingest a batch of normalized events for one tenant + provider. Idempotent on the
 * (tenant, provider, eventType, externalId) unique key. Resolves each author to a
 * contributor (auto-creating) and each repo to a project, refreshes the touched
 * contributor-days' metrics once each, and bumps the rollup/engagement caches.
 */
export async function ingestActivityEvents(
  env: Env,
  db: Db,
  args: { tenantId: number; provider: ActivityProvider; events: IngestEvent[] },
): Promise<IngestResult> {
  const { tenantId, provider, events } = args;
  let inserted = 0;
  let skipped = 0;
  const now = new Date();

  // Per-call memoization — kill the N+1 across a push's many commits / a batch.
  const contributorCache = new Map<string, number>();
  const projectCache = new Map<string, number | null>();
  // Distinct (contributorId, dayUTC) pairs to recompute once after the inserts.
  const touched = new Map<string, { contributorId: number; day: Date }>();

  for (const ev of events) {
    let contributorId: number | null = null;
    const extId = ev.contributorExternalId?.trim();
    if (extId) {
      const cached = contributorCache.get(extId);
      if (cached != null) {
        contributorId = cached;
      } else {
        contributorId = await resolveOrCreateContributor(db, tenantId, provider, extId, {
          displayName: ev.authorDisplayName,
          email: ev.authorEmail,
          avatarUrl: ev.authorAvatarUrl,
        });
        contributorCache.set(extId, contributorId);
      }
    }

    let projectId: number | null = null;
    if (ev.repositoryFullName) {
      if (projectCache.has(ev.repositoryFullName)) {
        projectId = projectCache.get(ev.repositoryFullName)!;
      } else {
        projectId = await resolveProjectForRepo(db, tenantId, ev.repositoryFullName);
        projectCache.set(ev.repositoryFullName, projectId);
      }
    }

    const occurredAt = ev.occurredAt instanceof Date ? ev.occurredAt : new Date(ev.occurredAt);

    try {
      const [row] = await db
        .insert(activityEvents)
        .values({
          tenantId,
          contributorId,
          projectId,
          provider,
          eventType:          ev.eventType,
          externalId:         ev.externalId ?? null,
          repositoryName:     ev.repositoryName ?? null,
          repositoryFullName: ev.repositoryFullName ?? null,
          title:              ev.title ?? null,
          url:                ev.url ?? null,
          linesAdded:         ev.linesAdded ?? null,
          linesRemoved:       ev.linesRemoved ?? null,
          filesChanged:       ev.filesChanged ?? null,
          cycleTimeHours:     ev.cycleTimeHours ?? null,
          occurredAt,
          createdAt:          now,
        })
        .onConflictDoNothing()
        .returning({ id: activityEvents.id });

      if (row) {
        inserted++;
        if (contributorId != null) {
          const day = new Date(occurredAt);
          day.setUTCHours(0, 0, 0, 0);
          touched.set(`${contributorId}:${day.getTime()}`, { contributorId, day });
        }
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  // Refresh derived metrics once per affected (contributor, day).
  for (const { contributorId, day } of touched.values()) {
    await aggregateDailyMetrics(db, tenantId, contributorId, day).catch(() => {});
  }

  // Invalidate the read-through caches that read this stream so the owner's rollup
  // and the engagement scores reflect the new activity (and any auto-created person).
  if (inserted > 0) {
    await bumpTenantActivityVersion(env, tenantId).catch(() => {});
    await bumpWorkforceMetricsVersion(env, tenantId).catch(() => {});
  }

  return { inserted, skipped };
}
