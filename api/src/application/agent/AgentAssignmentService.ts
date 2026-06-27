/**
 * AgentAssignmentService — the single read/write path for the canonical
 * agent-assignment model (schema.agentAssignments). Every surface that needs to
 * know "which agents are assigned here" (project, workflow, security, swimlane,
 * brain) goes through this, so the lookup + caching live in
 * ONE place (DRY) rather than each surface re-querying.
 *
 * Reads are served through the canonical read-through cache (L1 Map + L2 KV) and
 * invalidated on every write — assignment lists are read on hot runtime paths
 * (e.g. resolving the agent for a dispatch / brain turn) but change rarely.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { agentAssignments } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** The platform aspects an agent can be assigned to. */
export type AssignmentScope =
  | 'project'
  | 'workflow'
  | 'security'
  | 'swimlane'
  | 'brain'
  | 'global';

export type ExecutionScope = 'project' | 'global';

export interface AgentAssignment {
  id: string;
  agentKind: string;
  agentRef: string;
  scope: AssignmentScope;
  scopeId: string | null;
  executionScope: ExecutionScope;
  role: string;
}

export interface AssignInput {
  agentKind: string;
  agentRef: string;
  scope: AssignmentScope;
  scopeId?: string | null;
  executionScope?: ExecutionScope;
  role?: string;
}

function cacheKey(tenantId: number, scope: string, scopeId: string | null | undefined): string {
  return `agent-assign:${tenantId}:${scope}:${scopeId ?? '_'}`;
}

export class AgentAssignmentService {
  constructor(private readonly db: Db, private readonly env: Env) {}

  /** Assignments for a scope (and optional target). Cached; invalidated on write. */
  async list(tenantId: number, scope: AssignmentScope, scopeId?: string | null): Promise<AgentAssignment[]> {
    return getOrSetCached(this.env, cacheKey(tenantId, scope, scopeId), async () => {
      const conds = [eq(agentAssignments.tenantId, tenantId), eq(agentAssignments.scope, scope)];
      if (scopeId != null) conds.push(eq(agentAssignments.scopeId, scopeId));
      const rows = await this.db.select().from(agentAssignments).where(and(...conds));
      return rows.map(toAssignment);
    });
  }

  /** Create-or-update an assignment (idempotent on tenant+agent+scope+target).
   *  Manual upsert — the unique guard is an expression index (COALESCE on a
   *  nullable scopeId), which onConflict cannot target by column list. */
  async assign(tenantId: number, input: AssignInput): Promise<AgentAssignment> {
    const now = new Date();
    const scopeId = input.scopeId ?? null;
    const executionScope = input.executionScope ?? 'project';
    const role = input.role ?? 'default';

    const match = [
      eq(agentAssignments.tenantId, tenantId),
      eq(agentAssignments.agentKind, input.agentKind),
      eq(agentAssignments.agentRef, input.agentRef),
      eq(agentAssignments.scope, input.scope),
      scopeId == null ? isNull(agentAssignments.scopeId) : eq(agentAssignments.scopeId, scopeId),
    ];
    const [existing] = await this.db.select().from(agentAssignments).where(and(...match)).limit(1);

    let row: typeof agentAssignments.$inferSelect | undefined;
    if (existing) {
      [row] = await this.db
        .update(agentAssignments)
        .set({ executionScope, role, updatedAt: now })
        .where(eq(agentAssignments.id, existing.id))
        .returning();
    } else {
      [row] = await this.db
        .insert(agentAssignments)
        .values({
          tenantId,
          agentKind: input.agentKind,
          agentRef: input.agentRef,
          scope: input.scope,
          scopeId,
          executionScope,
          role,
          updatedAt: now,
        })
        .returning();
    }
    await invalidateCached(this.env, cacheKey(tenantId, input.scope, scopeId));
    return toAssignment(row!);
  }

  /** Remove an assignment by id (tenant-scoped). Invalidates the scope cache. */
  async unassign(tenantId: number, id: string): Promise<boolean> {
    const [row] = await this.db
      .delete(agentAssignments)
      .where(and(eq(agentAssignments.id, id), eq(agentAssignments.tenantId, tenantId)))
      .returning();
    if (!row) return false;
    await invalidateCached(this.env, cacheKey(tenantId, row.scope, row.scopeId));
    return true;
  }
}

function toAssignment(row: typeof agentAssignments.$inferSelect): AgentAssignment {
  return {
    id: row.id,
    agentKind: row.agentKind,
    agentRef: row.agentRef,
    scope: row.scope as AssignmentScope,
    scopeId: row.scopeId,
    executionScope: row.executionScope as ExecutionScope,
    role: row.role,
  };
}
