import { and, asc, eq, desc, inArray, or, sql } from 'drizzle-orm';
import { IDeadlineRepository } from '../../domain/deadlines/IDeadlineRepository';
import {
  Deadline,
  DeadlineProps,
  DeadlineStatus,
  SlipReason,
} from '../../domain/deadlines/Deadline.js';
import { tenantId, asTenantId } from '../../domain/shared/types.js';
import {
  deadlines as deadlinesTable,
  deadlineDependencies as deadlineDependenciesTable,
} from '../database/deadlineSchema.js';
import type { Db } from '../database/connection.js';
import { success, mapOptional } from '../../application/deadlines/utils/SlipTaxonomy.js';

/**
 * Drizzle row type for deadlines.
 */
type DeadlineRow = typeof deadlinesTable.$inferSelect;

/**
 * Drizzle row type for deadline dependencies.
 */
type DeadlineDependencyRow = typeof deadlineDependenciesTable.$inferSelect;

/**
 * Drizzle row type for deadline audit.
 */
type DeadlineAuditRow = typeof deadlineAudit.$inferSelect;
type DeadlineAuditRowWithId = typeof deadlineAudit.$inferSelect & {
  id: number;
};

/**
 * Result type returned by repository APIs.
 */
export interface DeadlineResult {
  id: number;
  readonly tenantId: number;
  projectId?: number;
  title: string;
  type: 'business' | 'customer';
  owner: string;
  dueDate: Date;
  priority: DeadlineProps['priority'];
  tags: string[];
  description: string | null;
  dependents: number[];
  healthOverride?: DeadlineStatus | null;
  healthOverrideReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Postgres-backed deadline repository.
 *
 * Infrastructure-only: translates between Drizzle rows and Outcome domain.
 * Business logic (health computation, dependencies, slips) lives in the service.
 */
export class DeadlineRepository implements IDeadlineRepository {
  constructor(private readonly db: Db) {}

  /* -------------------------------------------------------------------------- */
  /* Deadline CRUD (fetching + creation+update+delete)                         */
  /* -------------------------------------------------------------------------- */

  async create(props: DeadlineProps): Promise<Deadline> {
    const data: Omit<DeadlineRow, 'id'> = {
      tenantId: Number(props.tenantId),
      projectId: props.projectId ? Number(props.projectId) : null,
      title: props.title,
      type: props.type,
      owner: props.owner,
      dueDate: props.dueDate,
      priority: props.priority ?? 'p3',
      tags: props.tags,
      description: props.description ?? null,
      dependents: props.dependents ?? null,
      healthOverride: props.healthOverride ?? null,
      healthOverrideReason: props.healthOverrideReason ?? null,
      // createdAt/updatedAt handled by DB; createdAt on domain is set here for the value
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const rows = await this.db.insert(deadlinesTable).values(data).returning();

    if (rows.length === 0) {
      throw new Error('DeadlineRepository.create() returned no rows');
    }

    const row = rows[0];
    return Deadline.reconstitute({
      id: row.id,
      tenantId: Number(row.tenantId),
      projectId: row.projectId,
      title: row.title,
      type: row.type,
      owner: row.owner,
      dueDate: row.dueDate,
      priority: row.priority,
      tags: row.tags,
      description: row.description,
      dependents: row.dependents ? row.dependents.map(Number) : null,
      healthOverride: row.healthOverride,
      healthOverrideReason: row.healthOverrideReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async findById(id: number): Promise<DeadlineResult | null> {
    const [row] = await this.db
      .select()
      .from(deadlinesTable)
      .where(eq(deadlinesTable.id, Number(id)))
      .limit(1);

    return row ? toDeadlineResult(row) : null;
  }

  async findByProjectId(projectId: number): Promise<DeadlineResult[]> {
    const rows = await this.db
      .select()
      .from(deadlinesTable)
      .where(eq(deadlinesTable.projectId, Number(projectId)));

    return rows.map(toDeadlineResult);
  }

  async findByTenantId(tenantId: number): Promise<DeadlineResult[]> {
    const rows = await this.db
      .select()
      .from(deadlinesTable)
      .where(eq(deadlinesTable.tenantId, Number(tenantId)));

    return rows.map(toDeadlineResult);
  }

  async list(activeOnly: boolean = false): Promise<DeadlineResult[]> {
    const conditions = activeOnly
      ? or(
          eq(deadlinesTable.healthOverride, 'on_track'),
          eq(deadlinesTable.healthOverride, 'at_risk'),
          eq(deadlinesTable.healthOverride, 'off_track'),
          eq(deadlinesTable.healthOverride, 'missed')
        )
      : [];

    const rows = await this.db
      .select()
      .from(deadlinesTable)
      .where(conditions.length > 0 ? conditions : undefined);

    return rows.map(toDeadlineResult);
  }

  updateProps(deadlineId: number, updates: Partial<DeadlineProps>): Promise<DeadlineResult | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Treat gameId as required; if provided we merge it.
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.type !== undefined) updateData.type = updates.type;
    if (updates.owner !== undefined) updateData.owner = updates.owner;
    if (updates.dueDate !== undefined) updateData.dueDate = updates.dueDate;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.tags !== undefined) updateData.tags = updates.tags;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.dependents !== undefined) updateData.dependents = updates.dependents;

    if (updates.healthOverride !== undefined) updateData.healthOverride = updates.healthOverride;
    if (updates.healthOverrideReason !== undefined) updateData.healthOverrideReason = updates.healthOverrideReason;

    const [updated] = await this.db
      .update(deadlinesTable)
      .set(updateData)
      .where(eq(deadlinesTable.id, Number(deadlineId)))
      .returning();

    return updated ? toDeadlineResult(updated) : null;
  }

  delete(id: number): Promise<boolean> {
    return this.db
      .delete(deadlinesTable)
      .where(eq(deadlinesTable.id, Number(id)))
      .then(() => true)
      .catch(() => false);
  }

  /* -------------------------------------------------------------------------- */
  /* Dependency edges                                                               */
  /* -------------------------------------------------------------------------- */

  async findDependencies(deadlineId: number): Promise<number[]> {
    const rows = await this.db
      .select()
      .from(deadlineDependenciesTable)
      .having(eq(deadlineDependenciesTable.fromDeadlineId, Number(deadlineId)));

    return rows.map((row) => Number(row.toDeadlineId));
  }

  async findDependents(deadlineId: number): Promise<number[]> {
    const rows = await this.db
      .select()
      .from(deadlineDependenciesTable)
      .having(eq(deadlineDependenciesTable.toDeadlineId, Number(deadlineId)));

    return rows.map((row) => Number(row.fromDeadlineId));
  }

  async link(fromDeadlineId: number, toDeadlineId: number): Promise<void> {
    // Use SQL's ON CONFLICT to prevent duplicates but keep the creation timestamp.
    await this.db
      .insert(deadlineDependenciesTable)
      .values({
        fromDeadlineId: Number(fromDeadlineId),
        toDeadlineId: Number(toDeadlineId),
      })
      .onConflictDoNothing();
  }

  async unlink(deadlineId: number, dependentId: number): Promise<void> {
    await this.db
      .delete(deadlineDependenciesTable)
      .where(
        and(
          eq(deadlineDependenciesTable.fromDeadlineId, Number(deadlineId)),
          eq(deadlineDependenciesTable.toDeadlineId, Number(dependentId))
        )
      );
  }
}

/* --------------------------------------------------------------------------- */
/* Helpers                                                                        */
/* --------------------------------------------------------------------------- */

/**
 * Convert a Drizzle row in deadlinesTable to domain DTO.
 */
function toDeadlineResult(row: DeadlineRow): DeadlineResult {
  return {
    id: row.id,
    tenantId: Number(row.tenantId),
    projectId: row.projectId,
    title: row.title,
    type: row.type,
    owner: row.owner,
    dueDate: row.dueDate,
    priority: row.priority,
    tags: row.tags,
    description: row.description ?? null,
    dependents: row.dependents ? row.dependents.map(Number) : [],
    healthOverride: row.healthOverride,
    healthOverrideReason: row.healthOverrideReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}