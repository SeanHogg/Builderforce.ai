import { resolveManagerAssignee, type ManagerAssignee } from '../manager/managerPolicy';

const NONE: ManagerAssignee = {
  assignedUserId: null,
  assignedAgentRef: null,
  assignedAgentHostId: null,
};

export function countAssigneeFields(a: ManagerAssignee): number {
  return [a.assignedUserId, a.assignedAgentRef, a.assignedAgentHostId].filter((v) => v != null).length;
}

/**
 * Default coordinator for `tasks.create` when the caller omitted every assignee field.
 *
 * 1. Project Delivery Manager (`managerRef` via {@link resolveManagerAssignee}).
 * 2. Else the requesting human, but only if that id is a real `users` row.
 * 3. Else all-null — never a dangling `assigned_user_id` (FK `tasks_assigned_user_id_fkey`).
 *
 * A designated manager whose `u:` id is not a `users` row is treated as "no
 * manager" (fall through to the requesting human). Explicit assignees are not
 * resolved here (caller uses them as-is).
 */
export async function resolveDefaultCreateTaskAssignee(args: {
  managerRef: string | null | undefined;
  requestingUserId: string | null | undefined;
  userExists: (id: string) => Promise<boolean>;
}): Promise<ManagerAssignee> {
  const fromPolicy = resolveManagerAssignee(args.managerRef);
  if (countAssigneeFields(fromPolicy) > 0) {
    // Agent / host managers have no users.id — pass through.
    if (!fromPolicy.assignedUserId) return fromPolicy;
    if (await args.userExists(fromPolicy.assignedUserId)) return fromPolicy;
    // Dangling `u:` manager is the same as "no manager": fall through.
  }
  const fallbackId = args.requestingUserId?.trim() || null;
  if (!fallbackId) return { ...NONE };
  if (await args.userExists(fallbackId)) {
    return { ...NONE, assignedUserId: fallbackId };
  }
  return { ...NONE };
}
