/**
 * mayViewPersonScore.ts — THE ONE person-score visibility policy (PRD 41 §D14.6, WS22).
 *
 * The server enforces this in the person-score route. The frontend `RoleGate` only
 * disables the UI. PURE: takes rows (dev_team + optional viewer team) and returns a
 * decision, so it is unit-testable without a database.
 *
 * Who sees what (§D14.6):
 *  - a person sees their own scores;
 *  - a manager sees their team's contributors (`dev_teams.manager_id` → the viewer's
 *    contributor row, resolved by the caller to the viewer's team);
 *  - a tenant admin sees everyone in the tenant (the caller asserts `viewerRole`);
 *  - superadmin sees nothing cross-tenant without the existing audited cross-tenant
 *    scope — we do NOT grant superadmin a bypass here; they use the audited scope.
 *
 * The viewer's own team membership is supplied as `viewerTeamId` — the single source
 * of truth is `dev_teams.manager_id` and the caller (the route) resolves the viewer's
 * team row and passes its id, so this function never touches the database.
 */
export interface PersonScoreViewer {
  /** The viewer's contributor id, or null when unknown (anon). */
  contributorId: number | null;
  /** The viewer's platform role: 'member' | 'admin' | 'superadmin'. */
  role: string;
  /** The id of the dev_team whose `manager_id` is the viewer's contributor row, else null. */
  teamId: number | null;
}

export type PersonScoreAccess =
  | { allowed: true; reason: 'self' | 'team-manager' | 'tenant-admin' }
  | { allowed: false; reason: 'anon' | 'not-a-report' };

/**
 * May `viewer` view `subjectContributorId`'s person score, given the subject's team?
 *
 * A manager sees a score only when the SUBJECT belongs to a team the viewer manages
 * (`subjectTeam.managerId === viewer.contributorId`). Today the only reporting line is
 * `dev_teams.manager_id` → contributors; there is no cross-team or skip-level read.
 */
export function mayViewPersonScore(
  viewer: PersonScoreViewer,
  subject: { contributorId: number; team: { id: number; managerId: number | null } | null },
): PersonScoreAccess {
  if (viewer.contributorId == null) return { allowed: false, reason: 'anon' };
  if (viewer.contributorId === subject.contributorId) return { allowed: true, reason: 'self' };
  // Tenant admin sees everyone in the tenant (the caller has already scoped to a tenant).
  if (viewer.role === 'admin') return { allowed: true, reason: 'tenant-admin' };
  // A manager sees their team's contributors — the subject must belong to a team the
  // viewer manages. We never grant on the viewer's own team id alone: the subject's
  // team row must name the viewer as its manager.
  if (viewer.role === 'member' && subject.team && subject.team.managerId === viewer.contributorId) {
    return { allowed: true, reason: 'team-manager' };
  }
  return { allowed: false, reason: 'not-a-report' };
}
