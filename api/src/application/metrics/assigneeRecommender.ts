/**
 * Assignee recommender — the bridge that finally lets the AI sprint planner
 * *consume* member capability/availability profiles (migration 0116) instead of
 * just storing them. Given a project, it ranks the candidate workforce (the teams
 * attached to that project, or all tenant humans as a fallback) by a fit score
 * built from real-time availability, spare WIP capacity, skill match, and ramp
 * factor — so both the manual "Break into subtasks" fan-out and the auto
 * Epic-decomposition hook can pick an owner instead of dumping children into the
 * backlog unassigned.
 *
 * Cached via the shared workforce-metrics version token (WIP changes on every task
 * status write, which already bumps that token; profile edits bump it too), keyed
 * per (tenant, project, skills).
 */
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  memberProfiles, projects, tasks, teams, teamMembers, teamProjects, tenantMembers, users,
} from '../../infrastructure/database/schema';
import { readWorkforceMetricsVersion } from './workforceMetrics';
import { TaskStatus } from '../../domain/shared/types';
import { notSystemTask } from '../task/taskScope';
import { clampScore as clamp } from '../../domain/shared/numbers';

const DEFAULT_MAX_WIP = 5;
/** Open lanes a task counts as WIP for (everything not done-class). */
const DONE_CLASS = new Set<string>([TaskStatus.DONE]);

export type MemberKind = 'human' | 'cloud_agent' | 'host_agent';
const key = (kind: string, ref: string) => `${kind}:${ref}`;

export interface Candidate { memberKind: MemberKind; memberRef: string; memberName: string; }
export interface CandidateProfile {
  availabilityStatus?: string | null;
  maxConcurrentWip?: number | null;
  rampFactor?: number | null;
  experienceLevel?: string | null;
  skills?: unknown;
}
export interface Recommendation extends Candidate {
  fitScore: number;       // 0..100
  wip: number;
  spareCapacity: number;
  available: boolean;
  skillMatchPct: number | null;
  reasons: string[];
}

const AVAIL_WEIGHT: Record<string, number> = { available: 1, on_call: 0.8, focus: 0.6, busy: 0.5, ooo: 0 };
const EXP_WEIGHT: Record<string, number> = { junior: 0.4, mid: 0.6, senior: 0.8, staff: 0.9, principal: 1 };

function skillTags(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return skills
    .map((s) => (typeof s === 'string' ? s : s && typeof s === 'object' && 'tag' in s ? String((s as { tag: unknown }).tag) : ''))
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Pure ranking. `requiredSkills` empty ⇒ skill match is not a factor (skillMatchPct
 * null). Overloaded (spare ≤ 0) or out-of-office candidates fall to the bottom but
 * are still returned (the planner may override). Exported for unit testing.
 */
export function rankCandidates(
  candidates: Candidate[],
  profileByKey: Map<string, CandidateProfile>,
  wipByKey: Map<string, number>,
  requiredSkills: string[],
): Recommendation[] {
  const want = requiredSkills.map((s) => s.toLowerCase()).filter(Boolean);

  const ranked = candidates.map((c): Recommendation => {
    const p = profileByKey.get(key(c.memberKind, c.memberRef));
    const status = (p?.availabilityStatus ?? 'available').toLowerCase();
    const availWeight = AVAIL_WEIGHT[status] ?? 1;
    const available = availWeight > 0;

    const maxWip = p?.maxConcurrentWip ?? DEFAULT_MAX_WIP;
    const wip = wipByKey.get(key(c.memberKind, c.memberRef)) ?? 0;
    const spare = maxWip - wip;
    const capacityScore = spare > 0 ? Math.min(1, spare / Math.max(1, maxWip)) : 0;

    let skillMatchPct: number | null = null;
    if (want.length) {
      const have = new Set(skillTags(p?.skills));
      const hits = want.filter((w) => have.has(w)).length;
      skillMatchPct = Math.round((hits / want.length) * 100);
    }
    const skillScore = skillMatchPct == null ? capacityScore : skillMatchPct / 100;
    const expWeight = p?.experienceLevel ? (EXP_WEIGHT[p.experienceLevel] ?? 0.6) : 0.6;
    const ramp = p?.rampFactor ?? 1;

    const base = 0.5 * capacityScore + 0.4 * skillScore + 0.1 * expWeight;
    const fit = clamp(100 * availWeight * ramp * base);

    const reasons: string[] = [];
    if (!available) reasons.push(`unavailable (${status})`);
    else if (status !== 'available') reasons.push(status);
    reasons.push(spare > 0 ? `${spare} of ${maxWip} WIP free` : `at capacity (${wip}/${maxWip})`);
    if (skillMatchPct != null) reasons.push(`${skillMatchPct}% skill match`);
    if (ramp < 1) reasons.push(`ramping (${Math.round(ramp * 100)}%)`);

    return { ...c, fitScore: fit, wip, spareCapacity: spare, available, skillMatchPct, reasons };
  });

  return ranked.sort((a, b) => b.fitScore - a.fitScore || a.memberName.localeCompare(b.memberName));
}

/**
 * The distinct workforce — humans AND agents — across every team attached to a
 * project, or `[]` when the project has no team assigned. The single source of
 * truth for "who is on this project's teams", shared by the recommender's
 * candidate pool and the assignee-picker scoping endpoint (teamRoutes), so the
 * two never drift.
 */
export async function loadProjectTeamMembers(db: Db, projectId: number, tenantId: number): Promise<Candidate[]> {
  // Tenant-scoped via teams.tenantId — team_members/team_projects carry no tenant_id,
  // so without this join a guessed projectId would leak another tenant's team roster.
  const teamRows = await db
    .selectDistinct({ memberKind: teamMembers.memberKind, memberRef: teamMembers.memberRef, memberName: teamMembers.memberName })
    .from(teamMembers)
    .innerJoin(teamProjects, eq(teamProjects.teamId, teamMembers.teamId))
    .innerJoin(teams, eq(teams.id, teamProjects.teamId))
    .where(and(eq(teamProjects.projectId, projectId), eq(teams.tenantId, tenantId)));
  return teamRows as Candidate[];
}

/** Resolve the candidate pool for a project: members of the teams attached to it,
 *  or — when the project has no teams — every active tenant human. */
async function loadCandidates(db: Db, tenantId: number, projectId: number): Promise<Candidate[]> {
  const teamRows = await loadProjectTeamMembers(db, projectId, tenantId);
  if (teamRows.length) return teamRows;

  // Fallback: the whole active human roster (a project with no team assigned).
  const humans = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username, email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));
  return humans.map((h) => ({ memberKind: 'human' as const, memberRef: h.id, memberName: h.displayName || h.username || h.email }));
}

/** Live WIP per member: open (non-done) tasks currently assigned, tenant-wide. */
async function loadWip(db: Db, tenantId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({
      assignedUserId: tasks.assignedUserId,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedAgentRef: tasks.assignedAgentRef,
      status: tasks.status,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.tenantId, tenantId), eq(tasks.archived, false), notInArray(tasks.status, [...DONE_CLASS]), notSystemTask))
    .limit(10_000); // bound the WIP scan; open tasks per tenant is small in practice
  const wip = new Map<string, number>();
  for (const r of rows) {
    let k: string | null = null;
    if (r.assignedUserId) k = key('human', r.assignedUserId);
    else if (r.assignedAgentHostId != null) k = key('host_agent', String(r.assignedAgentHostId));
    else if (r.assignedAgentRef) k = key('cloud_agent', r.assignedAgentRef);
    if (k) wip.set(k, (wip.get(k) ?? 0) + 1);
  }
  return wip;
}

export interface RecommendInput { projectId: number; requiredSkills?: string[]; }

/** Ranked assignee recommendations for a project. tenantId is derived from the
 *  project so both route and service callers need only the projectId. */
export async function recommendAssignee(env: Env, db: Db, input: RecommendInput): Promise<Recommendation[]> {
  const [proj] = await db.select({ tenantId: projects.tenantId }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!proj) return [];
  const tenantId = proj.tenantId;
  const skills = (input.requiredSkills ?? []).slice().sort();

  const version = await readWorkforceMetricsVersion(env, tenantId);
  const cacheKey = `assignee-recommend:tenant:${tenantId}:project:${input.projectId}:v:${version}:skills:${skills.join(',')}`;

  return getOrSetCached(env, cacheKey, async () => {
    const candidates = await loadCandidates(db, tenantId, input.projectId);
    if (!candidates.length) return [];
    const profileRows = await db
      .select()
      .from(memberProfiles)
      .where(and(
        eq(memberProfiles.tenantId, tenantId),
        inArray(memberProfiles.memberRef, candidates.map((c) => c.memberRef)),
      ));
    const profileByKey = new Map<string, CandidateProfile>();
    for (const p of profileRows) profileByKey.set(key(p.memberKind, p.memberRef), p as CandidateProfile);
    const wip = await loadWip(db, tenantId);
    return rankCandidates(candidates, profileByKey, wip, skills);
  });
}

/** The single top pick (or null) — used by the Epic fan-out to auto-assign an
 *  otherwise-unassigned child. Only returns an *available* candidate. */
export async function recommendTopAssignee(env: Env, db: Db, projectId: number, requiredSkills: string[] = []): Promise<{ memberKind: MemberKind; memberRef: string } | null> {
  const ranked = await recommendAssignee(env, db, { projectId, requiredSkills });
  const top = ranked.find((r) => r.available && r.spareCapacity > 0) ?? ranked.find((r) => r.available);
  return top ? { memberKind: top.memberKind, memberRef: top.memberRef } : null;
}
