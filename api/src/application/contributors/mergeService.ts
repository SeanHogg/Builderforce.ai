/**
 * Contributor consolidation (migration 0205) — merge duplicate contributor
 * profiles that activity ingestion created when it couldn't auto-link the same
 * person across sources (a GitHub login vs a Jira account id vs a Builderforce
 * user). Tenant-wide and reversible.
 *
 * Design:
 *  - The bulk thing (activity_events) is re-pointed set-based and stamped with
 *    `merged_from_contributor_id`, so an un-merge moves exactly those rows back
 *    without logging every id.
 *  - contributor_daily_metrics is DERIVED from activity_events, so it's recomputed
 *    (delete + grouped re-insert) for the affected contributors rather than
 *    hand-merged — see {@link recomputeContributorDailyMetrics}.
 *  - The small things without a column marker (moved/deduped identities, team
 *    memberships, the survivor's prior user link) are snapshotted into
 *    contributor_merges.undo_payload so a revert restores them exactly.
 *  - All mutations for one merge/revert run in a single db.batch (neon-http has no
 *    interactive transaction; batch is the atomic unit). Derived-metric recompute
 *    runs after — it's idempotent, so a partial failure is re-runnable.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  contributors,
  contributorIdentities,
  contributorDailyMetrics,
  contributorMerges,
  activityEvents,
  devTeamMembers,
} from '../../infrastructure/database/schema';
import { bumpWorkforceMetricsVersion } from '../metrics/workforceMetrics';
import { bumpTenantActivityVersion } from '../analytics/tenantActivity';

type Contributor = typeof contributors.$inferSelect;
type Identity = typeof contributorIdentities.$inferSelect;

export class MergeError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

// ── derived daily-metrics recompute (set-based, bounded by distinct days) ──────
/**
 * Rebuild contributor_daily_metrics for one contributor straight from
 * activity_events. Delete-then-insert (not upsert) so days that no longer have
 * events are dropped — correct for both the survivor (gains days) and, on revert,
 * either side (may lose days). Mirrors the per-event weights in
 * contributorRoutes.aggregateDailyMetrics.
 */
export async function recomputeContributorDailyMetrics(
  db: Db,
  tenantId: number,
  contributorId: number,
  segmentId: string | null,
): Promise<void> {
  await db
    .delete(contributorDailyMetrics)
    .where(and(
      eq(contributorDailyMetrics.tenantId, tenantId),
      eq(contributorDailyMetrics.contributorId, contributorId),
    ));

  await db.execute(sql`
    INSERT INTO contributor_daily_metrics
      (tenant_id, segment_id, contributor_id, date,
       commits, prs_opened, prs_merged, prs_reviewed, issues_created, issues_resolved,
       lines_added, lines_removed, files_changed, activity_score, is_active_day, created_at, updated_at)
    SELECT
      ${tenantId}, ${segmentId}::uuid, ${contributorId},
      date_trunc('day', occurred_at),
      count(*) FILTER (WHERE event_type = 'commit')::int,
      count(*) FILTER (WHERE event_type = 'pr_opened')::int,
      count(*) FILTER (WHERE event_type = 'pr_merged')::int,
      count(*) FILTER (WHERE event_type = 'pr_reviewed')::int,
      count(*) FILTER (WHERE event_type = 'issue_created')::int,
      count(*) FILTER (WHERE event_type = 'issue_resolved')::int,
      coalesce(sum(lines_added), 0)::int,
      coalesce(sum(lines_removed), 0)::int,
      coalesce(sum(files_changed), 0)::int,
      round(
        count(*) FILTER (WHERE event_type = 'commit')
        + count(*) FILTER (WHERE event_type IN ('pr_opened', 'pr_merged')) * 3
        + count(*) FILTER (WHERE event_type = 'pr_reviewed') * 2
        + count(*) FILTER (WHERE event_type IN ('issue_created', 'issue_resolved')) * 1.5
      )::int,
      bool_or(event_type IN ('commit', 'pr_opened', 'pr_merged')),
      NOW(), NOW()
    FROM activity_events
    WHERE tenant_id = ${tenantId} AND contributor_id = ${contributorId}
    GROUP BY date_trunc('day', occurred_at)
  `);
}

// ── preview ────────────────────────────────────────────────────────────────
export interface MergePreview {
  source: { id: number; displayName: string; userId: string | null };
  target: { id: number; displayName: string; userId: string | null };
  movedActivityCount: number;
  movedIdentityCount: number;
  dedupedIdentityCount: number;
  movedTeamCount: number;
  dedupedTeamCount: number;
  /** Whether the survivor will inherit the source's Builderforce user link. */
  willInheritUserLink: boolean;
}

async function loadPair(db: Db, tenantId: number, sourceId: number, targetId: number) {
  if (sourceId === targetId) throw new MergeError('Cannot merge a contributor into itself');
  const rows = await db
    .select()
    .from(contributors)
    .where(and(eq(contributors.tenantId, tenantId), inArray(contributors.id, [sourceId, targetId])));
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);
  if (!source || !target) throw new MergeError('Contributor not found', 404);
  if (source.kind !== 'human' || target.kind !== 'human') {
    throw new MergeError('Only human contributors can be merged (agents are keyed by their host)', 409);
  }
  if (source.mergedIntoId != null) throw new MergeError('Source contributor is already merged', 409);
  return { source, target };
}

function partitionIdentities(sourceIds: Identity[], targetIds: Identity[]) {
  const targetKeys = new Set(targetIds.map((i) => `${i.provider}:${i.externalId}`));
  const move: Identity[] = [];
  const dedupe: Identity[] = [];
  for (const i of sourceIds) {
    (targetKeys.has(`${i.provider}:${i.externalId}`) ? dedupe : move).push(i);
  }
  return { move, dedupe };
}

export async function previewMerge(
  db: Db,
  tenantId: number,
  sourceId: number,
  targetId: number,
): Promise<MergePreview> {
  const { source, target } = await loadPair(db, tenantId, sourceId, targetId);

  const [srcIdentities, tgtIdentities] = await Promise.all([
    db.select().from(contributorIdentities).where(and(eq(contributorIdentities.tenantId, tenantId), eq(contributorIdentities.contributorId, sourceId))),
    db.select().from(contributorIdentities).where(and(eq(contributorIdentities.tenantId, tenantId), eq(contributorIdentities.contributorId, targetId))),
  ]);
  const { move, dedupe } = partitionIdentities(srcIdentities, tgtIdentities);

  const [actCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityEvents)
    .where(and(eq(activityEvents.tenantId, tenantId), eq(activityEvents.contributorId, sourceId)));

  const [srcTeams, tgtTeams] = await Promise.all([
    db.select({ id: devTeamMembers.id, teamId: devTeamMembers.teamId }).from(devTeamMembers).where(eq(devTeamMembers.contributorId, sourceId)),
    db.select({ teamId: devTeamMembers.teamId }).from(devTeamMembers).where(eq(devTeamMembers.contributorId, targetId)),
  ]);
  const tgtTeamIds = new Set(tgtTeams.map((t) => t.teamId));
  const movedTeamCount = srcTeams.filter((t) => !tgtTeamIds.has(t.teamId)).length;
  const dedupedTeamCount = srcTeams.length - movedTeamCount;

  return {
    source: { id: source.id, displayName: source.displayName, userId: source.userId },
    target: { id: target.id, displayName: target.displayName, userId: target.userId },
    movedActivityCount: actCount?.n ?? 0,
    movedIdentityCount: move.length,
    dedupedIdentityCount: dedupe.length,
    movedTeamCount,
    dedupedTeamCount,
    willInheritUserLink: target.userId == null && source.userId != null,
  };
}

// ── merge ────────────────────────────────────────────────────────────────────
interface UndoPayload {
  source: Contributor;
  movedIdentityIds: number[];
  dedupedIdentities: Array<Pick<Identity, 'contributorId' | 'tenantId' | 'segmentId' | 'provider' | 'externalId' | 'externalEmail' | 'displayName' | 'avatarUrl'>>;
  movedTeamMemberships: Array<{ id: number; teamId: number; memberRole: string }>;
  dedupedTeamMemberships: Array<{ teamId: number; memberRole: string }>;
  priorTargetUserId: string | null;
  appliedUserId: string | null;
}

export interface MergeResult {
  mergeId: string;
  movedActivityCount: number;
  movedIdentityCount: number;
}

export async function mergeContributors(
  db: Db,
  env: Env,
  params: { tenantId: number; sourceId: number; targetId: number; mergedByUserId?: string | null },
): Promise<MergeResult> {
  const { tenantId, sourceId, targetId } = params;
  const { source, target } = await loadPair(db, tenantId, sourceId, targetId);

  const [srcIdentities, tgtIdentities, srcTeams, tgtTeams, actCountRow] = await Promise.all([
    db.select().from(contributorIdentities).where(and(eq(contributorIdentities.tenantId, tenantId), eq(contributorIdentities.contributorId, sourceId))),
    db.select().from(contributorIdentities).where(and(eq(contributorIdentities.tenantId, tenantId), eq(contributorIdentities.contributorId, targetId))),
    db.select({ id: devTeamMembers.id, teamId: devTeamMembers.teamId, memberRole: devTeamMembers.memberRole }).from(devTeamMembers).where(eq(devTeamMembers.contributorId, sourceId)),
    db.select({ teamId: devTeamMembers.teamId }).from(devTeamMembers).where(eq(devTeamMembers.contributorId, targetId)),
    db.select({ n: sql<number>`count(*)::int` }).from(activityEvents).where(and(eq(activityEvents.tenantId, tenantId), eq(activityEvents.contributorId, sourceId))),
  ]);

  const { move: moveIds, dedupe: dedupeIds } = partitionIdentities(srcIdentities, tgtIdentities);
  const tgtTeamIds = new Set(tgtTeams.map((t) => t.teamId));
  const moveTeams = srcTeams.filter((t) => !tgtTeamIds.has(t.teamId));
  const dedupeTeams = srcTeams.filter((t) => tgtTeamIds.has(t.teamId));

  const appliedUserId = target.userId == null && source.userId != null ? source.userId : null;
  const mergeId = crypto.randomUUID();

  const undo: UndoPayload = {
    source,
    movedIdentityIds: moveIds.map((i) => i.id),
    dedupedIdentities: dedupeIds.map((i) => ({
      contributorId: targetId, tenantId: i.tenantId, segmentId: i.segmentId,
      provider: i.provider, externalId: i.externalId, externalEmail: i.externalEmail,
      displayName: i.displayName, avatarUrl: i.avatarUrl,
    })),
    movedTeamMemberships: moveTeams.map((t) => ({ id: t.id, teamId: t.teamId, memberRole: t.memberRole })),
    dedupedTeamMemberships: dedupeTeams.map((t) => ({ teamId: t.teamId, memberRole: t.memberRole })),
    priorTargetUserId: target.userId,
    appliedUserId,
  };

  // ── one atomic batch: re-point, dedupe, tombstone, log ──────────────────────
  const ops: unknown[] = [];
  ops.push(
    db.update(activityEvents)
      .set({ contributorId: targetId, mergedFromContributorId: sourceId })
      .where(and(eq(activityEvents.tenantId, tenantId), eq(activityEvents.contributorId, sourceId))),
  );
  if (moveIds.length) {
    ops.push(db.update(contributorIdentities).set({ contributorId: targetId }).where(inArray(contributorIdentities.id, moveIds.map((i) => i.id))));
  }
  if (dedupeIds.length) {
    ops.push(db.delete(contributorIdentities).where(inArray(contributorIdentities.id, dedupeIds.map((i) => i.id))));
  }
  if (moveTeams.length) {
    ops.push(db.update(devTeamMembers).set({ contributorId: targetId }).where(inArray(devTeamMembers.id, moveTeams.map((t) => t.id))));
  }
  if (dedupeTeams.length) {
    ops.push(db.delete(devTeamMembers).where(inArray(devTeamMembers.id, dedupeTeams.map((t) => t.id))));
  }
  if (appliedUserId) {
    ops.push(db.update(contributors).set({ userId: appliedUserId, updatedAt: new Date() }).where(eq(contributors.id, targetId)));
  }
  ops.push(
    db.update(contributors)
      .set({ isActive: false, mergedIntoId: targetId, updatedAt: new Date() })
      .where(eq(contributors.id, sourceId)),
  );
  ops.push(
    db.insert(contributorMerges).values({
      id: mergeId,
      tenantId,
      segmentId: target.segmentId,
      targetContributorId: targetId,
      sourceContributorId: sourceId,
      movedActivityCount: actCountRow[0]?.n ?? 0,
      movedIdentityCount: moveIds.length,
      undoPayload: undo,
      status: 'merged',
      mergedByUserId: params.mergedByUserId ?? null,
    }),
  );

  // drizzle's batch is typed as a non-empty tuple; we always have ≥2 ops.
  await db.batch(ops as unknown as Parameters<typeof db.batch>[0]);

  // Derived metrics: survivor gains the moved days; loser has no events left.
  await db.delete(contributorDailyMetrics).where(and(eq(contributorDailyMetrics.tenantId, tenantId), eq(contributorDailyMetrics.contributorId, sourceId)));
  await recomputeContributorDailyMetrics(db, tenantId, targetId, target.segmentId);

  await bumpWorkforceMetricsVersion(env, tenantId).catch(() => {});
  await bumpTenantActivityVersion(env, tenantId).catch(() => {});

  return { mergeId, movedActivityCount: actCountRow[0]?.n ?? 0, movedIdentityCount: moveIds.length };
}

// ── un-merge (revert) ──────────────────────────────────────────────────────────
export async function unmergeContributors(
  db: Db,
  env: Env,
  params: { tenantId: number; mergeId: string },
): Promise<{ reverted: true; sourceId: number; targetId: number }> {
  const { tenantId, mergeId } = params;
  const [record] = await db
    .select()
    .from(contributorMerges)
    .where(and(eq(contributorMerges.id, mergeId), eq(contributorMerges.tenantId, tenantId)));
  if (!record) throw new MergeError('Merge record not found', 404);
  if (record.status !== 'merged') throw new MergeError('Merge has already been reverted', 409);

  const sourceId = record.sourceContributorId;
  const targetId = record.targetContributorId;
  if (sourceId == null || targetId == null) {
    throw new MergeError('Cannot revert: a participating contributor was hard-deleted', 409);
  }
  const undo = record.undoPayload as UndoPayload | null;
  if (!undo) throw new MergeError('Merge record is missing its undo payload', 409);

  const ops: unknown[] = [];
  // 1. Move the survivor's re-pointed events back to the source.
  ops.push(
    db.update(activityEvents)
      .set({ contributorId: sourceId, mergedFromContributorId: null })
      .where(and(
        eq(activityEvents.tenantId, tenantId),
        eq(activityEvents.contributorId, targetId),
        eq(activityEvents.mergedFromContributorId, sourceId),
      )),
  );
  // 2. Move moved identities back.
  if (undo.movedIdentityIds.length) {
    ops.push(
      db.update(contributorIdentities)
        .set({ contributorId: sourceId })
        .where(and(inArray(contributorIdentities.id, undo.movedIdentityIds), eq(contributorIdentities.contributorId, targetId))),
    );
  }
  // 3. Recreate the deduped identities on the source. Reconcile post-merge
  //    collisions: if the survivor re-acquired this identity after the merge, the
  //    unique (tenant, provider, external_id) key conflicts — reassign ownership
  //    back to the source, which is its exact pre-merge state (the source owned it
  //    before; dedupe only deleted the duplicate). Deterministic, not best-effort.
  for (const i of undo.dedupedIdentities) {
    ops.push(
      db.insert(contributorIdentities)
        .values({ ...i, contributorId: sourceId })
        .onConflictDoUpdate({
          target: [contributorIdentities.tenantId, contributorIdentities.provider, contributorIdentities.externalId],
          set: { contributorId: sourceId },
        }),
    );
  }
  // 4. Move moved team memberships back.
  const moveBackTeamIds = undo.movedTeamMemberships.map((t) => t.id);
  if (moveBackTeamIds.length) {
    ops.push(db.update(devTeamMembers).set({ contributorId: sourceId }).where(inArray(devTeamMembers.id, moveBackTeamIds)));
  }
  // 5. Recreate deduped team memberships on the source.
  for (const t of undo.dedupedTeamMemberships) {
    ops.push(db.insert(devTeamMembers).values({ teamId: t.teamId, contributorId: sourceId, memberRole: t.memberRole }).onConflictDoNothing());
  }
  // 6. Roll back the inherited user link if the merge applied one.
  if (undo.appliedUserId) {
    ops.push(db.update(contributors).set({ userId: undo.priorTargetUserId, updatedAt: new Date() }).where(eq(contributors.id, targetId)));
  }
  // 7. Reactivate the source (restore its prior is_active; drop the tombstone).
  ops.push(
    db.update(contributors)
      .set({ isActive: undo.source.isActive, mergedIntoId: null, updatedAt: new Date() })
      .where(eq(contributors.id, sourceId)),
  );
  // 8. Mark the merge reverted.
  ops.push(
    db.update(contributorMerges)
      .set({ status: 'reverted', revertedAt: new Date() })
      .where(eq(contributorMerges.id, mergeId)),
  );

  await db.batch(ops as unknown as Parameters<typeof db.batch>[0]);

  // Recompute derived metrics for both sides from their (now-restored) events.
  await recomputeContributorDailyMetrics(db, tenantId, sourceId, undo.source.segmentId);
  await recomputeContributorDailyMetrics(db, tenantId, targetId, record.segmentId);

  await bumpWorkforceMetricsVersion(env, tenantId).catch(() => {});
  await bumpTenantActivityVersion(env, tenantId).catch(() => {});

  return { reverted: true, sourceId, targetId };
}

// ── duplicate suggestions ──────────────────────────────────────────────────────
export interface DuplicateGroup {
  reason: 'email' | 'identity_email' | 'name';
  key: string;
  contributors: Array<{ id: number; displayName: string; email: string | null; userId: string | null }>;
}

/**
 * Surface likely-duplicate human contributors so an owner can consolidate them.
 * Groups live (un-merged) contributors that share a normalized email, an identity
 * email, or a normalized display name. Cheap heuristic — the owner confirms each
 * merge; we never auto-merge.
 */
export async function suggestDuplicates(db: Db, tenantId: number): Promise<DuplicateGroup[]> {
  const people = await db
    .select({ id: contributors.id, displayName: contributors.displayName, email: contributors.email, userId: contributors.userId })
    .from(contributors)
    .where(and(eq(contributors.tenantId, tenantId), eq(contributors.kind, 'human'), eq(contributors.isActive, true)));
  if (people.length < 2) return [];

  const identities = await db
    .select({ contributorId: contributorIdentities.contributorId, externalEmail: contributorIdentities.externalEmail })
    .from(contributorIdentities)
    .where(eq(contributorIdentities.tenantId, tenantId));

  const byId = new Map(people.map((p) => [p.id, p]));
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

  const buckets = new Map<string, { reason: DuplicateGroup['reason']; ids: Set<number> }>();
  const add = (reason: DuplicateGroup['reason'], key: string, id: number) => {
    if (!key) return;
    const k = `${reason}:${key}`;
    const b = buckets.get(k) ?? { reason, ids: new Set<number>() };
    b.ids.add(id);
    buckets.set(k, b);
  };

  for (const p of people) {
    add('email', norm(p.email), p.id);
    add('name', norm(p.displayName), p.id);
  }
  for (const i of identities) {
    if (byId.has(i.contributorId)) add('identity_email', norm(i.externalEmail), i.contributorId);
  }

  const out: DuplicateGroup[] = [];
  for (const [k, b] of buckets) {
    if (b.ids.size < 2) continue;
    const key = k.slice(k.indexOf(':') + 1);
    out.push({
      reason: b.reason,
      key,
      contributors: [...b.ids].map((id) => byId.get(id)!).filter(Boolean),
    });
  }
  // Email/identity matches are stronger signals than name — surface them first.
  const rank = { email: 0, identity_email: 1, name: 2 } as const;
  return out.sort((a, b) => rank[a.reason] - rank[b.reason]);
}
