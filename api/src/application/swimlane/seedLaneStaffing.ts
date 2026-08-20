/**
 * SEED LANE STAFFING FROM THE WORKFORCE THE PROJECT ALREADY HAS.
 *
 * Measured 2026-07-25 across 821 tickets: only **3 of 61** auto-gated lanes (and 1 of 11
 * human-gated) carried any `swimlane_agent_assignments` row at all. The consequence was
 * not subtle — 466 of 821 tickets (57%) had zero runs AND zero autonomous hops, inert
 * from the moment they were created, because with no lane agent the only thing autonomy
 * can fall back to is the ticket's owner, and on most tickets there is no owner either.
 *
 * The cause is that nothing ever staffed a lane. A board is created with lanes; a
 * template is applied and writes lanes plus their ROLE REQUIREMENTS; and then a human is
 * expected to open Board configuration and bind an agent to each one by hand. Every board
 * in production shipped unstaffed, and looked configured.
 *
 * This closes it at the two moments the answer changes — board creation and template
 * application — using ONLY agents the tenant already has:
 *
 *  • It NEVER HIRES. Hiring is the manager's job (`staffUnfilledLanes`), it costs money,
 *    and it is budgeted per pass for that reason. Seeding must be free and silent.
 *  • It only staffs a lane that DECLARES a required producer role. A lane with no
 *    declared role has no correct agent to seed, and guessing one ("in_progress means a
 *    developer") would bind an agent to a stage the operator never described. The default
 *    template-less board therefore seeds nothing, which is the honest outcome — for that
 *    board the UI's unstaffed badge is the fix, not a guess.
 *  • It is IDEMPOTENT and additive: a lane that already has any assignment is left alone,
 *    so re-applying a template never duplicates or overwrites a deliberate choice.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { swimlaneRequirements, swimlanes } from '../../infrastructure/database/schema';
import { forLanes, laneAgentAssignments, laneAssignmentValues } from './laneAgentAssignments';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveRoleCapableAgents } from '../kanban/roleCapability';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export interface LaneStaffingSeedResult {
  /** Lanes that declared a producer role and had none staffed. */
  candidates: number;
  /** Lanes an existing agent was bound to. */
  staffed: number;
  /** Lanes whose declared role no agent in the tenant can fill — the manager's problem. */
  unfillable: string[];
}

const EMPTY: LaneStaffingSeedResult = { candidates: 0, staffed: 0, unfillable: [] };

/** A lane's required PRODUCER role (owner/contributor, or a bare role treated as owner). */
function producerRefOf(
  rows: ReadonlyArray<{ ref: string; responsibility: string | null; isRequired: boolean; kind: string }>,
): string | null {
  const producer = rows.find((r) => r.isRequired && r.kind === 'role'
    && (r.responsibility == null || r.responsibility === 'owner' || r.responsibility === 'contributor'));
  return producer?.ref ?? null;
}

/**
 * Bind an already-available role-capable agent to every lane that declares a required
 * producer role and has nobody staffed. Never throws — an unstaffed lane is the status
 * quo, so a failure here must not fail board creation.
 */
export async function seedLaneStaffingFromWorkforce(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; boardId: string },
): Promise<LaneStaffingSeedResult> {
  try {
    const lanes = await db
      .select({ id: swimlanes.id, key: swimlanes.key, isTerminal: swimlanes.isTerminal, segmentId: swimlanes.segmentId })
      .from(swimlanes)
      .where(scopedToTenant(swimlanes, args.tenantId, eq(swimlanes.boardId, args.boardId)))
      .orderBy(asc(swimlanes.position));
    // A terminal lane finalizes the ticket; there is no producer stage to staff.
    const workingLanes = lanes.filter((l) => !l.isTerminal);
    if (workingLanes.length === 0) return EMPTY;

    const laneIds = workingLanes.map((l) => l.id);
    const [reqRows, existing] = await Promise.all([
      db
        .select({
          swimlaneId: swimlaneRequirements.swimlaneId,
          ref: swimlaneRequirements.ref,
          responsibility: swimlaneRequirements.responsibility,
          isRequired: swimlaneRequirements.isRequired,
          kind: swimlaneRequirements.kind,
        })
        .from(swimlaneRequirements)
        // The lane ids came from a tenant-scoped read above, but the predicate is what
        // the guard (and a reviewer) can see — so it is written here rather than inferred
        // from where the ids happened to come from.
        .where(scopedToTenant(swimlaneRequirements, args.tenantId, inArray(swimlaneRequirements.swimlaneId, laneIds)))
        .orderBy(asc(swimlaneRequirements.position)),
      db
        .select({ swimlaneId: laneAgentAssignments.scopeId })
        .from(laneAgentAssignments)
        .where(forLanes(laneIds)),
    ]);

    const alreadyStaffed = new Set(existing.map((r) => r.swimlaneId));
    const reqsByLane = new Map<string, typeof reqRows>();
    for (const r of reqRows) {
      const bucket = reqsByLane.get(r.swimlaneId);
      if (bucket) bucket.push(r); else reqsByLane.set(r.swimlaneId, [r]);
    }

    const result: LaneStaffingSeedResult = { candidates: 0, staffed: 0, unfillable: [] };
    // One resolver call per DISTINCT role, not per lane — a template names the same
    // producer on several lanes and the roster read is cached per (tenant, role).
    const agentForRole = new Map<string, { ref: string; name: string } | null>();
    const now = new Date();

    for (const lane of workingLanes) {
      if (alreadyStaffed.has(lane.id)) continue;
      const roleKey = producerRefOf(reqsByLane.get(lane.id) ?? []);
      if (!roleKey) continue;
      result.candidates += 1;

      if (!agentForRole.has(roleKey)) {
        const [capable] = await resolveRoleCapableAgents(env, db, args.tenantId, args.projectId, roleKey);
        agentForRole.set(roleKey, capable ? { ref: capable.ref, name: capable.name } : null);
      }
      const agent = agentForRole.get(roleKey) ?? null;
      if (!agent) {
        if (!result.unfillable.includes(roleKey)) result.unfillable.push(roleKey);
        continue;
      }

      await db.insert(laneAgentAssignments).values(laneAssignmentValues({
        tenantId: args.tenantId,
        segmentId: lane.segmentId ?? null,
        swimlaneId: lane.id,
        agentKind: 'workforce',
        agentRef: agent.ref,
        name: agent.name,
        role: roleKey,
        now,
      }));
      result.staffed += 1;
    }

    return result;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/swimlane/seedLaneStaffing.ts',
      operation: 'seedLaneStaffingFromWorkforce',
      context: { details: { tenantId: args.tenantId, projectId: args.projectId, boardId: args.boardId } },
    });
    return EMPTY;
  }
}
