import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Roster role assignments — the explicit "pin an existing agent / human member /
 * hired contractor to a role" primitive. Complements the INFERRED coverage the
 * roster derives from lane staffing + skill/discipline matching: this table records
 * the manager's deliberate decisions, which the roster merges into `filledBy`.
 *
 * Scope is carried by `projectId`:
 *   - null  → a workspace-default assignment (Workforce → Roles tab), every project.
 *   - <id>  → a project-specific assignment (the project's Recommended Roster card).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { projectAgents, projectRoleAssignments } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { recordActivity, resolveActorByRef } from '../activity/activityLog';
import { bumpWorkforceMetricsVersion } from '../metrics/workforceMetrics';

export type AssigneeKind = 'agent' | 'human' | 'hire';

export interface RoleAssignment {
  id: string;
  roleKey: string;
  assigneeKind: AssigneeKind;
  assigneeRef: string;
  assigneeName: string | null;
  projectId: number | null;
}

export interface RoleAssignmentWrite {
  roleKey: string;
  assigneeKind: AssigneeKind;
  assigneeRef: string;
  assigneeName?: string | null;
  projectId?: number | null;
}

const ASSIGNEE_KINDS: readonly AssigneeKind[] = ['agent', 'human', 'hire'];

/** Cache key for the workspace-wide read (defaults + all project rows). */
const assignmentsKey = (tenantId: number) => `kanban:roleAssignments:${tenantId}`;

export class RoleAssignmentService {
  constructor(private readonly db: Db) {}

  /**
   * The `project_agents` attachment behind a role assignment.
   *
   * `onConflictDoNothing` on purpose: the agent may already be attached (added
   * by hand, or staffed onto a second role), and re-staffing must not renumber
   * the row — `artifact_assignments.scope_id` points at that id, so a new row
   * would silently orphan every per-agent skill and persona.
   *
   * Deliberately NOT reversed on unassign: an attachment can outlive the role
   * that created it (the same agent may be doing other work on the project), so
   * detaching is an explicit act on the capabilities tab.
   */
  private async attachRoleAgent(
    tenantId: number,
    projectId: number,
    roleKey: string,
    assigneeRef: string,
    assigneeName: string | null,
    createdBy: string | null,
  ): Promise<void> {
    await this.db.insert(projectAgents).values({
      tenantId,
      projectId,
      agentKind: 'workforce',
      agentRef: assigneeRef,
      name: assigneeName?.trim() || assigneeRef,
      role: roleKey.slice(0, 64),
      addedBy: createdBy,
    }).onConflictDoNothing();
  }

  /** All assignments for a tenant (both workspace-default and project-scoped). Cached. */
  private allForTenant(env: Env, tenantId: number): Promise<RoleAssignment[]> {
    return getOrSetCached(env, assignmentsKey(tenantId), async () => {
      const rows = await this.db
        .select()
        .from(projectRoleAssignments)
        .where(eq(projectRoleAssignments.tenantId, tenantId));
      return rows.map(this.mapRow);
    });
  }

  /** Assignments that apply to a project's roster: its own rows + workspace defaults. */
  async listForRoster(env: Env, tenantId: number, projectId: number): Promise<RoleAssignment[]> {
    const all = await this.allForTenant(env, tenantId);
    return all.filter((a) => a.projectId == null || a.projectId === projectId);
  }

  /** Assignments for one scope: a specific project, or the workspace defaults (projectId null). */
  async listForScope(env: Env, tenantId: number, projectId: number | null): Promise<RoleAssignment[]> {
    const all = await this.allForTenant(env, tenantId);
    return all.filter((a) => (projectId == null ? a.projectId == null : a.projectId === projectId));
  }

  async create(env: Env, tenantId: number, createdBy: string | null, body: RoleAssignmentWrite): Promise<RoleAssignment> {
    const roleKey = body.roleKey?.trim();
    const assigneeRef = body.assigneeRef?.trim();
    if (!roleKey) throw new Error('roleKey is required');
    if (!assigneeRef) throw new Error('assigneeRef is required');
    if (!ASSIGNEE_KINDS.includes(body.assigneeKind)) throw new Error('assigneeKind must be agent, human or hire');
    const projectId = body.projectId ?? null;

    // Idempotent: re-assigning the same person to the same role in the same scope is a no-op.
    const existing = await this.db
      .select()
      .from(projectRoleAssignments)
      .where(and(
        eq(projectRoleAssignments.tenantId, tenantId),
        projectId == null ? isNull(projectRoleAssignments.projectId) : eq(projectRoleAssignments.projectId, projectId),
        eq(projectRoleAssignments.roleKey, roleKey),
        eq(projectRoleAssignments.assigneeKind, body.assigneeKind),
        eq(projectRoleAssignments.assigneeRef, assigneeRef),
      ))
      .limit(1);
    if (existing[0]) return this.mapRow(existing[0]);

    const id = crypto.randomUUID();
    await this.db.insert(projectRoleAssignments).values({
      id, tenantId, projectId, roleKey,
      assigneeKind: body.assigneeKind,
      assigneeRef,
      assigneeName: body.assigneeName?.trim() || null,
      createdBy,
      createdAt: new Date(),
    });
    // MATERIALIZE the capability target. The Agent/Capabilities tab reads
    // `project_agents`; the roster writes `project_role_assignments`. While those
    // were two independent lists, an agent staffed onto a role through the roster
    // never appeared in the capabilities "Agents (N)" list, and the per-agent
    // skills/personas/content that hang off `project_agents.id` had nowhere to
    // attach. One staffing decision, one attachment row — created here rather
    // than by a UI, so every writer (roster, manager auto-staffing, MCP) gets it.
    //
    // Only for a real project: a workspace-default assignment (projectId null)
    // is a default, not an attachment, and `uq_project_agents_identity` reserves
    // the NULL-project row for the agent's canonical identity.
    if (body.assigneeKind === 'agent' && projectId != null) {
      await this.attachRoleAgent(tenantId, projectId, roleKey, assigneeRef, body.assigneeName ?? null, createdBy);
    }

    await invalidateCached(env, assignmentsKey(tenantId));
    // Dispatch capability (`loadRoleRosterData`) is version-keyed separately from
    // the roster UI cache. Without this bump a correct role pin remains invisible to
    // lane authority for up to five minutes, so a freshly staffed stage still reports
    // `lane_agents_not_role_capable` and refuses work.
    await bumpWorkforceMetricsVersion(env, tenantId);

    // Unified audit stream: a roster staffing decision (who covers which role),
    // attributed to the manager who made it. Best-effort — never fail the assignment.
    try {
      const actor = await resolveActorByRef(env, this.db, tenantId, createdBy);
      await recordActivity(env, this.db, {
        tenantId,
        projectId,
        actor,
        verb: 'role.assigned',
        targetType: 'role',
        targetId: roleKey,
        targetLabel: body.assigneeName?.trim() || assigneeRef,
        summary: `Assigned ${body.assigneeName?.trim() || assigneeRef} to ${roleKey}`,
        metadata: { assigneeKind: body.assigneeKind, assigneeRef, projectId },
      });
    } catch (error) { /* best-effort audit */ 
      reportCaughtError(error, { source: "application/kanban/roleAssignmentService.ts", operation: "create" });
    }
    return { id, roleKey, assigneeKind: body.assigneeKind, assigneeRef, assigneeName: body.assigneeName?.trim() || null, projectId };
  }

  /** Delete by id (scoped to tenant). Returns the removed row's projectId for cache work. */
  async remove(env: Env, tenantId: number, id: string): Promise<void> {
    await this.db
      .delete(projectRoleAssignments)
      .where(and(eq(projectRoleAssignments.tenantId, tenantId), eq(projectRoleAssignments.id, id)));
    await invalidateCached(env, assignmentsKey(tenantId));
    await bumpWorkforceMetricsVersion(env, tenantId);
  }

  private mapRow = (r: typeof projectRoleAssignments.$inferSelect): RoleAssignment => ({
    id: r.id,
    roleKey: r.roleKey,
    assigneeKind: r.assigneeKind as AssigneeKind,
    assigneeRef: r.assigneeRef,
    assigneeName: r.assigneeName ?? null,
    projectId: r.projectId ?? null,
  });

}
