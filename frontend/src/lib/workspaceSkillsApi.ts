import { apiRequest, type ApiRequestError } from './apiClient';
import type { SkillFile, SkillIssue } from '@builderforce/agent-skills';

/**
 * The workspace's own skills — procedures agents proposed and people approve, and
 * Agent Skills folders people bring in.
 *
 * Server counterpart: `api/src/presentation/routes/tenantSkillRoutes.ts`. Reading
 * is member-level (a skill is an instruction every agent here follows), reviewing
 * and importing are manager-level, because either changes what every agent is told
 * to do.
 */

export type WorkspaceSkillStatus = 'draft' | 'approved' | 'rejected';

/** One bundled file of a skill folder, as the list shows it (no content). */
export interface WorkspaceSkillFileEntry {
  path: string;
  sizeBytes: number;
}

export interface WorkspaceSkill {
  id: string;
  /** The Agent Skills `name` (kebab-case) — what agents load it by. */
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
  /** Files bundled beside SKILL.md (scripts/, references/, assets/). */
  files: WorkspaceSkillFileEntry[];
}

/** A skill as an Agent Skills folder — SKILL.md first. */
export interface SkillFolder {
  name: string;
  files: SkillFile[];
}

/** An import the server refused, with the spec issues that made it refuse. */
export class SkillFolderRejected extends Error {
  constructor(public readonly issues: SkillIssue[]) {
    super('This folder is not a valid Agent Skill');
    this.name = 'SkillFolderRejected';
  }
}

/**
 * The spec issues a 422 carries (`details.issues`), as a typed error — shared by the
 * workspace import and the marketplace publish, which refuse a folder the same way.
 */
export function skillIssuesError(e: unknown): unknown {
  const issues = (e as ApiRequestError | undefined)?.details as { issues?: SkillIssue[] } | undefined;
  return issues?.issues?.length ? new SkillFolderRejected(issues.issues) : e;
}

const BASE = '/api/workspace-skills';

export const workspaceSkillsApi = {
  list: (status?: WorkspaceSkillStatus): Promise<WorkspaceSkill[]> =>
    apiRequest<{ skills: WorkspaceSkill[] }>(status ? `${BASE}?status=${status}` : BASE).then((r) => r.skills),

  /** Approve or reject a proposal. The only way an agent's draft becomes binding. */
  review: (id: string, decision: 'approved' | 'rejected', note?: string): Promise<WorkspaceSkill> =>
    apiRequest<{ skill: WorkspaceSkill }>(`${BASE}/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
    }).then((r) => r.skill),

  /**
   * Bring in an Agent Skills folder. The importer signs it off, so it is approved on
   * arrival; re-importing a name replaces that skill and its whole folder. `mode:
   * 'create'` refuses (409) instead of replacing — for a skill written as NEW.
   */
  importFolder: async (files: readonly SkillFile[], projectId?: number | null, mode?: 'create' | 'replace'): Promise<{ skill: WorkspaceSkill; outcome: 'created' | 'replaced'; issues: SkillIssue[] }> => {
    try {
      return await apiRequest(`${BASE}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, ...(projectId != null ? { projectId } : {}), ...(mode ? { mode } : {}) }),
        // A folder that fails the spec (or a taken name) is the author's to fix, not a fault to report.
        expectedErrors: [409, 422],
      });
    } catch (e) {
      throw skillIssuesError(e);
    }
  },

  /** The skill as a spec folder, ready to zip or drop into any agent's skills dir. */
  exportFolder: (id: string): Promise<SkillFolder> => apiRequest<SkillFolder>(`${BASE}/${id}/export`),

  remove: (id: string): Promise<{ ok: boolean }> => apiRequest(`${BASE}/${id}`, { method: 'DELETE' }),
};
