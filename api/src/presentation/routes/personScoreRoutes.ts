/**
 * Person-score routes — /api/teams/:id/people (PRD 41 §D14, WS22).
 *
 * The People view on the team page: per-contributor, per-role quality scores derived
 * deterministically from run-delta outcomes and WS16 labels. The SERVER enforces
 * {@link mayViewPersonScore} (the ONE visibility policy); the frontend `RoleGate` only
 * disables the UI. Three access rules apply (§D14.6):
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
 * The DB work and the three rules live in `application/people/teamPeopleScores.ts`;
 * this route keeps HTTP concerns only.
 *
 * Scores are computed on read from the WS16 tables over the rolling 90-day window; no
 * score is persisted (D14 scores are reproducible from the same inputs).
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { loadTeamPeopleScores } from '../../application/people/teamPeopleScores';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

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

    const result = await loadTeamPeopleScores(db, tenantId, viewerUserId, teamId);
    if (!result) return c.json({ error: 'Team not found' }, 404);
    return c.json(result);
  });

  return router;
}
