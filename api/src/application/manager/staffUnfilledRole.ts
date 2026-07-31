import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * staffUnfilledRole — what the manager does when a stage requires a role that NOBODY on
 * the roster can perform.
 *
 * ── THE COHORT THIS EXISTS FOR ───────────────────────────────────────────────────
 * Project 11: 447 of 678 stalled tickets — 66% of the entire backlog — share one cause,
 * `managed_no_role`. The stage authorises a role, no agent resolves to it, so no run can
 * be role-attributed and the dispatcher refuses every attempt. The manager's answer was
 * `coordinate`, which re-runs the same gate against the same empty roster and moves
 * nothing, every five minutes, for weeks.
 *
 * A cohort that size is a CONFIGURATION DEFECT, not 447 independent ticket problems, and
 * no per-ticket remedy can clear it: the cohort outruns the per-pass budget every pass.
 * The only thing that clears it is filling the role. So this module fills the role.
 *
 * ── THE LADDER ───────────────────────────────────────────────────────────────────
 * Three rungs, cheapest and most conservative first — the manager never invents a
 * teammate it could have found:
 *
 *   1. STAFF   — somebody on the roster is already capable (by explicit `role_keys`, by
 *                `builtin_kind`, or by title/skill). The role was unfilled only because
 *                nothing had PINNED them to it, so pin them. No new agent, no new cost.
 *   2. HIRE    — nobody is capable. The manager provisions a new cloud agent purpose-built
 *                for the role and pins it. This is the rung a human would take, and the
 *                board had already asked for it in its own words: tickets #525 and #530
 *                on this very project are "Provision 2 additional cloud agents…", filed
 *                and then stalled by the very gap they describe.
 *   3. ESCALATE — hiring is capped or refused, and only then does a human get the ticket.
 *
 * ── WHY HIRING IS SAFE TO AUTOMATE HERE ──────────────────────────────────────────
 * An `ide_agents` row is a ROSTER ENTRY, not a running process: creating one costs
 * nothing and consumes nothing. Every downstream expense — the actual cloud run — is
 * still governed by the caps that already exist (the per-pass dispatch budget, the
 * failure breaker, the tenant's cloud-run allowance, the token meter). So the blast
 * radius of a wrong hire is one unused row, while the blast radius of NOT hiring is the
 * measured 447-ticket standstill.
 *
 * It is still bounded, because an unbounded self-provisioning loop is its own failure
 * mode: {@link MAX_HIRES_PER_PASS} per pass, only for roles in the builtin catalog (never
 * a typo'd or free-text role), and idempotent per role — a second call for a role the
 * manager already hired for re-pins the existing agent instead of creating another.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ideAgents, projectRoleAssignments } from '../../infrastructure/database/schema';
import { bumpWorkforceMetricsVersion } from '../metrics/workforceMetrics';
import { resolveRoleCapableAgents } from '../kanban/roleCapability';
import { SIGNOFF_TOOL_NAME } from '../kanban/signoffRequest';
import { BUILTIN_ROLES, isBuiltinRoleKey, roleDisplayName } from '../kanban/roleCatalog';

/**
 * How many agents the manager may hire in ONE pass, across all roles.
 *
 * Two, deliberately. A stage typically lacks one role; a board that lacks more than two
 * at once is a misconfigured template rather than a staffing gap, and the honest response
 * to that is a human looking at it — not the manager conjuring a workforce to satisfy it.
 */
export const MAX_HIRES_PER_PASS = 2;

/** The marker that identifies an agent the MANAGER hired, and for which role. */
export const MANAGER_HIRED_PREFIX = 'manager-hired';

/** What the manager did about the unfilled role. */
export type StaffingAction =
  /** An existing capable agent was pinned to the role. */
  | 'staffed'
  /** A new agent was provisioned for the role and pinned. */
  | 'hired'
  /** Nothing could be done automatically — a human must staff it. */
  | 'escalate';

export interface StaffingResult {
  action: StaffingAction;
  roleKey: string;
  agentRef: string | null;
  agentName: string | null;
  /** One plain sentence for the manager feed and the stuck register. */
  detail: string;
}

/**
 * Decide the rung WITHOUT performing it. PURE.
 *
 * Split out so the ladder's ordering — and especially the two refusal conditions, an
 * unknown role key and an exhausted hire budget — are provable without a database. This
 * is the function that decides whether the platform creates a teammate, so it should be
 * readable in one screen and testable with no IO.
 */
export function decideStaffingAction(input: {
  /** Agents already capable of the role, from `resolveRoleCapableAgents`. */
  capableCount: number;
  /** The role is a known builtin — never provision for a free-text or typo'd role. */
  knownRole: boolean;
  /** Hires already made this pass. */
  hiresUsed: number;
  maxHires?: number;
}): StaffingAction {
  if (input.capableCount > 0) return 'staffed';
  if (!input.knownRole) return 'escalate';
  return input.hiresUsed < (input.maxHires ?? MAX_HIRES_PER_PASS) ? 'hired' : 'escalate';
}

/** The roster entry the manager creates for a role nobody can fill. */
function hireSpecFor(roleKey: string, tenantId: number): {
  id: string; name: string; title: string; bio: string; skills: string[];
} {
  const role = BUILTIN_ROLES.find((r) => r.key === roleKey);
  const name = roleDisplayName(roleKey);
  return {
    id: `${MANAGER_HIRED_PREFIX}-${roleKey}-t${tenantId}`,
    name,
    title: `${name} — hired by the AI Manager to fill an unstaffed lifecycle role`,
    // The bio IS the persona (it is compiled into the agent's directives by
    // `resolveWorkforceModel`), so it states the role's remit rather than describing it
    // from outside. The catalog description is the canonical statement of that remit.
    bio: `${role?.description ?? `Performs the ${name} role on this workspace's tickets.`} `
      + 'This role was required by a lifecycle stage that no existing teammate could perform, '
      // The ADVERTISED name, never the catalog id — this bio becomes the agent's persona
      // directive, so a hand-typed id names a tool it does not have. See `toolNaming.ts`.
      + 'so the AI Manager staffed it. Work the ticket as this role, and record your verdict '
      + `with the \`${SIGNOFF_TOOL_NAME}\` tool when the stage's deliverable is complete.`,
    skills: [roleKey, ...(role?.discipline ? [role.discipline] : [])],
  };
}

/** Pin an agent to a role for a project, so resolution is deterministic from now on. */
async function pinRole(
  db: Db,
  args: { tenantId: number; projectId: number; roleKey: string; agentRef: string; agentName: string },
): Promise<void> {
  const [existing] = await db
    .select({ id: projectRoleAssignments.id })
    .from(projectRoleAssignments)
    .where(and(
      eq(projectRoleAssignments.tenantId, args.tenantId),
      eq(projectRoleAssignments.projectId, args.projectId),
      eq(projectRoleAssignments.roleKey, args.roleKey),
      eq(projectRoleAssignments.assigneeKind, 'agent'),
      eq(projectRoleAssignments.assigneeRef, args.agentRef),
    ))
    .limit(1);
  if (existing) return;
  await db.insert(projectRoleAssignments).values({
    // `id` is a bare varchar primary key with no database default.
    id: crypto.randomUUID(),
    tenantId: args.tenantId,
    projectId: args.projectId,
    roleKey: args.roleKey,
    assigneeKind: 'agent',
    assigneeRef: args.agentRef,
    assigneeName: args.agentName,
  }).onConflictDoNothing();
}

/**
 * Fill `roleKey` for a project: staff it from the roster, hire for it, or hand it over.
 *
 * Never throws — a staffing failure must leave the manager pass running and the ticket
 * honestly recorded as still stuck, not abort the sweep for every other project.
 */
export async function staffUnfilledRole(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    projectId: number;
    roleKey: string;
    /** Hires already made this pass, so the budget spans the whole sweep. */
    hiresUsed?: number;
    maxHires?: number;
  },
): Promise<StaffingResult> {
  const roleKey = args.roleKey.trim();
  const name = roleDisplayName(roleKey);
  const escalate = (detail: string): StaffingResult =>
    ({ action: 'escalate', roleKey, agentRef: null, agentName: null, detail });

  if (!roleKey) return escalate('No role was named, so there is nothing to staff.');

  try {
    const capable = await resolveRoleCapableAgents(env, db, args.tenantId, args.projectId, roleKey);
    const decision = decideStaffingAction({
      capableCount: capable.length,
      knownRole: isBuiltinRoleKey(roleKey),
      hiresUsed: args.hiresUsed ?? 0,
      ...(args.maxHires != null ? { maxHires: args.maxHires } : {}),
    });

    if (decision === 'staffed') {
      // `resolveRoleCapableAgents` already returns precedence-ordered candidates — an
      // explicit pin first, then declared role_keys, then builtin_kind, then fuzzy — so
      // the head is the strongest claim to the role.
      const pick = capable[0]!;
      await pinRole(db, {
        tenantId: args.tenantId, projectId: args.projectId, roleKey,
        agentRef: pick.ref, agentName: pick.name,
      });
      await bumpWorkforceMetricsVersion(env, args.tenantId).catch(() => undefined);
      return {
        action: 'staffed', roleKey, agentRef: pick.ref, agentName: pick.name,
        detail: `Staffed ${name} with ${pick.name}, who was already capable of the role but pinned to nothing — the stage can now dispatch.`,
      };
    }

    if (decision === 'escalate') {
      return escalate(
        isBuiltinRoleKey(roleKey)
          ? `No teammate can perform ${name} and this pass has used its hiring budget — a human needs to staff or hire for this role.`
          : `No teammate can perform '${roleKey}', and it is not a role this workspace recognises, so the manager will not invent one — a human needs to correct the stage's required role or staff it.`,
      );
    }

    // ── HIRE ────────────────────────────────────────────────────────────────────
    const spec = hireSpecFor(roleKey, args.tenantId);
    await db.insert(ideAgents).values({
      id: spec.id,
      tenantId: args.tenantId,
      name: spec.name,
      title: spec.title,
      bio: spec.bio,
      skills: JSON.stringify(spec.skills),
      // The explicit capability grant. Without it the new agent would be judged by the
      // same fuzzy title match that failed to fill the role in the first place.
      roleKeys: [roleKey],
      baseModel: 'builderforce-default',
      status: 'active',
      runtimeSupport: 'cloud',
      published: false,
      priceCents: 0,
    }).onConflictDoNothing();

    await pinRole(db, {
      tenantId: args.tenantId, projectId: args.projectId, roleKey,
      agentRef: spec.id, agentName: spec.name,
    });
    await bumpWorkforceMetricsVersion(env, args.tenantId).catch(() => undefined);
    return {
      action: 'hired', roleKey, agentRef: spec.id, agentName: spec.name,
      detail: `No teammate could perform ${name}, so the manager hired one and assigned it to this project — the stage can now dispatch.`,
    };
  } catch (error) {
    reportCaughtError(error, { source: 'application/manager/staffUnfilledRole.ts', operation: 'staffUnfilledRole' });
    return escalate(`Could not staff ${name} automatically — a human needs to assign an agent to this role.`);
  }
}
