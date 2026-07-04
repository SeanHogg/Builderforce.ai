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
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { templateRosterRoles } from './types';
import { DEFAULT_TEMPLATE_ID } from './templateCatalog';
import { agentMatchesRole, normalizeRoleText } from './roleMatch';
import type { JobRoleService } from './jobRoleService';
import type { KanbanTemplateService } from './kanbanTemplateService';

export interface RosterFiller {
  kind: 'human' | 'agent';
  ref: string;
  name: string;
  /** How we matched: staffed to a lane / matched by title-skill / discipline. */
  via: 'lane' | 'agent-skill' | 'discipline';
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

const rosterKey = (tenantId: number, projectId: number) => `kanban:roster:${tenantId}:${projectId}`;

export class RosterService {
  constructor(
    private readonly db: Db,
    private readonly templates: KanbanTemplateService,
    private readonly roles: JobRoleService,
  ) {}

  async getRecommendedRoster(env: Env, tenantId: number, projectId: number): Promise<RecommendedRoster> {
    return getOrSetCached(env, rosterKey(tenantId, projectId), () => this.compute(env, tenantId, projectId));
  }

  invalidate(env: Env, tenantId: number, projectId: number): Promise<void> {
    return invalidateCached(env, rosterKey(tenantId, projectId));
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

      // 1) An agent explicitly staffed to a lane carrying this role.
      for (const a of laneAssignments) {
        if (a.agentRef && normalizeRoleText(a.role) === nk) {
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
          if (h.discipline && normalizeRoleText(h.discipline) === normalizeRoleText(def.discipline)) {
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
