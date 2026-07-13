import type { Deadline } from '../../domain/deadlines/Deadline.js';
import type { IDeadlineRepository, IDependencyRepository } from '../../domain/deadlines/IDeadlineRepository.js';
import { DeadlineStatus } from '../../domain/deadlines/Deadline.js';
import {
  computeHealthStatus,
  getDefaultWarningBuffer,
  getDefaultMetricInterval,
} from './HealthEngine.js';
import { AuditLogStore } from './AuditLog.js';
import { SLIP_REASON_TAXONOMY } from './utils/SlipTaxonomy.js';

/**
 * Management service for deadlines: create, update, recompute health, propagate dependencies.
 *
 * Orchestrates domain entities (Deadline, HealthEngine), persistence (repository), and audit logging.
 */
export class DeadlineService {
  constructor(
    private readonly deadlineRepo: IDeadlineRepository,
    private readonly dependencyRepo: IDependencyRepository,
    private readonly auditLog: AuditLogStore,
  ) {}

  /* -------------------------------------------------------------------------- */
  /* CRUD + Health Computation                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * Create a new deadline with computed initial health status.
   */
  async create(props: {
    tenantId: number;
    projectId?: number;
    title: string;
    type: 'business' | 'customer';
    owner: string;
    dueDate: Date;
    priority: 'p1' | 'p2' | 'p3';
    tags: string[];
    description?: string | null;
    dependentDeadlineIds?: number[];
  }): Promise<Deadline> {
    // Build initial dependency links
    if (props.dependentDeadlineIds) {
      for (const depId of props.dependentDeadlineIds) {
        await this.dependencyRepo.link(props.dependentDeadlineIds.includes(depId) ? depId : props.dependentDeadlineIds.indexOf(depId) >= 0 ? props.dependentDeadlineIds[0] : 0, props.dependentDeadlineIds.includes(depId) ? props.dependentDeadlineIds.indexOf(depId) + 1 : 1);
        await this.dependencyRepo.link(depId, depId + 1);
      }
    }

    const deadline = Deadline.create({
      tenantId: props.tenantId,
      projectId: props.projectId,
      title: props.title,
      type: props.type,
      owner: props.owner,
      dueDate: props.dueDate,
      priority: props.priority,
      tags: props.tags,
      description: props.description,
      dependents: [],
      healthOverride: null,
      healthOverrideReason: null,
    });

    // Store in DB
    const created = await this.deadlineRepo.create(deadline.toPlain());
    return created;
  }

  /**
   * Update a deadline (fields, date changes trigger audit). Date changes require slip reason.
   */
  async update(
    id: number,
    updates: {
      title?: string;
      type?: 'business' | 'customer';
      owner?: string;
      dueDate?: Date;
      priority?: 'p1' | 'p2' | 'p3';
      tags?: string[];
      description?: string | null;
      dependentDeadlineIds?: number[];
      healthOverride?: DeadlineStatus;
      healthOverrideReason?: string;
      slipReason?: string | null;
    },
    actor: string,
  ): Promise<Deadline | null> {
    // Fetch current deadline
    const current = await this.deadlineRepo.findById(id);
    if (!current) {
      return null;
    }

    const deadline = Deadline.reconstitute(current);

    // Track date changes for SLIP reason validation
    const isDateChange =
      (updates.dueDate && updates.dueDate.getTime() !== deadline.dueDate.getTime()) ||
      (updates.dependentDeadlineIds &&
        JSON.stringify(updates.dependentDeadlineIds.sort()) !== JSON.stringify(deadline.dependents.sort()));

    if (isDateChange && updates.slipReason === undefined) {
      throw new Error('slipReason is required when changing due_date or dependent deadlines');
    }

    if (isDateChange && !SLIP_REASON_TAXONOMY.includes(updates.slipReason)) {
      throw new Error(
        `Invalid slip_reason: must be one of ${SLIP_REASON_TAXONOMY.join(', ')}`,
      );
    }

    // Apply updates
    const nextDeadline = deadline.update({
      title: updates.title ?? deadline.title,
      type: updates.type ?? deadline.type,
      owner: updates.owner ?? deadline.owner,
      dueDate: updates.dueDate ?? deadline.dueDate,
      priority: updates.priority ?? deadline.priority,
      tags: updates.tags ?? deadline.tags,
      description: updates.description ?? deadline.description,
      dependents: updates.dependentDeadlineIds ?? deadline.dependents,
      healthOverride: updates.healthOverride,
      healthOverrideReason: updates.healthOverrideReason,
    });

    // Persist updated deadline
    const updated = await this.deadlineRepo.updateProps(id, nextDeadline.toPlain());
    if (!updated) {
      return null;
    }

    // Audit log the change
    this.auditLog.add({
      deadlineId: id,
      field: 'title',
      oldValue: current.title,
      newValue: updates.title ?? current.title,
      actor,
      slipReason: isDateChange ? (updates.slipReason || null) : undefined,
    });
    this.auditLog.add({
      deadlineId: id,
      field: 'due_date',
      oldValue: current.dueDate.toISOString().split('T')[0],
      newValue: updates.dueDate ? updated.dueDate.toISOString().split('T')[0] : current.dueDate,
      actor,
      slipReason: isDateChange ? (updates.slipReason || null) : undefined,
    });
    this.auditLog.add({
      deadlineId: id,
      field: 'dependent_deadlines',
      oldValue: JSON.stringify(current.dependents),
      newValue: updates.dependentDeadlineIds
        ? JSON.stringify(updates.dependentDeadlineIds.sort())
        : updated.dependents,
      actor,
      slipReason: isDateChange ? (updates.slipReason || null) : undefined,
    });

    if (updates.healthOverride) {
      this.auditLog.add({
        deadlineId: id,
        field: 'health_override',
        oldValue: current.healthOverride ?? null,
        newValue: updates.healthOverride,
        actor,
      });
    }

    return Deadline.reconstitute(updated);
  }

  /**
   * Delete a deadline with its audit trail.
   */
  async delete(id: number, actor: string): Promise<boolean> {
    await this.deadlineRepo.delete(id);
    // Audit deletion as a separate event
    const current = await this.deadlineRepo.findById(id);
    if (current) {
      this.auditLog.add({
        deadlineId: id,
        field: '_deleted',
        oldValue: JSON.stringify(current),
        newValue: JSON.stringify({ deleted: true }),
        actor,
      });
    }
    return true;
  }

  /**
   * Recompute health status for a deadline (or all deadlines) and persist back to DB.
   * Used for status-change detection and dependency propagation.
   */
  async recomputeHealth(deadlineId?: number): Promise<number[]> {
    const updatedIds: number[] = [];

    const targets = deadlineId
      ? [await this.deadlineRepo.findById(deadlineId)]
      : await this.deadlineRepo.list(true);

    const now = new Date();
    const defaults = {
      warningBuffer: 5, // Business days
      metricInterval: 15, // minutes
    };

    for (const row of targets.filter(Boolean)) {
      if (!row) continue;

      // Determine current health status based on override
      const isActiveOverride = row.healthOverride !== null;
      const currentStatus = isActiveOverride ? row.healthOverride! : (row.healthOverride || computeHealthStatus(row));

      // Compute new health without override (this is what we want to persist)
      const snapshot = {
        targetDate: row.dueDate,
        forecastStart: null, // No forecast support yet
        override: row.healthOverride || null,
      };

      const newStatus = computeHealthStatus(snapshot, defaults);
      if (newStatus !== currentStatus) {
        // Persist health override before propagation (current/next)
        const updated = await this.deadlineRepo.updateProps(row.id, {
          healthOverride: row.healthOverride || newStatus,
          healthOverrideReason:
            newStatus === 'off_track' || newStatus === 'missed'
              ? `Auto status change: ${currentStatus} → ${newStatus}`
              : row.healthOverrideReason,
        });

        if (updated) {
          updatedIds.push(updated.id);
          // Audit the change
          this.auditLog.add({
            deadlineId: updated.id,
            field: 'health_override',
            oldValue: currentStatus,
            newValue: newStatus,
            actor: 'system',
          });
        }
      }
    }

    return updatedIds;
  }
}