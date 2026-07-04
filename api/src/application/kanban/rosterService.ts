/**
 * Recommended roster — pillar 5.
 *
 * On account/project setup we show the roster of ROLES a team should fill for its
 * chosen kanban template, and whether each role is already covered by someone in
 * the workforce (a human OR an agent). Gaps are what the company hires for — or
 * creates an agent to fill. The roster is simply the union of roles the active
 * template references, joined against the workforce.
 */
import { and, eq } from 'drizzle-orm';
import {
  boards,
  ideAgents,
  memberProfiles,
  projects,
  swimlaneAgentAssignments,
  swimlanes,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { templateRosterRoles } from './types';
import { DEFAULT_TEMPLATE_ID } from './templateCatalog';
import { agentMatchesRole, normalizeRoleText } from './roleMatch';
import type { JobRoleService } from './jobRoleService';
import type { KanbanTemplateService } from './kanbanTemplateService';
import type { RoleAssignmentService } from './roleAssignmentService';

export interface RosterFiller {
  kind: 'human' | 'agent' | 'hire';
  ref: string;
  name: string;
  /** How we matched: an explicit assignment / staffed to a lane / title-skill / discipline. */
  via: 'assignment' | 'lane' | 'agent-skill' | 'discipline';
  /** Present when `via === 'assignment'`: the assignment row id (so the UI can unassign). */
  assignmentId?: string;
}

export interface RosterRole {
  roleKey: string;
  name: string;
  discipline: string;
  icon?: string;
  color?: string;
  description?: string;
  required: boolean;
  lanes: string[];
  status: 'filled' | 'gap';
  filledBy: RosterFiller[];
}

export interface RecommendedRoster {
  templateId: string;
  templateName: string;
  roles: RosterRole[];
  filledCount: number;
  gapCount: number;
}

/** Bumping this per-tenant token orphans every project's roster at once — cheaper
 *  than enumerating each `${tenantId}:${projectId}` key when a workspace-wide input
 *  (template apply, role edit, a role assignment) changes. */
const rosterVersionKey = (tenantId: number) => `kanban:roster:${tenantId}`;

export class RosterService {
  constructor(
    private readonly db: Db,
    private readonly templates: KanbanTemplateService,
    private readonly roles: JobRoleService,
    private readonly assignments: RoleAssignmentService,
  ) {}

  async getRecommendedRoster(env: Env, tenantId: number, projectId: number): Promise<RecommendedRoster> {
    const ver = await getCacheVersion(env, rosterVersionKey(tenantId));
    return getOrSetCached(env, `kanban:roster:${tenantId}:${projectId}:v:${ver}`, () => this.compute(env, tenantId, projectId));
  }

  /** Invalidate every cached roster for the tenant (all projects). */
  invalidate(env: Env, tenantId: number, _projectId?: number): Promise<void> {
    return bumpCacheVersion(env, rosterVersionKey(tenantId));
  }

  private async compute(env: Env, tenantId: number, projectId: number): Promise<RecommendedRoster> {
    const [project] = await this.db
      .select({ kanbanTemplateId: projects.kanbanTemplateId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const templateId = project?.kanbanTemplateId || DEFAULT_TEMPLATE_ID;
    const template = (await this.templates.get(env, tenantId, templateId))
      ?? (await this.templates.get(env, tenantId, DEFAULT_TEMPLATE_ID))!;
    const roleDefs = await this.roles.list(env, tenantId);
    const roleByKey = new Map(roleDefs.map((r) => [r.key, r]));

    // Explicit role assignments (workspace-default + this project), grouped by role.
    const explicit = await this.assignments.listForRoster(env, tenantId, projectId);
    const explicitByRole = new Map<string, typeof explicit>();
    for (const a of explicit) {
      const nk = normalizeRoleText(a.roleKey);
      const list = explicitByRole.get(nk) ?? [];
      list.push(a);
      explicitByRole.set(nk, list);
    }

    // Workforce signals, loaded once.
    const [laneAssignments, agents, humans] = await Promise.all([
      this.db
        .select({ role: swimlaneAgentAssignments.role, agentRef: swimlaneAgentAssignments.agentRef, name: swimlaneAgentAssignments.name })
        .from(swimlaneAgentAssignments)
        .innerJoin(swimlanes, eq(swimlaneAgentAssignments.swimlaneId, swimlanes.id))
        .innerJoin(boards, eq(swimlanes.boardId, boards.id))
        .where(and(eq(boards.projectId, projectId), eq(boards.tenantId, tenantId))),
      this.db
        .select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, skills: ideAgents.skills })
        .from(ideAgents)
        .where(eq(ideAgents.tenantId, tenantId)),
      this.db
        .select({ ref: memberProfiles.memberRef, discipline: memberProfiles.discipline })
        .from(memberProfiles)
        .where(and(eq(memberProfiles.tenantId, tenantId), eq(memberProfiles.memberKind, 'human'))),
    ]);

    const rosterRoles = templateRosterRoles(template);
    const roles: RosterRole[] = rosterRoles.map((rr) => {
      const def = roleByKey.get(rr.roleKey);
      const roleName = def?.name ?? rr.roleKey;
      const nk = normalizeRoleText(rr.roleKey);
      const filledBy: RosterFiller[] = [];

      // 0) Explicit assignments — a manager pinned this agent/human/hire to the role.
      //    These take precedence and always render (with an unassign affordance).
      for (const a of explicitByRole.get(nk) ?? []) {
        filledBy.push({
          kind: a.assigneeKind === 'agent' ? 'agent' : a.assigneeKind === 'hire' ? 'hire' : 'human',
          ref: a.assigneeRef,
          name: a.assigneeName ?? a.assigneeRef,
          via: 'assignment',
          assignmentId: a.id,
        });
      }
      // 1) An agent explicitly staffed to a lane carrying this role.
      for (const a of laneAssignments) {
        if (a.agentRef && normalizeRoleText(a.role) === nk && !filledBy.some((f) => f.ref === a.agentRef)) {
          filledBy.push({ kind: 'agent', ref: a.agentRef, name: a.name ?? roleName, via: 'lane' });
        }
      }
      // 2) A tenant agent whose title/skills match the role.
      for (const a of agents) {
        if (agentMatchesRole(a, rr.roleKey, roleName) && !filledBy.some((f) => f.ref === a.id)) {
          filledBy.push({ kind: 'agent', ref: a.id, name: a.name, via: 'agent-skill' });
        }
      }
      // 3) A human whose discipline matches the role's discipline.
      if (def?.discipline) {
        for (const h of humans) {
          if (h.discipline && normalizeRoleText(h.discipline) === normalizeRoleText(def.discipline) && !filledBy.some((f) => f.ref === h.ref)) {
            filledBy.push({ kind: 'human', ref: h.ref, name: h.ref, via: 'discipline' });
          }
        }
      }

      return {
        roleKey: rr.roleKey,
        name: roleName,
        discipline: def?.discipline ?? 'engineering',
        icon: def?.icon,
        color: def?.color,
        description: def?.description,
        required: rr.required,
        lanes: rr.lanes,
        status: filledBy.length > 0 ? 'filled' : 'gap',
        filledBy,
      };
    });

    // Required roles first, then gaps before filled.
    roles.sort((a, b) => Number(b.required) - Number(a.required) || Number(a.status === 'filled') - Number(b.status === 'filled'));

    return {
      templateId: template.id,
      templateName: template.name,
      roles,
      filledCount: roles.filter((r) => r.status === 'filled').length,
      gapCount: roles.filter((r) => r.status === 'gap').length,
    };
  }
}
