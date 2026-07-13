import type { Task } from '@/lib/builderforceApi';
import type { TeamMemberKind } from '@/lib/teams';
import type { AssigneePatch } from '@/lib/taskAssignee';

/** A seat at the round table — a human teammate or an agent (cloud / host). */
export interface CeremonyMember {
  kind: TeamMemberKind; // 'human' | 'cloud_agent' | 'host_agent'
  /** Stable identity: users.id / ide_agents.id / agent_hosts.id. */
  ref: string;
  name: string;
}

/** The MIME-ish key tasks are dragged under (native HTML5 DnD dataTransfer). */
export const DRAG_TASK = 'text/plain';

/** The mutually-exclusive assignee patch that hands a task to this member. */
export function memberAssigneePatch(m: CeremonyMember): AssigneePatch {
  if (m.kind === 'human') return { assignedUserId: m.ref, assignedAgentRef: null, assignedAgentHostId: null };
  if (m.kind === 'cloud_agent') return { assignedAgentRef: m.ref, assignedUserId: null, assignedAgentHostId: null };
  return { assignedAgentHostId: Number(m.ref), assignedUserId: null, assignedAgentRef: null };
}

/** Whether a task is currently owned by this member. */
export function taskBelongsToMember(t: Task, m: CeremonyMember): boolean {
  if (m.kind === 'human') return t.assignedUserId === m.ref;
  if (m.kind === 'cloud_agent') return t.assignedAgentRef === m.ref;
  return t.assignedAgentHostId === Number(m.ref);
}

/** Stable key for a member (kind + ref), used for React keys and presence match. */
export function memberKey(m: { kind: string; ref: string }): string {
  return `${m.kind}:${m.ref}`;
}
