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
import { projectRoleAssignments } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { recordActivity, resolveActorByRef } from '../activity/activityLog';

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
    await invalidateCached(env, assignmentsKey(tenantId));

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
    } catch { /* best-effort audit */ }
    return { id, roleKey, assigneeKind: body.assigneeKind, assigneeRef, assigneeName: body.assigneeName?.trim() || null, projectId };
  }

  /** Delete by id (scoped to tenant). Returns the removed row's projectId for cache work. */
  async remove(env: Env, tenantId: number, id: string): Promise<void> {
    await this.db
      .delete(projectRoleAssignments)
      .where(and(eq(projectRoleAssignments.tenantId, tenantId), eq(projectRoleAssignments.id, id)));
    await invalidateCached(env, assignmentsKey(tenantId));
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
