/**
 * Person-score routes — /api/teams/:id/people (PRD 41 §D14, WS22).
 *
 * The People view on the team page: per-contributor, per-role quality scores derived
 * deterministically from run-delta outcomes and WS16 labels. The SERVER enforces
 * {@link mayViewPersonScore} (the ONE visibility policy); the frontend `RoleGate` only
 * disables the UI. Three access rules live here (§D14.6):
 *
 *   • enterprise default-off — a tenant with human scoring off gets 404 on this route
 *     (the tenant's plan default: `free` ⇒ on, every paid tier ⇒ off; a tenant admin
 *     flips it via the settings surface). AGENT scoring cannot be disabled, so an
 *     agent-only read still works; this route reads the team's contributors and returns
 *     scores for the agents regardless, and 404s only when the team has no agents and
 *     human scoring is off.
 *   • per-subject — each contributor's score is gated by mayViewPersonScore(viewer,
 *     subject): self, the team manager (the subject's dev_team.manager_id is the
 *     viewer's contributor row), or a tenant admin. A manager never sees a non-report.
 *   • audit — every view of ANOTHER person's score writes one `admin_audit_log` row
 *     (`person_score.viewed`), so a manager's reads leave a forensic trail.
 *
 * Scores are computed on read from the WS16 tables over the rolling 90-day window; no
 * score is persisted (D14 scores are reproducible from the same inputs).
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { contributors, devTeams, tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { mayViewPersonScore, type PersonScoreViewer } from '../../application/people/mayViewPersonScore';
import { scoreBucket, estimateTeamPrior, type PersonScore } from '../../application/people/personScore';
import {
  bucketsOf,
  contributorRunInputs,
  humanScoringEnabled,
  PERSON_SCORE_WINDOW_DAYS,
  teamContributors,
} from '../../application/people/personScoreRead';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** The audit event for viewing another person's score (§D14.6). */
export const PERSON_SCORE_VIEWED_EVENT = 'person_score.viewed';

const DAY_MS = 24 * 60 * 60 * 1000;

export function createPersonScoreRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/teams/:id/people — the team's People view: one entry per contributor the
  // viewer may see, each with its per-role scores (or insufficient-data below the
  // 20-final-labelled-runs minimum). Returns 404 when the team is unknown OR when human
  // scoring is off for the tenant AND the caller is not entitled to any agent score.
  router.get('/:id/people', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const viewerUserId = c.get('userId') as string;
    const teamId = Number(c.req.param('id'));

    const [team] = await db
      .select({ id: devTeams.id, managerId: devTeams.managerId })
      .from(devTeams)
      .where(and(scopedToTenant(devTeams, tenantId), eq(devTeams.id, teamId)))
      .limit(1);
    if (!team) return c.json({ error: 'Team not found' }, 404);

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

    const people: Array<{
      contributorId: number;
      displayName: string;
      kind: string;
      scores: PersonScore[];
    }> = [];

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

    return c.json({ teamId, windowDays: PERSON_SCORE_WINDOW_DAYS, humanScoringEnabled: humanScoring, people });
  });

  return router;
}
