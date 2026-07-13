/**
 * Derive a respondent's DevEx segment tags from their org profile at submit time,
 * so the segment heatmap / participation-by-segment populate WITHOUT asking the
 * developer to self-report demographics. Only the resolved labels are stored on
 * the response (never the user id) — anonymous campaigns stay anonymous, and the
 * insights rollup's anonymity threshold hides any group with < 3 responses.
 *
 *   role     ← tenant membership role (developer / manager / …)
 *   team     ← primary team membership
 *   location ← member-profile timezone (closest location signal we capture)
 *   group    ← builder discipline (engineering / product / design / qa / …)
 *
 * Explicit segments supplied on the request take precedence over derived ones.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantMembers, teams, teamMembers, memberProfiles } from '../../infrastructure/database/schema';
import { normalizeSegments, type DevexSegments } from './devexSurveys';

/** "engineering" → "Engineering", "ai_tools" → "Ai tools" — for enum-y labels. */
function titleCase(s: string): string {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/** Look up the submitter's org attributes and map them onto the segment axes. */
export async function deriveSegments(db: Db, tenantId: number, userId: string | null): Promise<DevexSegments> {
  if (!userId) return {};

  const [membership, team, profile] = await Promise.all([
    db.select({ role: tenantMembers.role }).from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1),
    db.select({ name: teams.name }).from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.tenantId, tenantId), eq(teamMembers.memberKind, 'human'), eq(teamMembers.memberRef, userId)))
      .limit(1),
    db.select({ timezone: memberProfiles.timezone, discipline: memberProfiles.discipline }).from(memberProfiles)
      .where(and(eq(memberProfiles.tenantId, tenantId), eq(memberProfiles.memberKind, 'human'), eq(memberProfiles.memberRef, userId)))
      .limit(1),
  ]);

  const derived: DevexSegments = {};
  const role = membership[0]?.role;
  if (role) derived.role = titleCase(role);
  const teamName = team[0]?.name;
  if (teamName) derived.team = teamName;
  const timezone = profile[0]?.timezone;
  if (timezone) derived.location = timezone;
  const discipline = profile[0]?.discipline;
  if (discipline) derived.group = titleCase(discipline);

  return normalizeSegments(derived);
}
