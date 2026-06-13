/**
 * Shared task-assignee encode/decode helpers.
 *
 * Humans and agents are one team: a task is owned by EXACTLY ONE of a self-hosted
 * agent host (numeric id), a cloud agent (string ref), or a human teammate
 * (users.id) — never more than one. The three id spaces are disjoint, so we encode
 * the choice into a single string value (`h:<id>` / `c:<ref>` / `u:<userId>` /
 * '' = none) and decode it back into the mutually-exclusive fields.
 *
 * Centralizing this keeps every assignee surface in sync — the task create dialog,
 * the board drawer editor, the standup pivot, and the ceremony round-table all use
 * the same encoder/decoder. Decoding always emits ALL THREE fields so picking one
 * clears the others (the write path persists the nulls).
 */
import type { AgentHost } from './builderforceApi';

/** A cloud agent (ide_agents) that a task can be assigned to. */
export type CloudAgentTarget = { ref: string; name: string };
/** A human teammate (users.id) that a task can be assigned to. */
export type TeamMember = { id: string; name: string };

export type AssigneePatch = {
  assignedAgentHostId: number | null;
  assignedAgentRef: string | null;
  assignedUserId: string | null;
};

/** Encode the mutually-exclusive assignee fields into a single select value. */
export function assigneeSelectValue(
  hostId?: number | null,
  ref?: string | null,
  userId?: string | null,
): string {
  if (hostId != null) return `h:${hostId}`;
  if (ref) return `c:${ref}`;
  if (userId) return `u:${userId}`;
  return '';
}

/** Decode a select value back into the three (mutually-exclusive) assignee fields. */
export function parseAssigneeSelectValue(v: string): AssigneePatch {
  if (v.startsWith('h:')) return { assignedAgentHostId: Number(v.slice(2)), assignedAgentRef: null, assignedUserId: null };
  if (v.startsWith('c:')) return { assignedAgentHostId: null, assignedAgentRef: v.slice(2), assignedUserId: null };
  if (v.startsWith('u:')) return { assignedAgentHostId: null, assignedAgentRef: null, assignedUserId: v.slice(2) };
  return { assignedAgentHostId: null, assignedAgentRef: null, assignedUserId: null };
}

/** Display name for whichever assignee a task carries (host, cloud agent, or human). */
export function assigneeName(
  hostId: number | null | undefined,
  ref: string | null | undefined,
  userId: string | null | undefined,
  hosts: AgentHost[],
  cloudAgents: CloudAgentTarget[],
  members: TeamMember[],
): string {
  if (hostId != null) return hosts.find((h) => h.id === hostId)?.name ?? String(hostId);
  if (ref) return cloudAgents.find((a) => a.ref === ref)?.name ?? ref;
  if (userId) return members.find((m) => m.id === userId)?.name ?? userId;
  return 'Unassigned';
}
