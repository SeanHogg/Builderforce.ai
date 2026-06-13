/**
 * Workforce Teams API client — /api/teams.
 *
 * A team groups the workforce (agents AND humans). A member is identified the
 * same way a task assignee is: a human (users.id), a cloud agent (ide_agents.id),
 * or a remote host (agent_hosts.id). A workforce entity can be in many teams; a
 * team can be attached to many projects.
 */
import { apiRequest, type RequestOptions } from './apiClient';

export type TeamMemberKind = 'human' | 'cloud_agent' | 'host_agent';

export interface TeamSummary {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  projectCount: number;
}

export interface TeamMember {
  id: number;
  memberKind: TeamMemberKind;
  memberRef: string;
  memberName: string;
  addedAt: string;
}

export interface TeamProject {
  id: number;
  publicId: string;
  key: string;
  name: string;
  addedAt: string;
}

export interface TeamDetail extends Omit<TeamSummary, 'memberCount' | 'projectCount'> {
  tenantId: number;
  members: TeamMember[];
  projects: TeamProject[];
}

const json = (body: unknown): RequestOptions => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function listTeams(): Promise<TeamSummary[]> {
  const r = await apiRequest<{ teams: TeamSummary[] }>('/api/teams');
  return r.teams;
}

export async function getTeam(id: number): Promise<TeamDetail> {
  return apiRequest<TeamDetail>(`/api/teams/${id}`);
}

/** Minimal team shape returned by the by-project read (Board-config Teams tab). */
export interface AttachedTeam {
  id: number;
  name: string;
  description: string | null;
}

/** The teams attached to a project (a board is 1:1 with its project). */
export async function listTeamsByProject(projectId: number): Promise<AttachedTeam[]> {
  const r = await apiRequest<{ teams: AttachedTeam[] }>(`/api/teams/by-project/${projectId}`);
  return r.teams;
}

/** The assignable workforce for a project — the union of every attached team's
 *  members. `scopedToTeams` is false (workforce empty) when no team is assigned,
 *  so callers fall back to the full tenant roster. Drives assignee-picker scoping. */
export interface ProjectWorkforce {
  scopedToTeams: boolean;
  workforce: WorkforceOption[];
}

export async function getProjectWorkforce(projectId: number): Promise<ProjectWorkforce> {
  return apiRequest<ProjectWorkforce>(`/api/teams/by-project/${projectId}/workforce`);
}

export async function createTeam(data: { name: string; description?: string }): Promise<TeamSummary> {
  return apiRequest<TeamSummary>('/api/teams', { method: 'POST', ...json(data) });
}

export async function updateTeam(
  id: number,
  data: { name?: string; description?: string | null },
): Promise<TeamSummary> {
  return apiRequest<TeamSummary>(`/api/teams/${id}`, { method: 'PATCH', ...json(data) });
}

export async function deleteTeam(id: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/teams/${id}`, { method: 'DELETE' });
}

export async function addTeamMember(
  teamId: number,
  member: { memberKind: TeamMemberKind; memberRef: string; memberName: string },
): Promise<TeamMember> {
  return apiRequest<TeamMember>(`/api/teams/${teamId}/members`, { method: 'POST', ...json(member) });
}

export async function removeTeamMember(teamId: number, memberId: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/teams/${teamId}/members/${memberId}`, { method: 'DELETE' });
}

export async function addTeamProject(teamId: number, projectId: number): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/projects`, {
    method: 'POST',
    ...json({ projectId }),
    expectedErrors: [409],
  });
}

export async function removeTeamProject(teamId: number, projectId: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/teams/${teamId}/projects/${projectId}`, { method: 'DELETE' });
}

// --- Workforce directory (the pool a member is picked from) -----------------

export interface WorkforceOption {
  kind: TeamMemberKind;
  /** Stable identity used as memberRef (users.id / ide_agents.id / agent_hosts.id). */
  ref: string;
  name: string;
}

/**
 * The full pool of addable workforce entities: humans (tenant members) + cloud
 * agents + remote hosts. Assembled from the existing assignee/agent/host
 * endpoints so the picker stays a single source of truth with the rest of the app.
 */
export async function listWorkforceDirectory(): Promise<WorkforceOption[]> {
  const [humansRes, agentsRes, hostsRes] = await Promise.all([
    apiRequest<{ members: { id: string; name: string }[] }>('/api/tasks/assignees').catch(() => ({ members: [] })),
    apiRequest<unknown>('/api/workforce/agents/mine').catch(() => []),
    apiRequest<{ agentHosts: { id: number; name: string }[] }>('/api/agent-hosts').catch(() => ({ agentHosts: [] })),
  ]);

  const humans: WorkforceOption[] = (humansRes.members ?? []).map((m) => ({
    kind: 'human', ref: String(m.id), name: m.name,
  }));

  // ide_agents rows; id + name are the only fields we need for the picker.
  const agentRows = Array.isArray(agentsRes) ? (agentsRes as { id: string; name: string }[]) : [];
  const cloudAgents: WorkforceOption[] = agentRows.map((a) => ({
    kind: 'cloud_agent', ref: String(a.id), name: a.name,
  }));

  const hosts: WorkforceOption[] = (hostsRes.agentHosts ?? []).map((h) => ({
    kind: 'host_agent', ref: String(h.id), name: h.name,
  }));

  return [...humans, ...cloudAgents, ...hosts];
}
