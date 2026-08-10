/**
 * assignTicketOwner — give one unowned ticket its best-fit owner.
 *
 * Extracted from the manager's ASSIGN stage because the stall-triage stage needs the
 * identical behaviour: `unassigned` is the diagnosed cause for a ticket nothing can
 * run, and its remedy is exactly this. Two copies of "pick an assignee, write the
 * right one of three mutually-exclusive columns, describe who got it" is two places
 * for the role constraint to drift — and that constraint is load-bearing: it is what
 * stops a coding ticket landing on a role-incapable owner (the #467 root cause).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks } from '../../infrastructure/database/schema';
import { recommendTopAssignee } from '../metrics/assigneeRecommender';
import { producerRoleForActionType } from '../kanban/roleCapability';

export interface AssignOwnerResult {
  assigned: boolean;
  /** Human-readable assignee for the journal entry ("agent x", "teammate y"). */
  label: string;
  memberKind: string | null;
  memberRef: string | null;
}

const NOT_ASSIGNED: AssignOwnerResult = { assigned: false, label: '', memberKind: null, memberRef: null };

/**
 * Pick and persist an owner. Role-aware: the candidate set is constrained to the
 * ticket's PRODUCER role (derived from its technical action-type) so implementation
 * work cannot land on someone who could never do it. No constraint is applied when
 * the action-type implies no particular role.
 *
 * Writes all three assignment columns so a re-assignment cannot leave a stale owner
 * of a different kind behind. Never throws.
 */
export async function assignTicketOwner(
  env: Env,
  db: Db,
  args: {
    projectId: number; taskId: number; actionType: string | null;
    agentOnly?: boolean;
    roleKeyOverride?: string;
  },
): Promise<AssignOwnerResult> {
  try {
    const roleKey = args.roleKeyOverride ?? producerRoleForActionType(args.actionType);
    const pick = await recommendTopAssignee(env, db, args.projectId, {
      ...(roleKey ? { roleKey } : {}),
      agentOnly: args.agentOnly,
    });
    if (!pick) return NOT_ASSIGNED;

    const set: Record<string, unknown> = {
      assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null, updatedAt: new Date(),
    };
    let label = '';
    if (pick.memberKind === 'human') {
      set.assignedUserId = pick.memberRef;
      label = `teammate ${pick.memberRef}`;
    } else if (pick.memberKind === 'cloud_agent') {
      set.assignedAgentRef = pick.memberRef;
      label = `agent ${pick.memberRef}`;
    } else {
      const hostId = Number(pick.memberRef);
      if (Number.isFinite(hostId)) {
        set.assignedAgentHostId = hostId;
        label = `host agent ${hostId}`;
      }
    }
    if (!label) return NOT_ASSIGNED;

    await db.update(tasks).set(set).where(eq(tasks.id, args.taskId));
    return { assigned: true, label, memberKind: pick.memberKind, memberRef: pick.memberRef };
  } catch {
    return NOT_ASSIGNED;
  }
}
