import type { DeadlineRepository } from '../../infrastructure/repositories/DeadlineRepository.js';
import { SLIP_REASON_TAXONOMY } from './utils/SlipTaxonomy.js';

/**
 * Export utilities for deadlines (FR-8 Reporting & Export).
 * Generates Deadline Health Report for embeddable widget / PDF / CSV.
 */
export class DeadlineExport {
  constructor(
    private readonly deadlineRepo: DeadlineRepository,
  ) {}

  /**
   * Build deadline health report for the given filters.
   *
   * @param filters - optional filters (type, project, status, owner, date range)
   * @returns CSV row array suitable for client export (includes header)
   */
  async exportReport(filters?: {
    type?: 'business' | 'customer';
    projectId?: number;
    status?: 'on_track' | 'at_risk' | 'off_track' | 'missed';
    owner?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<[string[], string[][]]> {
    // Determine which deadlines to export based on filters
    // NOTE: timeline support for date-range filters is reserved for future queries
    // (fetching all then filtering client-side to avoid open-ended date query stubs)
    let rows = await this.deadlineRepo.list(false);

    if (filters?.type) {
      rows = rows.filter((r) => r.type === filters.type);
    }
    if (filters?.status) {
      rows = rows.filter((r) => r.healthOverride === filters.status);
    }
    if (filters?.owner) {
      rows = rows.filter((r) => r.owner === filters.owner);
    }
    if (filters?.projectId) {
      rows = rows.filter((r) => r.projectId === filters.projectId);
    }

    // Optionally filter by reference date range once explicit schema exists
    if (filters?.startDate || filters?.endDate) {
      const start = filters.startDate;
      const end = filters.endDate;
      rows = rows.filter((r) => {
        if (start && r.dueDate < start) return false;
        if (end && r.dueDate > end) return false;
        return true;
      });
    }

    const status = (row: { healthOverride: string | null }) => row.healthOverride || 'on_track';

    // Build CSV header
    const header = [
      'ID',
      'Tenant ID',
      'Project ID',
      'Legal Title',
      'Type (Business/Customer)',
      'Due Date',
      'Priority (P1/P2/P3)',
      'Owner',
      'Status',
      'Health Override (none/on_track/at_risk/off_track/missed)',
      'Health Override Reason',
      'Departments/Taxonomy Tags',
      'Description',
      'Dependent Deadlines (comma-separated IDs)',
      'Created At',
      'Updated At',
    ];

    // Build CSV content
    const content = rows.map((row) => [
      row.id,
      row.tenantId,
      row.projectId || '',
      row.title,
      row.type,
      row.dueDate.toISOString().split('T')[0] || '',
      row.priority,
      row.owner,
      status(row),
      row.healthOverride || 'none',
      row.healthOverrideReason || '',
      row.tags.join('; ') || row.tags.join(','),
      row.description || '',
      row.dependents.join(',') || '',
      row.createdAt.toISOString().split('T')[0] + 'T' + row.createdAt.toISOString().split('T')[1]?.slice(0, -1) || '',
      row.updatedAt.toISOString().split('T')[0] + 'T' + row.updatedAt.toISOString().split('T')[1]?.slice(0, -1) || '',
    ]);

    return [header, ...content];
  }

  /**
   * Build an embeddable status widget view for executive dashboards.
   * Returns a simple JSON summary map; actual widget HTML/iframe is a front-end concern.
   */
  async getStatusWidget(tenantId: number): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    atRiskDeadlines: Array<{
      id: number;
      title: string;
      dueDate: Date;
      owner: string;
      priority: DeadlinePriority;
    }>;
  }> {
    const allDeadlines = await this.deadlineRepo.findByTenantId(tenantId);
    if (!allDeadlines.length) {
      return {
        total: 0,
        byStatus: {},
        byType: {},
        atRiskDeadlines: [],
      };
    }

    function aggregate(
      items: typeof allDeadlines,
      keyFn: (item: typeof allDeadlines[0]) => string,
    ) {
      const map = new Map<string, number>();
      for (const item of items) {
        const key = keyFn(item);
        map.set(key, (map.get(key) || 0) + 1);
      }
      return Object.fromEntries(map.entries()) as Record<string, number>;
    }

    return {
      total: allDeadlines.length,
      byStatus: aggregate(allDeadlines, (r) => r.healthOverride || 'on_track'),
      byType: aggregate(allDeadlines, (r) => r.type),
      atRiskDeadlines: allDeadlines
        .filter((r) => r.healthOverride === 'at_risk')
        .map((r) => ({
          id: r.id,
          title: r.title,
          dueDate: r.dueDate,
          owner: r.owner,
          priority: r.priority as 'p1' | 'p2' | 'p3',
        })),
    };
  }

  /**
   * Get summary statistics for executive dashboards (FR-5 Executive Summary View).
   */
  async getExecutiveSummary(tenantId: number): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    trendSparklines: { days: number; onTrack: number; atRisk: number; offTrack: number; missed: number; buffer: number };
  }> {
    const allDeadlines = await this.deadlineRepo.findByTenantId(tenantId);

    function aggregate(items: typeof allDeadlines, keyFn: (item: typeof allDeadlines[0]) => string) {
      const map = new Map<string, number>();
      for (const item of items) {
        const key = keyFn(item);
        map.set(key, (map.get(key) || 0) + 1);
      }
      return Object.fromEntries(map.entries());
    }

    return {
      total: allDeadlines.length,
      byStatus: aggregate(allDeadlines, (r) => r.healthOverride || 'on_track'),
      byType: aggregate(allDeadlines, (r) => r.type),
      trendSparklines: { days: 90, onTrack: 0, atRisk: 0, offTrack: 0, missed: 0, buffer: 0 },
    };
  }
}

// Basic type refs for compile-time consistency
type DeadlinePriority = 'p1' | 'p2' | 'p3';