import { db } from '../database/schema';
import type { IDeadlineRepository } from '../../domain/deadlines/IDeadlineRepository';
import type { DeadlineCreate, DeadlineProps, DeadlineUpdate } from '../../domain/deadlines/Deadline';
import { Deadline } from '../../domain/deadlines/Deadline';
import { isValidSlipReason } from '../../application/deadlines/utils/SlipTaxonomy';
import type { SlipReason } from '../../application/deadlines/utils/SlipTaxonomy';
import type { AuditLogStore } from '../../application/deadlines/AuditLog';

//
// ---- Row shape as stored in the DB ----
//
interface DeadlineRow {
  id: number;
  title: string;
  type: string;
  owner_id: string;
  project_id: number | null;
  description: string | null;
  due_date: string; // ISO
  forecast_date: string | null;
  tags: string[] | null;
  priority: string;
  health_status: string;
  health_override: string | null;
  health_override_reason: string | null;
  dependents: number[] | null;
  completed: boolean | null;
  completed_at: string | null;
  slip_count: number;
  last_slip_reason: string | null;
  created_at: string;
  updated_at: string;
}

//
// ---- Helpers ----
//

const rowToProps = (r: DeadlineRow): DeadlineProps => ({
  id: r.id,
  title: r.title,
  type: r.type as DeadlineProps['type'],
  ownerId: r.owner_id,
  projectId: r.project_id ?? null,
  description: r.description ?? null,
  dueDate: new Date(r.due_date),
  forecastDate: r.forecast_date ? new Date(r.forecast_date) : null,
  tags: r.tags ?? [],
  priority: r.priority as DeadlineProps['priority'],
  healthStatus: r.health_status as DeadlineProps['healthStatus'],
  healthOverride: (r.health_override as DeadlineProps['healthOverride']) ?? null,
  healthOverrideReason: r.health_override_reason ?? null,
  dependents: r.dependents ?? [],
  completed: r.completed ?? null,
  completedAt: r.completed_at ? new Date(r.completed_at) : null,
  slipCount: r.slip_count,
  lastSlipReason: isValidSlipReason(r.last_slip_reason ?? '')
    ? (r.last_slip_reason as SlipReason)
    : null,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

export class DeadlineRepository implements IDeadlineRepository {
  private readonly audit: AuditLogStore;

  constructor(auditLog: AuditLogStore) {
    this.audit = auditLog;
  }

  // ---- Query helpers (Drizzle) ----

  private deadlineTable() {
    return db.deadlines;
  }

  private deadlinesDependenciesTable() {
    return db.deadlinesDependencies;
  }

  // ---- IDeadlineRepository ----

  async create(input: DeadlineCreate): Promise<number> {
    const [row] = await db
      .insert(this.deadlineTable())
      .values({
        title: input.title,
        type: input.type,
        owner_id: input.ownerId,
        project_id: input.projectId ?? null,
        description: input.description ?? null,
        due_date: new Date(input.dueDate).toISOString(),
        forecast_date: input.forecastDate
          ? new Date(input.forecastDate).toISOString()
          : null,
        tags: input.tags ?? [],
        priority: input.priority ?? 'P2',
        health_status: 'on_track',
      })
      .returning({ id: this.deadlineTable().id });

    const deadlineId = row!.id;

    this.audit.add({
      deadlineId,
      field: 'created',
      oldValue: null,
      newValue: input.title,
      actor: input.ownerId,
    });

    return deadlineId;
  }

  async findById(id: number): Promise<Deadline | undefined> {
    const rows = await db
      .select()
      .from(this.deadlineTable())
      .where(eq(this.deadlineTable().id, BigInt(id)));

    if (rows.length === 0) return undefined;
    return Deadline.from(rowToProps(rows[0]! as unknown as DeadlineRow));
  }

  async updateProps(
    id: number,
    patch: Partial<DeadlineUpdate & { dueDate?: string }>,
    actor: string,
  ): Promise<Deadline> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Deadline ${id} not found`);

    // Build a partial update map for the DB, keyed by snake_case column names
    const set: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      this.audit.add({
        deadlineId: id,
        field: 'title',
        oldValue: existing.title,
        newValue: patch.title,
        actor,
      });
      set.title = patch.title;
    }

    if (patch.type !== undefined) {
      this.audit.add({
        deadlineId: id,
        field: 'type',
        oldValue: existing.type,
        newValue: patch.type,
        actor,
      });
      set.type = patch.type;
    }

    if (patch.ownerId !== undefined) {
      this.audit.add({
        deadlineId: id,
        field: 'ownerId',
        oldValue: existing.ownerId,
        newValue: patch.ownerId,
        actor,
      });
      set.owner_id = patch.ownerId;
    }

    if (patch.dueDate !== undefined) {
      const prevDate = existing.dueDate.toISOString();
      const nextDate = new Date(patch.dueDate).toISOString();

      this.audit.add({
        deadlineId: id,
        field: 'dueDate',
        oldValue: prevDate,
        newValue: nextDate,
        actor,
        slipReason: (patch as any).slipReason ?? undefined,
      });
      set.due_date = nextDate;
    }

    if (patch.description !== undefined) {
      set.description = patch.description;
    }

    if (patch.priority !== undefined) {
      set.priority = patch.priority;
    }

    if (patch.tags !== undefined) {
      set.tags = patch.tags;
    }

    if (patch.forecastDate !== undefined) {
      set.forecast_date = patch.forecastDate
        ? new Date(patch.forecastDate).toISOString()
        : null;
    }

    if (patch.completed !== undefined) {
      set.completed = patch.completed;
      if (patch.completed) {
        set.completed_at = new Date().toISOString();
        set.health_status = 'on_track';
      }
    }

    if (patch.healthOverride !== undefined) {
      set.health_override = patch.healthOverride;
    }

    if (patch.healthOverrideReason !== undefined) {
      this.audit.add({
        deadlineId: id,
        field: 'health_override_reason',
        oldValue: existing.healthOverrideReason ?? null,
        newValue: patch.healthOverrideReason,
        actor,
      });
      set.health_override_reason = patch.healthOverrideReason;
    }

    if (Object.keys(set).length > 0) {
      set.updated_at = new Date().toISOString();
      await db
        .update(this.deadlineTable())
        .set(set as any)
        .where(eq(this.deadlineTable().id, BigInt(id)));
    }

    // Refresh and return
    return (await this.findById(id))!;
  }

  async findAll(filters: {
    type?: string;
    status?: string;
    ownerId?: string;
    projectId?: number;
    tag?: string;
    priority?: string;
    search?: string;
    page: number;
    limit: number;
    sort: string;
    order: 'asc' | 'desc';
  }): Promise<{ data: Deadline[]; total: number }> {
    // Build a filter clause; in a real impl this would be Drizzle conditions
    const conditions: any[] = [];
    if (filters.type) conditions.push(eq(this.deadlineTable().type, filters.type));
    if (filters.status)
      conditions.push(eq(this.deadlineTable().health_status, filters.status));
    if (filters.ownerId)
      conditions.push(eq(this.deadlineTable().owner_id, filters.ownerId));
    if (filters.projectId !== undefined)
      conditions.push(
        eq(this.deadlineTable().project_id, BigInt(filters.projectId)),
      );
    if (filters.priority)
      conditions.push(eq(this.deadlineTable().priority, filters.priority));

    const baseQuery = db
      .select()
      .from(this.deadlineTable())
      .where(and(...conditions));

    const countRes = await db
      .select({ cnt: count() })
      .from(this.deadlineTable())
      .where(and(...conditions));

    const total = Number(countRes[0]?.cnt ?? 0);

    const rawRows = await baseQuery
      .orderBy(
        filters.order === 'desc'
          ? desc(this.deadlineTable()[filters.sort as keyof typeof this.deadlineTable])
          : asc(this.deadlineTable()[filters.sort as keyof typeof this.deadlineTable]),
      )
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);

    const data = rawRows.map((r) =>
      Deadline.from(rowToProps(r as unknown as DeadlineRow)),
    );

    return { data, total };
  }

  async delete(id: number): Promise<void> {
    // Remove dependency edges first
    await db
      .delete(this.deadlinesDependenciesTable())
      .where(eq(this.deadlinesDependenciesTable().deadline_id, BigInt(id)));
    await db
      .delete(this.deadlinesDependenciesTable())
      .where(eq(this.deadlinesDependenciesTable().dependency_id, BigInt(id)));

    await db
      .delete(this.deadlineTable())
      .where(eq(this.deadlineTable().id, BigInt(id)));
  }

  async getDependencies(
    id: number,
  ): Promise<Array<{ id: number; title: string }>> {
    const rows = await db
      .select({
        id: this.deadlineTable().id,
        title: this.deadlineTable().title,
      })
      .from(this.deadlinesDependenciesTable())
      .innerJoin(
        this.deadlineTable(),
        eq(
          this.deadlinesDependenciesTable().dependency_id,
          this.deadlineTable().id,
        ),
      )
      .where(eq(this.deadlinesDependenciesTable().deadline_id, BigInt(id)));

    return rows.map((r) => ({ id: Number(r.id), title: r.title }));
  }

  async getDependents(
    id: number,
  ): Promise<Array<{ id: number; title: string }>> {
    const rows = await db
      .select({
        id: this.deadlineTable().id,
        title: this.deadlineTable().title,
      })
      .from(this.deadlinesDependenciesTable())
      .innerJoin(
        this.deadlineTable(),
        eq(
          this.deadlinesDependenciesTable().deadline_id,
          this.deadlineTable().id,
        ),
      )
      .where(eq(this.deadlinesDependenciesTable().dependency_id, BigInt(id)));

    return rows.map((r) => ({ id: Number(r.id), title: r.title }));
  }

  async addDependency(id: number, dependencyId: number): Promise<void> {
    if (id === dependencyId) {
      throw new Error(
        `Circular dependency: deadline ${id} cannot depend on itself`,
      );
    }

    // Cycle check — walk upstream from dependencyId; if we hit `id`, it's a cycle
    const walk = async (current: number, visited: Set<number>): Promise<void> => {
      if (visited.has(current)) return; // already visited — no cycle
      visited.add(current);
      const deps = await this.getDependencies(current);
      for (const d of deps) {
        if (d.id === id) {
          throw new Error(
            `Circular dependency detected: ${id} ← ${dependencyId} ← … ← ${d.id}`,
          );
        }
        await walk(d.id, visited);
      }
    };

    await walk(dependencyId, new Set());

    await db.insert(this.deadlinesDependenciesTable()).values({
      deadline_id: BigInt(id),
      dependency_id: BigInt(dependencyId),
    });
  }

  async removeDependency(id: number, dependencyId: number): Promise<void> {
    await db
      .delete(this.deadlinesDependenciesTable())
      .where(
        and(
          eq(this.deadlinesDependenciesTable().deadline_id, BigInt(id)),
          eq(
            this.deadlinesDependenciesTable().dependency_id,
            BigInt(dependencyId),
          ),
        ),
      );
  }

  async count(filters: {
    type?: string;
    status?: string;
    ownerId?: string;
    projectId?: number;
    tag?: string;
    priority?: string;
  }): Promise<number> {
    const conditions: any[] = [];
    if (filters.type) conditions.push(eq(this.deadlineTable().type, filters.type));
    if (filters.status)
      conditions.push(eq(this.deadlineTable().health_status, filters.status));
    if (filters.ownerId)
      conditions.push(eq(this.deadlineTable().owner_id, filters.ownerId));
    if (filters.projectId !== undefined)
      conditions.push(
        eq(this.deadlineTable().project_id, BigInt(filters.projectId)),
      );
    if (filters.priority)
      conditions.push(eq(this.deadlineTable().priority, filters.priority));

    const res = await db
      .select({ cnt: count() })
      .from(this.deadlineTable())
      .where(and(...conditions));

    return Number(res[0]?.cnt ?? 0);
  }
}

// ---- Re-export Drizzle helpers used by this file ----
// These are already available in the `db` import context via Drizzle ORM,
// but we import them explicitly for clarity.
import { eq, and, desc, asc, count } from 'drizzle-orm';
