/**
 * teamPeopleScores.ts — the team People view read (PRD 41 §D14, WS22).
 *
 * Resolves the team and the viewer (their contributor row + tenant role), then, for
 * every contributor on the team the viewer may see, scores their runs per role over
 * the rolling 90-day window. The three access rules of §D14.6 live here so the route
 * keeps HTTP concerns only:
 *
 *   • enterprise default-off — a human's score is skipped when the tenant's
 *     human-scoring switch is off (agent scoring cannot be disabled);
 *   • per-subject — each contributor is gated by {@link mayViewPersonScore};
 *   • audit — every view of ANOTHER person's score writes one `admin_audit_log` row
 *     ({@link PERSON_SCORE_VIEWED_EVENT}); self-views are not audited.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { contributors, devTeams, tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { mayViewPersonScore, type PersonScoreViewer } from './mayViewPersonScore';
import { scoreBucket, estimateTeamPrior, type PersonScore } from './personScore';
import {
  bucketsOf,
  contributorRunInputs,
  humanScoringEnabled,
  PERSON_SCORE_WINDOW_DAYS,
  teamContributors,
} from './personScoreRead';

/** The audit event for viewing another person's score (§D14.6). */
export const PERSON_SCORE_VIEWED_EVENT = 'person_score.viewed';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TeamPersonScores {
  contributorId: number;
  displayName: string;
  kind: string;
  scores: PersonScore[];
}

export interface TeamPeopleScores {
  teamId: number;
  windowDays: number;
  humanScoringEnabled: boolean;
  people: TeamPersonScores[];
}

/** The team's People view for one viewer, or `null` when the team is not in the tenant. */
export async function loadTeamPeopleScores(
  db: Db,
  tenantId: number,
  viewerUserId: string,
  teamId: number,
): Promise<TeamPeopleScores | null> {
  const [team] = await db
    .select({ id: devTeams.id, managerId: devTeams.managerId })
    .from(devTeams)
    .where(and(scopedToTenant(devTeams, tenantId), eq(devTeams.id, teamId)))
    .limit(1);
  if (!team) return null;

  // The viewer's contributor row (their identity in run roles is the user id; the
  // reporting line is by contributor id).
  const [viewerRow] = await db
    .select({ contributorId: contributors.id })
    .from(contributors)
    .where(and(scopedToTenant(contributors, tenantId), eq(contributors.userId, viewerUserId)))
    .limit(1);
  const [membership] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, viewerUserId), eq(tenantMembers.isActive, true)))
    .limit(1);

  const viewer: PersonScoreViewer = {
    contributorId: viewerRow?.contributorId ?? null,
    role: membership?.role ?? 'member',
    teamId,
  };

  const members = await teamContributors(db, tenantId, teamId);
  const humanScoring = await humanScoringEnabled(db, tenantId);
  const since = new Date(Date.now() - PERSON_SCORE_WINDOW_DAYS * DAY_MS);

  const people: TeamPersonScores[] = [];

  for (const member of members) {
    // Enterprise default-off: a human's score is hidden when the tenant setting is off.
    if (member.kind !== 'agent' && !humanScoring) continue;

    // Per-subject visibility: the viewer sees their own, their reports, or (admin) all.
    const decision = mayViewPersonScore(viewer, {
      contributorId: member.contributorId,
      team: { id: team.id, managerId: team.managerId },
    });
    if (!decision.allowed) continue;

    const runs = await contributorRunInputs(db, tenantId, member, since);
    const buckets = bucketsOf(member.contributorId, member.userId, runs);
    // The Gamma–Poisson prior comes from the team's same-role buckets (D14.4).
    const prior = estimateTeamPrior(buckets) ?? { alpha0: 1, beta0: 10 };
    const scores = buckets.map((bucket) => scoreBucket(bucket, prior, null));

    // Audit every view of ANOTHER person's score (self-views are not audited, §D14.6).
    if (member.contributorId !== viewer.contributorId) {
      await writeAdminAudit(db, PERSON_SCORE_VIEWED_EVENT, viewerUserId, {
        tenantId,
        targetUserId: member.userId,
        metadata: {
          subjectContributorId: member.contributorId,
          teamId,
          kind: member.kind,
          access: decision.reason,
        },
      });
    }

    people.push({
      contributorId: member.contributorId,
      displayName: member.displayName,
      kind: member.kind,
      scores,
    });
  }

  return { teamId, windowDays: PERSON_SCORE_WINDOW_DAYS, humanScoringEnabled: humanScoring, people };
}
