import type { Deadline } from '../../domain/deadlines/Deadline.js';
import type { DeadlineRepository } from '../../infrastructure/repositories/DeadlineRepository.js';
import { DeadlineStatus } from '../../domain/deadlines/Deadline.js';

/**
 * Deadline Presenter.
 * - aggregates deadline counts and health snapshots for dashboards
 * - supports filters by type, owner, status, priority, tenant; date-range filter reserved for future queries
 * - fetches lifecycle/dependency history for detail views
 */
export class DeadlinePresenter {
  constructor(private readonly deadlineRepo: DeadlineRepository) {}

  /**
   * Build deadline health report for the given filters.
   * Returns JSON grouped by type and status (Executive Summary View, FR-5.1).
   */
  async getDashboardSummary(filters: {
    tenantId: number;
    type?: 'business' | 'customer';
    owner?: string;
    status?: 'on_track' | 'at_risk' | 'off_track' | 'missed';
    priority?: 'p1' | 'p2' | 'p3';
    projectId?: number;
    weekendOnly?: boolean;
  }): Promise<{
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byOwner: Record<string, number>;
    byPriority: Record<string, number>;
    topAtRisk: Array<Pick<Deadline, 'id' | 'title' | 'dueDate' | 'owner' | 'projectId' | 'priority' | 'type'>>;
    atRiskCount: number;
    missedCount: number;
    onTrackCount: number;
    offTrackCount: number;
  }> {
    // Fetch deadlines without filtering on date-range or SLA dashboard queries
    let rows = await this.deadlineRepo.list(false);

    if (filters.tenantId) {
      rows = rows.filter((r) => r.tenantId === filters.tenantId);
    }
    if (filters.type) {
      rows = rows.filter((r) => r.type === filters.type);
    }
    if (filters.owner) {
      rows = rows.filter((r) => r.owner === filters.owner);
    }
    if (filters.status) {
      rows = rows.filter((r) => r.healthOverride === filters.status);
    }
    if (filters.priority) {
      rows = rows.filter((r) => r.priority === filters.priority);
    }
    if (filters.projectId) {
      rows = rows.filter((r) => r.projectId === filters.projectId);
    }

    // Date range filtering placeholder: future code when DDL designates a dateRange optional column
    if (filters.weekendOnly) {
      rows = rows.filter((r) => r.dueDate.getDay() === 0 || r.dueDate.getDay() === 6);
    }

    const status = (row: { healthOverride: string | null }) => row.healthOverride || 'on_track';

    // Aggregates
    const byType = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const byOwner = new Map<string, number>();
    const byPriority = new Map<string, number>();

    for (const row of rows) {
      byType.set(row.type, (byType.get(row.type) ?? 0) + 1);
      byStatus.set(status(row), (byStatus.get(status(row)) ?? 0) + 1);
      byOwner.set(row.owner || 'Unknown', (byOwner.get(row.owner || 'Unknown') ?? 0) + 1);
      byPriority.set(row.priority, (byPriority.get(row.priority) ?? 0) + 1);
    }

    const topAtRisk = rows
      .filter((r) => status(r) === 'at_risk')
      .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime())
      .slice(0, 10);

    // Return counts as numbers, keys as strings
    return {
      total: rows.length,
      byType: Object.fromEntries(byType.entries()),
      byStatus: Object.fromEntries(byStatus.entries()),
      byOwner: Object.fromEntries(byOwner.entries()),
      byPriority: Object.fromEntries(byPriority.entries()),
      topAtRisk: topAtRisk.slice(0, 10).map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: r.dueDate,
        owner: r.owner || 'Unknown',
        projectId: r.projectId,
        priority: r.priority,
        type: r.type,
      })),
      atRiskCount: (byStatus.get('at_risk') ?? 0) as number,
      missedCount: (byStatus.get('missed') ?? 0) as number,
      onTrackCount: (byStatus.get('on_track') ?? 0) as number,
      offTrackCount: (byStatus.get('off_track') ?? 0) as number,
    };
  }

  /**
   * Get a deadline’s lifecycle and dependency history for the deadline detail view.
   * Returns dependency graph and audit events (FR-5.3).
   */
  async getDeadlineDetail(id: number): Promise<{
    deadline: | Deadline
      | undefined;
    dependencies: Array<{ id: number; upstream: number | null; downstream: number | null; weight: number | null }>;
    audit: Array<{
      deadlineId: number;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      actor: string;
      slipReason: string | null;
      timestamp: Date;
    }>;
  }> {
    const deadline = await this.deadlineRepo.findById(id);
    if (!deadline) {
      throw new Error(`Deadline ${id} not found`);
    }

    // Get dependencies
    const dependencies = await this.deadlineRepo.listDependencies(id);

    // Get tenant-scoped audit trail
    const audit = await this.deadlineRepo.findAuditByTenantId(deadline.tenantId);

    return {
      deadline,
      dependencies,
      audit,
    };
  }
}