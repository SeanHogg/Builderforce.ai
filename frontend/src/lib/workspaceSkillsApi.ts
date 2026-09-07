import { apiRequest } from './apiClient';

/**
 * The workspace's own skills — procedures agents proposed and people approve.
 *
 * Server counterpart: `api/src/presentation/routes/tenantSkillRoutes.ts`. Reading
 * is member-level (a skill is an instruction every agent here follows), reviewing
 * is manager-level, because approving one changes what every agent is told to do.
 */

export type WorkspaceSkillStatus = 'draft' | 'approved' | 'rejected';

export interface WorkspaceSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  status: WorkspaceSkillStatus;
  projectId: number | null;
  /** 'agent' when a run proposed it, 'human' when a person wrote it. */
  authorKind: string;
  /** Which agent proposed it, when one did. */
  authorLabel: string | null;
  /** What the proposing run offered as proof the procedure works. */
  evidence: string | null;
  originExecutionId: number | null;
  originTaskId: number | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
}

const BASE = '/api/workspace-skills';

export const workspaceSkillsApi = {
  list: (status?: WorkspaceSkillStatus): Promise<WorkspaceSkill[]> =>
    apiRequest<{ skills: WorkspaceSkill[] }>(status ? `${BASE}?status=${status}` : BASE).then((r) => r.skills),

  /** Approve or reject a proposal. The only way a skill becomes binding. */
  review: (id: string, decision: 'approved' | 'rejected', note?: string): Promise<WorkspaceSkill> =>
    apiRequest<{ skill: WorkspaceSkill }>(`${BASE}/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
    }).then((r) => r.skill),

  remove: (id: string): Promise<{ ok: boolean }> => apiRequest(`${BASE}/${id}`, { method: 'DELETE' }),
};
