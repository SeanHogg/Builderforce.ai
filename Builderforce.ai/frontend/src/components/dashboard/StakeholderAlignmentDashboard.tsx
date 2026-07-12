/**
 * Stakeholder Alignment Dashboard Panel
 *
 * Dashboard panel component integrated into the Stakeholder Alignment facet.
 * Displays:
 * - Summary view (total approved priorities, open/pending/overdue sign-offs, active conflicts, overdue escalations)
 * - Filterable data (project, time period, stakeholder)
 * - Access to weekly digest consumption and manual reload
 *
 * Implements FR1.1, FR1.2, FR1.3, FR1.4, FR2.1, FR2.2, FR2.3, FR4.1
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  DashboardDTO,
  DashboardFilters,
  WeeklyDigest,
  TimePeriod,
  DistributionMethod,
} from '@/types/dashboard';

/**
 * Dashboard Panel Props
 */
interface Props {
  initialFilters?: DashboardFilters;
}

/**
 * Dashboard Metrics Cards Component
 */
const MetricsCards: React.FC<{ summary: DashboardDTO['summary'] }> = ({ summary }) => {
  const cards = [
    {
      title: 'Total Approved Priorities',
      value: summary.totalApprovedPriorities,
      icon: '✓',
      color: 'success',
      description: 'Approved and active priorities',
    },
    {
      title: 'Open Sign-Offs',
      value: summary.openSignOffs,
      icon: '🕒',
      color: 'warning',
      description: 'Awaiting approval',
    },
    {
      title: 'Pending Sign-Offs',
      value: summary.pendingSignOffs,
      icon: '⏳',
      color: 'info',
      description: 'Under review',
    },
    {
      title: 'Overdue Sign-Offs',
      value: summary.overdueSignOffs,
      icon: '⚠️',
      color: 'danger',
      description: 'Action required',
    },
    {
      title: 'Active Conflicts',
      value: summary.activeConflicts,
      icon: '🔄',
      color: 'warning',
      description: 'Priority/resource conflicts',
    },
    {
      title: 'Overdue Escalations',
      value: summary.overdueEscalations,
      icon: '🚨',
      color: 'danger',
      description: 'Urgent attention needed',
    },
  ];

  const colorStyles: Record<string, { bg: string; text: string }> = {
    success: { bg: 'bg-green-50', text: 'text-green-600' },
    warning: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
    info: { bg: 'bg-blue-50', text: 'text-blue-600' },
    danger: { bg: 'bg-red-50', text: 'text-red-600' },
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card, index) => {
        const style = colorStyles[card.color];
        return (
          <div
            key={index}
            className={`${style.bg} rounded-lg p-4 border border-${style.text.replace('text-', '')}-100`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{card.title}</p>
                <p className={`text-2xl font-bold ${style.text} mt-1`}>{card.value}</p>
                <p className="text-xs text-gray-500 mt-2">{card.description}</p>
              </div>
              <div className="text-3xl">{card.icon}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Project Metrics Table Component
 */
const ProjectMetricsTable: React.FC<{
  projects: DashboardDTO['projects'];
}> = ({ projects }) => {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-4 text-center text-gray-500">
        No projects to display
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Project
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Approvals
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Open Sign-Offs
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Conflicts
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {projects.map((project) => (
            <tr key={project.projectId}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{project.projectName}</div>
                <div className="text-xs text-gray-500">{project.projectId}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                {project.priorityMetrics.totalApproved}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                {project.signOffMetrics.overdue} overdue<br />
                {project.signOffMetrics.open} pending
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                {project.conflictMetrics.active}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Weekly Digest Panel Component
 */
const WeeklyDigestPanel: React.FC<{
  digest?: WeeklyDigest;
  onReload?: () => void;
  isLoading?: boolean;
}> = ({ digest, onReload, isLoading }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6 mt-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <div className="bg-blue-100 rounded-full p-2">
              <svg
                className="h-6 w-6 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900">Weekly Stakeholder Digest</h3>
            <p className="text-sm text-gray-600 mt-1">
              {digest ? `Last generated: ${new Date(digest.generatedAt).toLocaleString()}` : ''}
            </p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setVisible(!visible)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {visible ? 'Hide' : 'Show'}
          </button>
          <button
            onClick={onReload}
            disabled={isLoading}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Loading...' : 'Reload'}
          </button>
        </div>
      </div>

      {visible && digest && (
        <div className="mt-4 bg-white rounded-lg border border-blue-200 p-4">
          <div
            className="text-sm whitespace-pre-wrap text-gray-700"
            dangerouslySetInnerHTML={{ __html: this.escapeHtml(digest.content) }}
          />
          <div className="mt-3 pt-3 border-t border-blue-100">
            <a
              href="/digest"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              View full digest history →
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Stakeholder Alignment Dashboard Component
 */
export const StakeholderAlignmentDashboard: React.FC<Props> = ({ initialFilters }) => {
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(
    initialFilters || {
      timePeriod: 'last_30_days',
    }
  );
  const [isLoading, setIsLoading] = useState(true);
  const [digest, setDigest] = useState<WeeklyDigest | undefined>();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  /**
   * Fetch dashboard metrics
   */
  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    try {
      // In production, this would call the backend API endpoint
      // const response = await fetch('/api/dashboard', { method: 'POST', body: JSON.stringify(filters) });
      // const data: DashboardDTO = await response.json();

      // Mock data for demo
      await new Promise((resolve) => setTimeout(resolve, 300)); // Simulate network delay
      setData({
        summary: {
          totalApprovedPriorities: 47,
          openSignOffs: 23,
          pendingSignOffs: 14,
          overdueSignOffs: 5,
          activeConflicts: 8,
          overdueEscalations: 2,
          lastUpdated: new Date().toISOString(),
        },
        projects: [
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
        ],
      });
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  /**
   * Fetch latest digest
   */
  const fetchDigest = useCallback(async () => {
    try {
      // In production, this would call the backend digest API endpoint
      // const response = await fetch('/api/digest/latest');
      // const digest: WeeklyDigest = await response.json();

      // Mock digest data for demo
      await new Promise((resolve) => setTimeout(resolve, 200)); // Simulate network delay
      setDigest({
        digestId: 'digest_1700000000000',
        generatedAt: new Date().toISOString(),
        recipients: [],
        content: '📊 23 open sign-offs, 4 pending escalations — full view: /dashboard\n\n🔴 Top Conflicts:\n- Priority Conflict in Customer Experience Platform (P0)\n- Resource Allocation Disagreement (P1)\n\n⚠️ Urgent Action Items:\n- Resolve priority conflict for Customer Experience Platform (due: 2025-06-20)\n- Approve pending sign-offs for AI Agent Training (due: 2025-06-21)',
        metrics: {
          totalOpenSignOffs: 23,
          pendingEscalations: 4,
          topConflicts: [
            {
              id: 'conflict_001',
              title: 'Priority Conflict in Customer Experience Platform',
              priority: 'P0',
              severity: 'Critical',
            },
          ],
          urgentActionItems: [
            {
              id: 'task_001',
              title: 'Resolve priority conflict for Customer Experience Platform',
              priority: 'Urgent',
              targetDate: '2025-06-20',
            },
          ],
        },
      });
    } catch (error) {
      console.error('Failed to fetch digest:', error);
    }
  }, []);

  /**
   * Load initial data
   */
  useEffect(() => {
    fetchDashboardData();
    fetchDigest();
  }, []);

  /**
   * Handle filter changes
   */
  const handleFilterChange = (newFilters: Partial<DashboardFilters>) => {
    // Convert timePeriod string to enum value
    const convertedFilters: DashboardFilters = {
      timePeriod: new Filters }?.timePeriod || 'last_30_days',
      projectIds: newFilters.projectIds,
      stakeholderIds: newFilters.stakeholderIds,
      timeRange: newFilters.timeRange,
    };

    setFilters(convertedFilters);
  };

  /**
   * Handle reload
   */
  const handleReload = () => {
    fetchDashboardData();
    fetchDigest();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Stakeholder Alignment Dashboard</h2>
        <p className="text-sm text-gray-600 mt-1">
          Real-time view of project alignment metrics and priority status
        </p>
      </div>

      {/* Last Updated Badge */}
      {lastUpdated && (
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Last updated:{' '}
            {new Date(lastUpdated).toLocaleTimeString()} (cached for ~60 seconds)
          </div>
          <div className="flex space-x-2">
            <select
              value={filters.timePeriod}
              onChange={(e) => handleFilterChange({ timePeriod: e.target.value as TimePeriod })}
              className="rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="last_90_days">Last 3 Months</option>
              <option value="last_year">Last Year</option>
            </select>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex space-x-4">
        <button
          onClick={() => handleFilterChange({ projectIds: ['proj_001'] })}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Filter by Project
        </button>
        <button
          onClick={() => handleFilterChange({ stakeholderIds: ['stakeholder_001'] })}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Filter by Stakeholder
        </button>
      </div>

      {/* Metrics Cards */}
      {isLoading ? (
        <div className="text-center py-12">
          <svg
            className="animate-spin h-10 w-10 text-gray-400 mx-auto"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="mt-4 text-gray-600">Loading dashboard data...</p>
        </div>
      ) : data ? (
        <>
          <MetricsCards summary={data.summary} />
          <ProjectMetricsTable projects={data.projects} />
          <WeeklyDigestPanel
            digest={digest}
            onReload={handleReload}
            isLoading={isLoading}
          />
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          No data available
        </div>
      )}
    </div>
  );
};

// Helper to escape HTML for safe rendering
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}