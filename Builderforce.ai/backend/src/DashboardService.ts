/**
 * Dashboard Service
 *
 * Provides API endpoints for dashboard metrics aggregation, including:
 * - Priority metrics query templates
 * - Filter queries for project, time period, and stakeholder
 * - Metrics summary query logic (sign-offs, conflicts, escalations)
 * - Dashboard DTO aggregation by project and time period
 *
 * Implements FR3.1, FR3.2, FR3.3
 */

import type {
  DashboardDTO,
  MetricsSummary,
  ProjectMetrics,
  DashboardFilters,
  PriorityMetricsType,
  SignOffMetricsType,
  ConflictMetricsType,
  EscalationMetricsType,
} from './definitions';

/**
 * Cache TTL for dashboard metrics (FR3.3)
 */
const CACHE_TTL_MS = 60_000; // 60 seconds

// Simple in-memory cache for performance
const cache = new Map<string, { data: DashboardDTO; timestamp: number }>();

/**
 * Get cached data if available and not expired
 */
function getCachedData(filterKey: string): DashboardDTO | null {
  const stored = cache.get(filterKey);
  if (!stored) return null;

  const age = Date.now() - stored.timestamp;
  if (age > CACHE_TTL_MS) {
    cache.delete(filterKey);
    return null;
  }

  return stored.data;
}

/**
 * Set cache entry
 */
function setCacheData(filterKey: string, data: DashboardDTO): void {
  cache.set(filterKey, { data, timestamp: Date.now() });
}

/**
 * Time period options for filtering (FR3.1)
 */
export type TimePeriod = 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_year' | 'custom';

/**
 * Compute date range based on time period (FR3.1)
 */
function getDateRange(timePeriod: TimePeriod): { start: Date; end: Date } {
  const now = new Date();
  const end = now;

  switch (timePeriod) {
    case 'last_7_days':
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end };
    case 'last_30_days':
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end };
    case 'last_90_days':
      return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end };
    case 'last_year':
      return { start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), end };
    case 'custom':
    default:
      throw new Error('Custom date range must be provided for custom time period');
  }
}

/**
 * Priority metrics query logic (FR3.3)
 */
export class PriorityMetricsQuery {
  /**
   * Calculate priority metrics filtered by project and time period
   */
  static async query(filters: DashboardFilters): Promise<PriorityMetricsType> {
    // In production, this would query actual priority tables:
    // SELECT priority_count, assigned_count, pending_review_count
    // FROM priorities
    // WHERE project_id IN (?) AND updated_at BETWEEN ? AND ?
    // GROUP BY project_id

    // Mock implementation for demo
    return {
      totalApproved: 47,
      pendingReview: 12,
      totalAssigned: 59,
    };
  }
}

/**
 * Sign-off metrics query logic (FR3.3)
 */
export class SignOffMetricsQuery {
  /**
   * Calculate sign-off metrics filtered by project and time period
   */
  static async query(filters: DashboardFilters): Promise<SignOffMetricsType> {
    // In production, this would query sign-off status and due dates:
    // SELECT status, COUNT(*) as count
    // FROM sign_offs
    // WHERE project_id IN (?) AND due_date BETWEEN ? AND ?
    // GROUP BY status

    // Mock implementation for demo
    const { timeRange } = filters;
    if (!timeRange) {
      const range = getDateRange(filters.timePeriod);
    }

    return {
      open: 23,
      pending: 14,
      overdue: 5,
      lastSignOffDate: '2025-06-15T14:30:00Z',
    };
  }
}

/**
 * Conflict metrics query logic (FR3.3)
 */
export class ConflictMetricsQuery {
  /**
   * Calculate conflict metrics filtered by project and time period
   */
  static async query(filters: DashboardFilters): Promise<ConflictMetricsType> {
    // In production, this would query conflict detection rules and active conflicts
    // SELECT COUNT(*) as active, COUNT(*) FILTER (WHERE created_at >= start_of_week()) as this_week
    // FROM conflicts
    // WHERE project_id IN (?) AND created_at BETWEEN ? AND ?
    // GROUP BY type

    // Mock implementation for demo
    return {
      active: 8,
      thisWeek: 3,
      types: ['Priority Conflict', 'Resource Allocation', 'Stakeholder Disagreement'],
    };
  }
}

/**
 * Escalation metrics query logic (FR3.3)
 */
export class EscalationMetricsQuery {
  /**
   * Calculate escalation metrics filtered by project and time period
   */
  static async query(filters: DashboardFilters): Promise<EscalationMetricsType> {
    // In production, this would query escalation status and dates:
    // SELECT status, COUNT(*) as count
    // FROM escalations
    // WHERE project_id IN (?) AND created_at BETWEEN ? AND ?
    // GROUP BY status

    // Mock implementation for demo
    const { timeRange } = filters;
    if (!timeRange) {
      const range = getDateRange(filters.timePeriod);
    }

    return {
      overdue: 2,
      pending: 4,
      thisMonth: 6,
    };
  }
}

/**
 * Aggregate metrics by project (FR3.2)
 */
class ProjectMetricsAggregator {
  static async aggregate(
    filters: DashboardFilters
  ): Promise<ProjectMetrics[]> {
    // In production, this would query individual project metrics:
    // SELECT project_id, project_name,
    //        SUM(total_approved) as total_approved,
    //        SUM(pending_review) as pending_review,
    //        SUM(total_assigned) as total_assigned,
    //        SUM(open_sign_offs) as open_sign_offs,
    //        SUM(pending_sign_offs) as pending_sign_offs,
    //        SUM(overdue_sign_offs) as overdue_sign_offs,
    //        SUM(active_conflicts) as active_conflicts,
    //        SUM(overdue_escalations) as overdue_escalations
    // FROM project_metrics
    // WHERE updated_at BETWEEN ? AND ?
    // GROUP BY project_id

    // Mock project data for demo
    return [
      {
        projectId: 'proj_001',
        projectName: 'Customer Experience Platform',
        priorityMetrics: {
          totalApproved: 12,
          pendingReview: 3,
          totalAssigned: 15,
        },
        signOffMetrics: {
          open: 5,
          pending: 7,
          overdue: 1,
          lastSignOffDate: '2025-06-12T10:20:00Z',
        },
        conflictMetrics: {
          active: 2,
          thisWeek: 1,
          types: ['Priority Conflict'],
        },
        escalationMetrics: {
          overdue: 0,
          pending: 2,
          thisMonth: 3,
        },
      },
      {
        projectId: 'proj_002',
        projectName: 'AI Agent Training',
        priorityMetrics: {
          totalApproved: 18,
          pendingReview: 4,
          totalAssigned: 22,
        },
        signOffMetrics: {
          open: 8,
          pending: 5,
          overdue: 2,
          lastSignOffDate: '2025-06-14T16:45:00Z',
        },
        conflictMetrics: {
          active: 3,
          thisWeek: 2,
          types: ['Resource Allocation', 'Stakeholder Disagreement'],
        },
        escalationMetrics: {
          overdue: 1,
          pending: 1,
          thisMonth: 4,
        },
      },
      {
        projectId: 'proj_003',
        projectName: 'Performance Dashboard',
        priorityMetrics: {
          totalApproved: 17,
          pendingReview: 5,
          totalAssigned: 22,
        },
        signOffMetrics: {
          open: 10,
          pending: 2,
          overdue: 2,
          lastSignOffDate: '2025-06-11T09:15:00Z',
        },
        conflictMetrics: {
          active: 3,
          thisWeek: 0,
          types: ['Stakeholder Disagreement'],
        },
        escalationMetrics: {
          overdue: 1,
          pending: 1,
          thisMonth: -1, // negative means no new this month
        },
      },
    ];
  }
}

/**
 * Main dashboard API endpoint - returns aggregated metrics (FR3.2)
 */
export class DashboardService {
  /**
   * Get dashboard metrics with caching and filtering
   */
  static async getDashboardMetrics(
    filters: DashboardFilters
  ): Promise<DashboardDTO> {
    const filterKey = this.getFilterKey(filters);

    // Check cache first (FR3.3)
    const cached = getCachedData(filterKey);
    if (cached) {
      return cached;
    }

    // Compute summary metrics
    const [priorityMetrics, signOffMetrics, conflictMetrics, escalationMetrics] =
      await Promise.all([
        PriorityMetricsQuery.query(filters),
        SignOffMetricsQuery.query(filters),
        ConflictMetricsQuery.query(filters),
        EscalationMetricsQuery.query(filters),
      ]);

    const summary: MetricsSummary = {
      totalApprovedPriorities: priorityMetrics.totalApproved,
      openSignOffs: signOffMetrics.open,
      pendingSignOffs: signOffMetrics.pending,
      overdueSignOffs: signOffMetrics.overdue,
      activeConflicts: conflictMetrics.active,
      overdueEscalations: escalationMetrics.overdue,
      lastUpdated: new Date().toISOString(),
    };

    const projects = await ProjectMetricsAggregator.aggregate(filters);

    const result: DashboardDTO = {
      summary,
      projects,
    };

    // Cache result (FR3.3)
    setCacheData(filterKey, result);

    return result;
  }

  /**
   * Get filter key for caching
   */
  private static getFilterKey(filters: DashboardFilters): string {
    return JSON.stringify({
      projectIds: filters.projectIds,
      timePeriod: filters.timePeriod,
      stakeholderIds: filters.stakeholderIds,
    });
  }

  /**
   * Invalidate dashboard cache
   */
  static invalidateCache(filterKey?: string): void {
    if (!filterKey) {
      cache.clear();
    } else {
      cache.delete(filterKey);
    }
  }
}