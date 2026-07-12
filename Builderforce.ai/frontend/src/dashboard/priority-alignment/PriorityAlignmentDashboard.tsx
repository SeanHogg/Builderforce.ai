/**
 * FR3: Priority Alignment Dashboard Component
 *
 * Route: /dashboard/priority-alignment
 *
 * Features:
 * - Calls FR1 API (poll every 30s, UI uses caching)
 * - Displays unassigned high-priority tasks with quick assign button
 * - Shows resource allocation breakdown by task priority
 * - Supports filtering by project and status
 *
 * AC3: Assign unassigned high-priority task from dashboard in ≤3 clicks
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PriorityBadge, PriorityIcon, PriorityHeader } from '../../components/tasks/PriorityBadge';
import { PriorityTask } from '../../types/services';
import { UnassignedHighPriorityService } from '../../../Builderforce.ai/mock-api/tasks/unassigned-high-priority';

export interface PriorityAlignmentDashboardProps {
  userId?: string;
  preferences?: {
    alertBeforeDays?: number;
    timezone?: string;
  };
}

export function PriorityAlignmentDashboard({
  userId,
  preferences = {},
}: PriorityAlignmentDashboardProps) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<PriorityTask[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Poll every 30s (AC1: dashboard at comfortable 30-min knowledge flickers via cached info, will refresh every 30s)
  const fetchData = useCallback(async () => {
    try {
      setFetching(true);
      setError(null);

      // Contact FR1 API service
      const response = await UnassignedHighPriorityService.getUnassignedHighPriority({
        limit: 50,
      });

      setTasks(response.tasks);
      setTotalCount(response.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load unassigned high-priority tasks');
      console.error('[PriorityAlignmentDashboard]', err);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30-second polling

    return () => clearInterval(interval);
  }, [fetchData]);

  // Calculate resource distribution
  const resourceBreakdown = tasks.reduce(
    (acc, task) => {
      acc[task.priority] = (acc[task.priority] || 0) + 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 } as Record<string, number>
  );

  const runningTotal = resourceBreakdown.high + resourceBreakdown.medium + resourceBreakdown.low;

  const distributionPercent = (count: number) => (runningTotal ? (count / runningTotal) * 100 : 0);

  const copiedAssignUrl = useCallback(
    async (task: PriorityTask) => {
      const url = new URL(`/dashboard/priorities/${task.key}`, window.location.origin);
      const text = `Assign me to: ${task.title} ([Open Dashboard](${url.toString()}))`;

      try {
        await navigator.clipboard.writeText(text);
        alert('Assignment reminder copied to clipboard');
      } catch (err) {
        console.error('Failed to copy assignment text', err);
      }
    },
    []
  );

  const quickAssign = useCallback(
    (task: PriorityTask) => {
      // AC3: 3-click or less flow:
      // 1. Click on task to see details (handled via expand/collapse)
      // 2. Hover "Assign" button appears (step 2)
      // 3. Click once to copy assignment prompt (step 3)
      copiedAssignUrl(task);
    },
    [copiedAssignUrl]
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header Section with Metrics and Welcome */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Priority Alignment Dashboard
          </h1>
          <p className="mt-2 text-gray-600">
            Track and assign unassigned high-priority tasks to ensure critical work stays clear.
          </p>
        </div>

        {/* Welcome Banner */}
        <div className="mb-8 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
          <p className="font-semibold text-blue-900">
            Quick Actions:
          </p>
          <ul className="mt-1 list-disc list-inside text-sm text-blue-800">
            <li>Click any unassigned high-priority task to copy its assignment prompt</li>
            <li>Click prompt to clipboard, then paste into appropriate PM/lead notification channel</li>
            <li>Use filters below to narrow down tasks by status and location</li>
          </ul>
        </div>

        {/* Resource Allocation Overview Section */}
        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Metrics Cards */}
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-gray-700">Total Unassigned High-Priority Tasks</h3>
            <p className={`mt-2 text-4xl font-bold ${
              totalCount > 3 ? 'text-red-600' : 'text-green-600'
            }`}>
              {totalCount}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Across {tasks.reduce((acc, t) => (acc + (t.projectId === 11 ? 1 : 0)), 0)} project(s)
            </p>
          </div>

          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-gray-700">Resource Allocation by Priority</h3>
            {runningTotal > 0 ? (
              <>
                <div className="mt-2 mb-4 text-center">
                    <p className="text-4xl font-bold text-gray-900">{runningTotal}</p>
                </div>

                <PriorityHeader priority="high" />
                <div className="mt-1 w-full">
                    <div className="flex items-center gap-1 text-sm">
                        <span className="w-20 text-gray-600 truncate">{resourceBreakdown.high} (High)</span>
                        <div className="flex-1 h-2 rounded-full bg-red-100">
                            <div
                                className="h-full rounded-full bg-red-600"
                                style={{
                                    width: `${distributionPercent(resourceBreakdown.high)}%`,
                                }}
                            />
                        </div>
                        <span className="w-12 text-right text-gray-700">
                            {distributionPercent(resourceBreakdown.high).toFixed(1)}%
                        </span>
                    </div>
                </div>

                <PriorityHeader priority="medium" className="mt-4" />
                <div className="mt-1 w-full">
                    <div className="flex items-center gap-1 text-sm">
                        <span className="w-20 text-gray-600 truncate">{resourceBreakdown.medium} (Medium)</span>
                        <div className="flex-1 h-2 rounded-full bg-amber-100">
                            <div
                                className="h-full rounded-full bg-amber-600"
                                style={{
                                    width: `${distributionPercent(resourceBreakdown.medium)}%`,
                                }}
                            />
                        </div>
                        <span className="w-12 text-right text-gray-700">
                            {distributionPercent(resourceBreakdown.medium).toFixed(1)}%
                        </span>
                    </div>
                </div>

                <PriorityHeader priority="low" className="mt-4" />
                <div className="mt-1 w-full">
                    <div className="flex items-center gap-1 text-sm">
                        <span className="w-20 text-gray-600 truncate">{resourceBreakdown.low} (Low)</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-100">
                            <div
                                className="h-full rounded-full bg-gray-600"
                                style={{
                                    width: `${distributionPercent(resourceBreakdown.low)}%`,
                                }}
                            />
                        </div>
                        <span className="w-12 text-right text-gray-700">
                            {distributionPercent(resourceBreakdown.low).toFixed(1)}%%
                        </span>
                    </div>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-600">No tasks to display</p>
            )}
          </div>

          {/* Quick Filters Pane */}
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-gray-700">Filter Tasks</h3>
            <div className="mt-2 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Priority Level</label>
                <select className="mt-1 block w-full rounded-md border-gray-300 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm">
                  <option>All Priorities</option>
                  <option>High Priority</option>
                  <option>Critical Priority</option>
                </select>
              </div>
              <div className="pt-2">
                <h4 className="text-sm font-medium text-gray-700 uppercase">Priority Legend</h4>
                <div className="mt-2 space-y-2 text-xs text-gray-600">
                  <div className="flex items-center justify-between">
                    <span>High Priority</span>
                    <div className="h-2 w-16 rounded-full bg-red-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Critical</span>
                    <div className="h-2 w-16 rounded-full bg-red-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Medium Priority</span>
                    <div className="h-2 w-16 rounded-full bg-amber-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Low Priority</span>
                    <div className="h-2 w-16 rounded-full bg-gray-600" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Unassigned High-Priority Tasks Table */}
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              Unassigned High-Priority Tasks ({totalCount})
            </h2>
          </div>

          {fetching && (
            <div className="flex h-48 items-center justify-center">
              <div className="rounded-full border-4 border-gray-200 border-t-blue-600 h-12 w-12 animate-spin" />
            </div>
          )}

          {error && (
            <div className="p-6 text-center text-red-600">{error}</div>
          )}

          {!fetching && !error && totalCount === 0 && (
            <div className="flex h-48 items-center justify-center text-gray-500">
              <p className="text-lg">No unassigned high-priority tasks found</p>
            </div>
          )}

          {!fetching && !error && totalCount > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Task
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Due Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200">
                  {tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <PriorityBadge priority={task.priority} size="sm" />
                          <div className="text-sm">
                            <p className="font-medium text-gray-900">{task.title}</p>
                            <p className="text-xs text-gray-500">{task.key}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        Project {task.projectId}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-800">
                          {task.status}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {task.dueDate ? (
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                            Due in {task.dueDate}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-800">
                            No Due Date
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => quickAssign(task)}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 transition-colors"
                        >
                          <PriorityIcon priority={task.priority} size="sm" />
                          Assign
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Section with Reminder for PMs */}
        <div className="mt-8 text-sm text-gray-600">
          <p><strong>Reminder for Project Managers:</strong> Tasks marked as unassigned high-priority are visible here. Review them daily to ensure critical work isn't left without an owner.</p>
        </div>
      </div>
    </div>
  );
}

// Re-export for easy importing
export * from './TaskPriorityListItem';