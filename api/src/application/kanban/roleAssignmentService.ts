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
 *
 * SINGLE-ASSIGNEE semantics (task #775): assigning a new person to a role that
 * already has a different assignee atomically REPLACES the previous one — delete
 * old row + insert new row in one transaction so no caller ever sees two rows for
 * the same (scope, roleKey). Re-assigning the same person is a no-op.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { projectRoleAssignments } from '../../infrastructure/database/schema';
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

/** Return value from create() — always contains the resulting assignment,
 *  plus the previous assignment if one was replaced. */
export interface CreateResult {
  assignment: RoleAssignment;
  replaced: RoleAssignment | null;
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

  /**
   * Create or replace a role assignment.
   *
   * Single-assignee semantics (PRD task #775):
   * 1. Idempotent no-op when the same (kind, ref) already holds the role.
   * 2. When a DIFFERENT assignee already holds the role, atomically delete the
   *    old row and insert the new one inside a transaction.
   * 3. First-time assignment for the role is a plain insert.
   *
   * Returns the new assignment plus the replaced one (null on no-op / first-time).
   */
  async create(
    env: Env,
    tenantId: number,
    createdBy: string | null,
    body: RoleAssignmentWrite,
  ): Promise<CreateResult> {
    const roleKey = body.roleKey?.trim();
    const assigneeRef = body.assigneeRef?.trim();
    if (!roleKey) throw new Error('roleKey is required');
    if (!assigneeRef) throw new Error('assigneeRef is required');
    if (!ASSIGNEE_KINDS.includes(body.assigneeKind)) throw new Error('assigneeKind must be agent, human or hire');
    const projectId = body.projectId ?? null;

    const scopeClause = projectId == null
      ? isNull(projectRoleAssignments.projectId)
      : eq(projectRoleAssignments.projectId, projectId);

    // ----- Idempotent no-op: same person already holds the role -----
    const existing = await this.db
      .select()
      .from(projectRoleAssignments)
      .where(and(
        eq(projectRoleAssignments.tenantId, tenantId),
        scopeClause,
        eq(projectRoleAssignments.roleKey, roleKey),
        eq(projectRoleAssignments.assigneeKind, body.assigneeKind),
        eq(projectRoleAssignments.assigneeRef, assigneeRef),
      ))
      .limit(1);
    if (existing[0]) {
      return { assignment: this.mapRow(existing[0]), replaced: null };
    }

    // ----- Check for a conflicting assignment (different assignee, same role) -----
    const conflict = await this.db
      .select()
      .from(projectRoleAssignments)
      .where(and(
        eq(projectRoleAssignments.tenantId, tenantId),
        scopeClause,
        eq(projectRoleAssignments.roleKey, roleKey),
      ))
      .limit(1);

    let replaced: RoleAssignment | null = null;

    if (conflict[0]) {
      // Atomic replacement: delete old, insert new within a single transaction.
      const replacedRow = conflict[0];
      replaced = this.mapRow(replacedRow);

      await this.db.transaction(async (tx) => {
        await tx
          .delete(projectRoleAssignments)
          .where(eq(projectRoleAssignments.id, replacedRow.id));

        const id = crypto.randomUUID();
        await tx.insert(projectRoleAssignments).values({
          id, tenantId, projectId, roleKey,
          assigneeKind: body.assigneeKind,
          assigneeRef,
          assigneeName: body.assigneeName?.trim() || null,
          createdBy,
          createdAt: new Date(),
        });
      });
    } else {
      // First-time assignment for this role — plain insert.
      const id = crypto.randomUUID();
      await this.db.insert(projectRoleAssignments).values({
        id, tenantId, projectId, roleKey,
        assigneeKind: body.assigneeKind,
        assigneeRef,
        assigneeName: body.assigneeName?.trim() || null,
        createdBy,
        createdAt: new Date(),
      });
    }

    const assignment: RoleAssignment = {
      id: crypto.randomUUID(), // will be overwritten below — the transaction or insert already used a new id
      roleKey,
      assigneeKind: body.assigneeKind,
      assigneeRef,
      assigneeName: body.assigneeName?.trim() || null,
      projectId,
    };

    // We need the actual id from the insert. Re-fetch it.
    const inserted = await this.db
      .select()
      .from(projectRoleAssignments)
      .where(and(
        eq(projectRoleAssignments.tenantId, tenantId),
        scopeClause,
        eq(projectRoleAssignments.roleKey, roleKey),
      ))
      .limit(1);

    const result = inserted[0] ? this.mapRow(inserted[0]) : assignment;

    await invalidateCached(env, assignmentsKey(tenantId));
    // Dispatch capability (`loadRoleRosterData`) is version-keyed separately from
    // the roster UI cache. Without this bump a correct role pin remains invisible to
    // lane authority for up to five minutes, so a freshly staffed stage still reports
    // `lane_agents_not_role_capable` and refuses work.
    await bumpWorkforceMetricsVersion(env, tenantId);

    // ----- Audit trail -----
    try {
      const actor = await resolveActorByRef(env, this.db, tenantId, createdBy);
      if (replaced) {
        await recordActivity(env, this.db, {
          tenantId,
          projectId,
          actor,
          verb: 'role.replaced',
          targetType: 'role',
          targetId: roleKey,
          targetLabel: body.assigneeName?.trim() || assigneeRef,
          summary: `Replaced ${replaced.assigneeName || replaced.assigneeRef} with ${body.assigneeName?.trim() || assigneeRef} on ${roleKey}`,
          metadata: {
            assigneeKind: body.assigneeKind,
            assigneeRef,
            projectId,
            replaced: {
              id: replaced.id,
              assigneeKind: replaced.assigneeKind,
              assigneeRef: replaced.assigneeRef,
              assigneeName: replaced.assigneeName,
            },
          },
        });
      } else {
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
      }
    } catch (error) { /* best-effort audit */
      reportCaughtError(error, { source: "application/kanban/roleAssignmentService.ts", operation: "create" });
    }

    return { assignment: result, replaced };
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
