/**
 * coordinationGate — "may this caller coordinate this ticket?"
 *
 * COORDINATION is the ticket-level staffing work: force a Coordinator tick, assess the
 * resources a ticket needs, staff or unstaff a manifest role, materialize the child work
 * items. Five routes on `/api/kanban/tasks/:taskId/*`, and each of them used to open with
 * `if (!isManager(c)) return 403 'manager role required'`.
 *
 * WHY THAT WAS WRONG
 * Coordination is what a developer — or an agent acting for one — does to the ticket it
 * is about to work on. A flat MANAGER demand made the platform's own coordination tools
 * unusable for their commonest case, and the refusal it produced was indistinguishable
 * from a bug: measured on VS Code chat #113, the caller was the workspace OWNER and three
 * coordination tools in a row answered `403 manager role required`, because the gateway
 * key resolved below MANAGER. Operator decision: agent-driven coordination is
 * DEVELOPER-tier by default, and a project that wants staffing concentrated in its
 * manager opts IN (`project_manager_configs.coordination_requires_manager`, migration
 * 1177).
 *
 * WHAT THIS IS NOT
 * It is not a general permission helper. Workspace CONFIGURATION on the same router —
 * the role catalog, role assignments, board templates, apply-template — stays
 * manager-only, because those change how every ticket on every board behaves. This gate
 * covers exactly the five per-ticket routes above.
 *
 * THE REFUSAL CARRIES A REMEDY. A model handed `403 manager role required` has nothing
 * to act on and retries. A model handed "coordination_requires_manager is on for project
 * 12 — a manager can turn it off with manager.configure { … }" either asks for that or
 * stops, and a person reading the same sentence knows which setting to look at.
 *
 * The role comparison goes through the DOMAIN ladder (`hasMinRole` in
 * `domain/shared/types`), not the presentation helper `isManager`: application code may
 * not import presentation, and there is one ladder for the whole codebase.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TenantRole, hasMinRole, type TenantRoleName } from '../../domain/shared/types';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getEffectiveManagerPolicy } from '../manager/managerPolicyStore';

/**
 * WHO admitted this call.
 *
 * Recorded on the activity rows the coordination routes already write, and returned in
 * the coordinate result, so the board's history distinguishes "a manager decided this"
 * from "the project leaves coordination open and a developer did it". Without it,
 * loosening the gate would erase the distinction rather than record it.
 */
export type CoordinationAuthority = 'manager' | 'open';

export type CoordinationGateVerdict =
  | { ok: true; authority: CoordinationAuthority }
  | {
    ok: false;
    status: 403;
    error: 'manager role required';
    /** What would make this call succeed — written for a model to act on. */
    remedy: string;
    /** The ticket's project, so the remedy's `manager.configure` call can be made
     *  without a second lookup. `0` when the task's project could not be read. */
    projectId: number;
  };

/** The floor: below this nothing here admits anyone, whatever the project says. */
const COORDINATION_FLOOR = TenantRole.DEVELOPER;

function refuse(remedy: string, projectId: number): CoordinationGateVerdict {
  // The `error` string is deliberately the SAME sentence the routes have always
  // answered with. Clients (and the VS Code relay's own error surfacing) match on it;
  // the remedy is additive.
  return { ok: false, status: 403, error: 'manager role required', remedy, projectId };
}

/**
 * Decide whether `role` may coordinate the ticket `taskId`.
 *
 * Reads the project policy ONLY when it can change the answer: a manager is admitted
 * without touching the database, and a caller below the working-team floor is refused
 * without it. That matters because every coordination route calls this, and the common
 * case must not add a round-trip to a hot path.
 */
export async function coordinationGate(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; taskId: number; role: TenantRole | TenantRoleName | null | undefined },
): Promise<CoordinationGateVerdict> {
  // Below the working team — a viewer, or a canvas contributor whose write scope is the
  // canvas it was shared, never a ticket's staffing. No project setting opens this: the
  // gate only ever TIGHTENS above the floor.
  if (!hasMinRole(args.role, COORDINATION_FLOOR)) {
    return refuse('coordination needs the working-team tier', 0);
  }

  // A manager is admitted whatever the project's posture, and says so — this is the one
  // verdict that needs no policy read.
  if (hasMinRole(args.role, TenantRole.MANAGER)) return { ok: true, authority: 'manager' };

  const [scope] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, args.taskId)))
    .limit(1);
  // A ticket this workspace does not have. Refusing (rather than admitting and letting
  // the route discover it) is deliberate: some of these routes write through a service
  // that would happily attach a manifest row to an id nothing owns. The remedy says what
  // actually happened, so the caller is not sent looking for a role it already has.
  if (!scope) return refuse(`ticket ${args.taskId} is not on this workspace`, 0);

  const policy = await getEffectiveManagerPolicy(db, args.tenantId, scope.projectId, env);
  if (!policy.coordinationRequiresManager) return { ok: true, authority: 'open' };

  return refuse(
    `coordination_requires_manager is on for project ${scope.projectId} — a manager can turn it off with `
    + `manager.configure { projectId: ${scope.projectId}, coordinationRequiresManager: false }`,
    scope.projectId,
  );
}
