/**
 * personScoreRead.ts — the DB read that feeds {@link personScore.ts} (WS22, §D14).
 *
 * Builds the per-person, per-role {@link PersonRoleBucket}s for every contributor on a
 * dev_team from the WS16 tables (`run_features`, `run_outcome_labels`, joined to
 * `run_delta_dimensions` for the security count), over the rolling 90-day window
 * (§D14.2). Pure reads — no scoring here; {@link personScore.ts} does the maths.
 *
 * Enterprise default-off (§D14.6): a tenant's human-scoring switch comes from
 * `person_score_settings`, defaulting by plan (`free` ⇒ on, every paid tier ⇒ off). Agent
 * scoring cannot be disabled, so the route filters contributors by kind, not the read.
 */
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  contributors,
  devTeamMembers,
  devTeams,
  personScoreSettings,
  runDeltaDimensions,
  runDeltas,
  runFeatures,
  runOutcomeLabels,
  tenants,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { runOutcomesDatabase, runOutcomeChunks as chunks } from '../runOutcomes/runOutcomeStore';
import { crossTenantConsent } from '../../domain/runOutcomes/runOutcomePolicy';
import {
  ROLE_COLUMN,
  type PersonScoreRole,
  type PersonScoreRunInput,
  type PersonRoleBucket,
} from './personScore';

/** The rolling score window (§D14.2). */
export const PERSON_SCORE_WINDOW_DAYS = 90;

export interface TeamContributor {
  contributorId: number;
  displayName: string;
  kind: string; // 'human' | 'agent'
  userId: string | null;
  teamRole: string; // dev_team_members.member_role
}

/** The contributors on a dev_team (the reporting line is dev_teams → dev_team_members → contributors). */
export async function teamContributors(db: Db, tenantId: number, teamId: number): Promise<TeamContributor[]> {
  const rows = await db
    .select({
      contributorId: contributors.id,
      displayName: contributors.displayName,
      kind: contributors.kind,
      userId: contributors.userId,
      teamRole: devTeamMembers.memberRole,
    })
    .from(devTeamMembers)
    .innerJoin(contributors, eq(devTeamMembers.contributorId, contributors.id))
    .innerJoin(devTeams, eq(devTeamMembers.teamId, devTeams.id))
    .where(and(scopedToTenant(contributors, tenantId), eq(devTeams.id, teamId), eq(contributors.isActive, true)));
  return rows;
}

/**
 * Build the scorer inputs for one contributor over the rolling window: runs whose
 * (run_features.roleColumn) equals the contributor's id, attributed to every role they
 * held. `securityIntroduced` joins the run's `run_deltas` security dimension count.
 */
export async function contributorRunInputs(
  core: Db,
  tenantId: number,
  contributor: Pick<TeamContributor, 'contributorId' | 'userId'>,
  since: Date,
): Promise<PersonScoreRunInput[]> {
  const ops = runOutcomesDatabase(core);
  const personId = String(contributor.userId ?? contributor.contributorId);

  // Runs where this person appears in ANY role column, final-labelled, in the window.
  // The person may appear in ANY of the four role columns (D14.1); match any, not just one.
  const roleConds = (Object.keys(ROLE_COLUMN) as PersonScoreRole[]).map((role) =>
    eq(runFeatures[ROLE_COLUMN[role]], personId));
  const features = await ops
    .select()
    .from(runFeatures)
    .where(scopedToTenant(runFeatures, tenantId, gte(runFeatures.finalizedAt, since), or(...roleConds)));

  // The security introduced count per run, from the security dimension row (when a delta exists).
  const securityByRun = new Map<string, number>();
  if (features.length > 0) {
    for (const part of chunks(features.map((f) => f.runId))) {
      const dims = await ops
        .select({ runId: runDeltas.runId, introduced: runDeltaDimensions.introduced })
        .from(runDeltaDimensions)
        .innerJoin(runDeltas, eq(runDeltaDimensions.runDeltaId, runDeltas.id))
        .where(and(
          scopedToTenant(runDeltas, tenantId),
          inArray(runDeltas.runId, [...new Set(part)]),
          eq(runDeltaDimensions.dimensionId, 'security'),
        ));
      for (const d of dims) securityByRun.set(d.runId, d.introduced);
    }
  }

  // Final labels per run.
  const labelsByRun = new Map<string, Array<{ kind: string; value: boolean | null }>>();
  if (features.length > 0) {
    for (const part of chunks(features.map((f) => f.runId))) {
      const labels = await ops
        .select({ runId: runOutcomeLabels.runId, kind: runOutcomeLabels.kind, value: runOutcomeLabels.value })
        .from(runOutcomeLabels)
        .where(and(
          scopedToTenant(runOutcomeLabels, tenantId),
          inArray(runOutcomeLabels.runId, [...new Set(part)]),
          eq(runOutcomeLabels.status, 'final'),
        ));
      for (const l of labels) labelsByRun.set(l.runId, [...(labelsByRun.get(l.runId) ?? []), { kind: l.kind, value: l.value }]);
    }
  }

  return features.flatMap((f): PersonScoreRunInput[] => {
    const values = f.featureValues as Record<string, number | null>;
    const people: Record<PersonScoreRole, string | null> = {
      requester: f.requesterId,
      approver: f.approverId,
      reviewer: f.reviewerId,
      agent: f.agentId,
    };
    // Attribute to every role the person held on this run (D14.1).
    const heldRoles = (Object.keys(ROLE_COLUMN) as PersonScoreRole[]).filter((r) => people[r] === personId);
    if (heldRoles.length === 0) return [];
    return [{
      runId: f.runId,
      repository: f.repository,
      finalizedAtMs: f.finalizedAt.getTime(),
      values,
      securityIntroduced: securityByRun.get(f.runId) ?? 0,
      labels: labelsByRun.get(f.runId) ?? [],
      people,
    }];
  });
}

/** Group one contributor's runs into per-role buckets (D14.1: a score is reported per role). */
export function bucketsOf(contributorId: number, userId: string | null, runs: readonly PersonScoreRunInput[]): PersonRoleBucket[] {
  const personId = String(userId ?? contributorId);
  const byRole = new Map<PersonScoreRole, PersonScoreRunInput[]>();
  for (const run of runs) {
    for (const role of Object.keys(ROLE_COLUMN) as PersonScoreRole[]) {
      if (run.people[role] === personId) byRole.set(role, [...(byRole.get(role) ?? []), run]);
    }
  }
  return [...byRole.entries()].map(([role, bucketRuns]) => ({ personId: String(contributorId), role, runs: bucketRuns }));
}

/** The tenant's human-scoring switch (§D14.6): explicit row, else the plan default. */
export async function humanScoringEnabled(core: Db, tenantId: number): Promise<boolean> {
  const ops = runOutcomesDatabase(core);
  const [row] = await ops
    .select({ enabled: personScoreSettings.humanScoringEnabled })
    .from(personScoreSettings)
    .where(eq(personScoreSettings.tenantId, tenantId))
    .limit(1);
  if (row) return row.enabled;
  const [tenant] = await core.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  // crossTenantConsent shares the shape (free ⇒ on, every paid tier ⇒ off).
  return crossTenantConsent(undefined, tenant?.plan);
}
