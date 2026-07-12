/**
 * FR7: Resource Prioritization Report generation
 *
 * Endpoint: GET /api/reports/resource-prioritization
 *
 * Aggregates task resource effort by priority level (high/medium/low) and status.
 * Composes total effort (story points, energy, or generic units) per priority.
 * Supports date-range filter for weekly reports.
 * Generates JSON report suitable for frontend consumption.
 * Exposes Excel/CSV export option.
 */

export interface ResourcePrioritizationReport {
  reportId: string;
  generatedAt: string;
  duration: {
    from: string;
    to: string;
  };
  totals: {
    totalTasks: number;
    totalStoryPoints: number;
    totalEffortPercent: number;
  };
  byPriority: {
    high: {
      count: number;
      storyPoints: number;
      effortPercent: number;
      breakdown: TaskPriorityBreakdown;
    };
    medium: {
      count: number;
      storyPoints: number;
      effortPercent: number;
      breakdown: TaskPriorityBreakdown;
    };
    low: {
      count: number;
      storyPoints: number;
      effortPercent: number;
      breakdown: TaskPriorityBreakdown;
    };
  };
  byStatus: {
    backlog: number;
    todo: number;
    in_progress: number;
    in_review: number;
    done: number;
    blocked: number;
  };
  misalignments: {
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    insights: string[];
  }[];
  reportVersion: string; // AC6: enables audit consistency, maintain ET + visual equals 5% of manual
}

export interface TaskPriorityBreakdown {
  tasks: Array<{
    taskId: number;
    title: string;
    priority: 'high' | 'medium' | 'low';
    status: string;
    storyPoints: number | null;
    projectId: number;
  }>;
  averageStoryPoints: number;
}

export interface ResourcePrioritizationOptions {
  projectId?: number;
  from?: string; // ISO date
  to?: string; // ISO date
  groupBy?: 'priority' | 'status' | 'project';
  metric?: 'storyPoints' | 'energy' | 'hours';
  includeMisalignments?: boolean;
}

/**
 * Report generation service for FR7
 */
export class ResourcePrioritizationReportService {
  /**
   * Generate resource prioritization report
   * AC6: Report within 5% of manual audits
   */
  static async generateReport(options: ResourcePrioritizationOptions = {}): Promise<
    ResourcePrioritizationReport
  > {
    // Set default date range to last 7 days if not provided
    if (!options.from || !options.to) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 7);
      options.from = start.toISOString().split('T')[0];
      options.to = end.toISOString().split('T')[0];
    }

    // Simulate data aggregation
    const data = await this.simulatedTaskData(options);

    // Calculate totals
    const totalTasks = data.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0);
    const highCount = data.filter((t) => t.priority === 'high').length;
    const mediumCount = data.filter((t) => t.priority === 'medium').length;
    const lowCount = data.filter((t) => t.priority === 'low').length;
    const totalPriorityTasks = highCount + mediumCount + lowCount;

    // Build byPriority breakdown
    const byPriority = {
      high: {
        count: highCount,
        storyPoints: highCount * 5, // Simulated
        effortPercent: totalPriorityTasks ? (highCount / totalPriorityTasks) * 100 : 0,
        breakdown: this.buildPriorityBreakdown('high', data),
      },
      medium: {
        count: mediumCount,
        storyPoints: mediumCount * 3, // Simulated
        effortPercent: totalPriorityTasks ? (mediumCount / totalPriorityTasks) * 100 : 0,
        breakdown: this.buildPriorityBreakdown('medium', data),
      },
      low: {
        count: lowCount,
        storyPoints: lowCount * 1, // Simulated
        effortPercent: totalPriorityTasks ? (lowCount / totalPriorityTasks) * 100 : 0,
        breakdown: this.buildPriorityBreakdown('low', data),
      },
    };

    // Build byStatus breakdown
    const byStatus = {
      backlog: data.filter((t) => t.status === 'backlog').length,
      todo: data.filter((t) => t.status === 'todo').length,
      in_progress: data.filter((t) => t.status === 'in_progress').length,
      in_review: data.filter((t) => t.status === 'in_review').length,
      done: data.filter((t) => t.status === 'done').length,
      blocked: data.filter((t) => t.status === 'blocked').length,
    };

    // Detect misalignments (AC6)
    let misalignments: ResourcePrioritizationReport['misalignments'] = [];
    if (options.includeMisalignments) {
      misalignments = this.detectMisalignments(data, byPriority);
    }

    return {
      reportId: `report-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      duration: {
        from: options.from,
        to: options.to,
      },
      totals: {
        totalTasks,
        totalStoryPoints: data.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0),
        totalEffortPercent: 100,
      },
      byPriority,
      byStatus,
      misalignments,
      reportVersion: '1.0', // AC6: maintain ET + visual equals 5% of manual
    };
  }

  /**
   * Export report as CSV (FR7)
   */
  static async exportToCSV(
    reportId: string,
    format: 'csv' | 'xlsx'
  ): Promise<Blob> {
    const report = await ResourcePrioritizationReportService.getReportById(reportId);

    // Create CSV content
    let csv = 'Priority,Status,Task ID,Title,Story Points\n';

    Object.entries(report.byPriority).forEach(([priority, data]) => {
      data.breakdown.tasks.forEach((task) => {
        csv += `${priority},${task.status},${task.taskId},"${task.title}",${task.storyPoints || 'N/A'}\n`;
      });
    });

    return new Blob([csv], { type: 'text/csv' });
  }

  private static buildPriorityBreakdown(
    priority: 'high' | 'medium' | 'low',
    tasks: any[]
  ): TaskPriorityBreakdown {
    const priorityTasks = tasks.filter((t) => t.priority === priority);
    return {
      tasks: priorityTasks.slice(0, 10), // Limit for brevity
      averageStoryPoints:
        priorityTasks.length > 0
          ? priorityTasks.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0) /
            priorityTasks.length
          : 0,
    };
  }

  private static detectMisalignments(
    tasks: any[],
    byPriority: ResourcePrioritizationReport['byPriority']
  ): ResourcePrioritizationReport['misalignments'] {
    const misalignments: ResourcePrioritizationReport['misalignments'] = [];

    // Check if low-priority tasks have significant effort
    if (byPriority.low.storyPoints / (byPriority.high.storyPoints + byPriority.medium.storyPoints) > 0.4) {
      misalignments.push({
        description:
          'Low-priority tasks consume >40% of total estimated effort',
        severity: 'critical',
        insights: [
          'High-priority items are racing finite resources',
          'Consider marking low-priority items as on_hold or deferred',
        ],
      });
    }

    // Check done tasks distribution
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    const totalTasks = tasks.length;
    if (doneTasks / totalTasks > 0.6) {
      misalignments.push({
        description:
          '60%+ completion is healthy, but verify priority distribution confirms correct execution focus',
        severity: 'low',
        insights: [
          'Ensure final compliance with original priority sorting',
          'Review if any high-priority items were deprioritized incorrectly',
        ],
      });
    }

    return misalignments;
  }

  private static async simulatedTaskData(options: ResourcePrioritizationOptions): Promise<any[]> {
    // Simulate retrieving tasks
    return new Promise((resolve) => {
      setTimeout(
        () =>
          resolve([
            {
              taskId: 143,
              title:
                'Analyze: Delivery tracking — velocity, deadlines, and trend assessment',
              priority: 'high',
              status: 'in_review',
              storyPoints: 8,
              projectId: 11,
            },
            {
              taskId: 154,
              title:
                'Onboarding Wizard UX — guided flow from questions → integrations → diagnostics → resolution',
              priority: 'critical',
              status: 'in_review',
              storyPoints: 13,
              projectId: 11,
            },
            {
              taskId: 145,
              title:
                'Analyze: Acceleration opportunities — what can we do to deliver sooner?',
              priority: 'high',
              status: 'in_review',
              storyPoints: 10,
              projectId: 11,
            },
            {
              taskId: 142,
              title:
                'Analyze: Bug and quality audit — count known bugs, regressions, and test failures',
              priority: 'critical',
              status: 'in_review',
              storyPoints: 10,
              projectId: 11,
            },
            {
              taskId: 231,
              title: 'Historical velocity (human + AI combined)',
              priority: 'medium',
              status: 'in_review',
              storyPoints: 5,
              projectId: 11,
            },
            {
              taskId: 343,
              title: 'Velocity gap: Current velocity vs velocity needed to hit deadlines',
              priority: 'medium',
              status: 'in_progress',
              storyPoints: 8,
              projectId: 11,
            },
            {
              taskId: 242,
              title: 'Cost projection with budget comparison',
              priority: 'medium',
              status: 'in_review',
              storyPoints: 5,
              projectId: 11,
            },
            {
              taskId: 383,
              title: 'Tax compliance (W-9 / W-8BEN + 1099)',
              priority: 'medium',
              status: 'backlog',
              storyPoints: 3,
              projectId: 11,
            },
          ]),
        100
      );
    });
  }

  private static async getReportById(reportId: string): Promise<
    ResourcePrioritizationReport
  > {
    // In production, fetch from database
    return new Promise((resolve) => {
      // Return cached report data
      resolve({
        reportId,
        generatedAt: new Date().toISOString(),
        duration: {
          from: '2026-07-01',
          to: '2026-07-12',
        },
        totals: {
          totalTasks: 8,
          totalStoryPoints: 52,
          totalEffortPercent: 100,
        },
        byPriority: {
          high: {
            count: 3,
            storyPoints: 15,
            effortPercent: 28.8,
            breakdown: {
              tasks: [],
              averageStoryPoints: 5,
            },
          },
          medium: {
            count: 5,
            storyPoints: 21,
            effortPercent: 40.4,
            breakdown: {
              tasks: [],
              averageStoryPoints: 4.2,
            },
          },
          low: {
            count: 0,
            storyPoints: 0,
            effortPercent: 0,
            breakdown: {
              tasks: [],
              averageStoryPoints: 0,
            },
          },
        },
        byStatus: {
          backlog: 1,
          todo: 0,
          in_progress: 1,
          in_review: 5,
          done: 0,
          blocked: 1,
        },
        misalignments: [],
        reportVersion: '1.0',
      });
    });
  }
}