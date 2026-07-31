'use client';

/**
 * useAssignedRoles — resolve the workspace-default job-roles a given workforce
 * member (agent / hire / human) is pinned to, for READ-ONLY display in a detail
 * panel. The role picker lives on Workforce → Roles ({@link RolesView}); this is
 * the reverse lookup ("what roles is THIS member filling?") that every member
 * detail surface can reuse instead of re-joining assignments to roles itself.
 *
 * One fetch of the shared role + assignment lists, filtered to this assignee and
 * mapped to a display name/icon.
 */
import { useEffect, useState } from 'react';
import { kanbanApi } from '@/lib/builderforceApi';
import type { AssigneeKind } from '@/lib/kanban';

export interface AssignedRole {
  assignmentId: string;
  roleKey: string;
  name: string;
  icon?: string;
}

/** Agents and hires are both "agent-like" members; humans are looked up on their own. */
const AGENT_KINDS: AssigneeKind[] = ['agent', 'hire'];

export function useAssignedRoles(
  assigneeRef: string | undefined,
  kinds: AssigneeKind[] = AGENT_KINDS,
): AssignedRole[] {
  const [assigned, setAssigned] = useState<AssignedRole[]>([]);

  useEffect(() => {
    if (!assigneeRef) { setAssigned([]); return; }
    let cancelled = false;
    Promise.all([kanbanApi.listRoleAssignments(), kanbanApi.listRoles()])
      .then(([assignments, roles]) => {
        if (cancelled) return;
        const roleByKey = new Map(roles.map((r) => [r.key, r]));
        setAssigned(
          assignments
            .filter((a) => a.assigneeRef === assigneeRef && kinds.includes(a.assigneeKind))
            .map((a) => {
              const jr = roleByKey.get(a.roleKey);
              return { assignmentId: a.id, roleKey: a.roleKey, name: jr?.name ?? a.roleKey, icon: jr?.icon };
            }),
        );
      })
      .catch(() => { if (!cancelled) setAssigned([]); });
    return () => { cancelled = true; };
  }, [assigneeRef, kinds]);

  return assigned;
}
