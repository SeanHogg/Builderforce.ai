/**
 * Scope Health Dashboard Component
 *
 * Displays comprehensive Scope Health metrics with:
 * - Scope Creep Indicator with sparkline
 * - New vs Completed Work Ratio with dual-bar chart
 * - Epic Completion Table with status indicators
 * - Health History tab with annotations
 * - Iframe embeddable for external views
 */

import React, { useState, useMemo } from 'react';
import {
  MetricCard,
  Sparkline,
  DualBarChart,
  Table,
  Badge,
  Tabs,
  DateTimeRangePicker,
  Toggle,
  ExportButton,
  NotificationCallout,
} from '@/components/ui';
import { useScopeHealth } from './hooks/useScopeHealth';
import type {
  Task,
  Period,
  CalculationMode,
  TimeWindow,
  EpicCompletion,
  ScopeHealthScore,
} from './types';
import { downloadCSV } from '@/utils/files';

export interface ScopeHealthDashboardProps {
  tasks: Task[];
  projectId?: string;
  baselineLockedAt?: string;
  calculationMode?: CalculationMode;
}

export const ScopeHealthDashboard: React.FC<ScopeHealthDashboardProps> = ({
  tasks,
  projectId,
  baselineLockedAt,
  calculationMode = 'item_count',
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    windowEnd: new Date().toISOString().split('T')[0],
    label: 'Last 7 Days',
  });
  const [showEpicTable, setShowEpicTable] = useState(true);
  const [embedMode, setEmbedMode] = useState(false);
  const [notifyOnAtRisk, setNotifyOnAtRisk] = useState(true);
  const [historyTab, setHistoryTab] = useState<'overview' | 'epics' | 'exports'>('overview');

  // Determine time window in seconds for now
  const timeWindowSeconds: number = 7 * 24 * 60 * 60; // Default 7 days

  const periods: Period[] = [
    {
      windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      windowEnd: new Date().toISOString().split('T')[0],
      label: 'Last 7 Days',
    },
    {
      windowStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      windowEnd: new Date().toISOString().split('T')[0],
      label: 'Last 14 Days',
    },
    {
      windowStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      windowEnd: new Date().toISOString().split('T')[0],
      label: 'Last 30 Days',
    },
    {
      windowStart: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      windowEnd: new Date().toISOString().split('T')[0],
      label: 'Last Quarter',
    },
  ];

  // Calculate metrics
  const { scopeCreep, ratio, epicCompletions, compositeScore, healthHistory } = useScopeHealth({
    tasks,
    period: selectedPeriod,
    mode: calculationMode,
    baselineInfo: baselineLockedAt
      ? {
          id: 'baseline',
          lockedAt: baselineLockedAt,
          itemCount: tasks.length,
          totalStoryPoints: tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0),
        }
      : undefined,
  });

  // Handle period change
  const handlePeriodChange = (period: Period) => {
    setSelectedPeriod(period);
  };

  // Handle calculation mode change
  const handleModeChange = (mode: CalculationMode) => {
    // Recalculate will be handled by the hook when tasks change
    window.location.reload();
  };

  // Export ratio data as CSV
  const handleExport = () => {
    const windowStart = new Date(selectedPeriod.windowStart).getTime();
    const windowEnd = new Date(selectedPeriod.windowEnd).getTime();

    const tasksInPeriod = tasks.filter((task) => {
      const createdAt = new Date(task.createdAt).getTime();
      const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : windowEnd;
      return createdAt >= windowStart && completedAt >= windowStart;
    });

    const csv = window.location.hostname.includes('localhost')
      ? `ID,Title,Type,Status,Points,Added Date,Completed Date,Epic\n`
      : new URLSearchParams(window.location.search).get('projectId')
      ? `ID,Title,Type,Status,Points,Added Date,Completed Date,Epic\n`
      : `ID,Title,Type,Status,Points,Added Date,Completed Date,Epic\n`;

    // Add CSV header
    csv += `ID,Title,Type,Status,Points,Added Date,Completed Date,Epic\n`;

    // Add data rows
    for (const task of tasksInPeriod) {
      const epicTitle = epicCompletions.find((e) =>
        e.epic.id === String(task.parentTaskId)
      )?.epic.title || '';
      csv += `"${task.id}","${task.title}","${
        task.type || 'task'
      }","${task.status}","${task.storyPoints || 0}","${
        task.createdAt?.split('T')[0] || ''
      }","${task.completedAt?.split('T')[0] || ''}","${epicTitle}"\n`;
    }

    downloadCSV(csv, `scope-health-${selectedPeriod.label.replace(/\s+/g, '-')}.csv`);
  };

  // Check for at-risk epics that should trigger notifications
  const hasAtRiskEpics = useMemo(() => {
    return epicCompletions.some((e) => e.status === 'at_risk' || e.status === 'off_track');
  }, [epicCompletions]);

  // Render light notification footer for iframe embed mode
  const renderFooterForEmbed = () => {
    return (
      <div className="bg-white border-t border-gray-200 p-2 text-xs text-gray-600 text-center sticky bottom-0">
        Scope Health Dashboard • BuilderForce.AI
      </div>
    );
  };

  // In production, notifications would be delivered here
  if (notifyOnAtRisk && hasAtRiskEpics && !embedMode) {
    return (
      <div className="space-y-6 p-6">
        <NotificationCallout
          type="warning"
          title="Scope Health Alert"
          message={`One or more epics are at risk: ${epicCompletions.filter((e) => e.status === 'at_risk' || e.status === 'off_track').length} epics are behind schedule.`}
          actions={[
            {
              label: 'View Details',
              onClick: () => setHistoryTab('epics'),
            },
          ]}
        />
        <ScopeHealthSummaryPanel
          scopeCreep={scopeCreep}
          ratio={ratio}
          compositeScore={compositeScore}
          epicCompletions={epicCompletions}
          embedMode={embedMode}
        />
      </div>
    );
  }

  return (
    <div className={`space-y-6 p-6 ${embedMode ? 'min-h-screen' : 'min-h-full'}`}>
      {!embedMode && (
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Scope Health Dashboard</h2>
          <div className="flex items-center gap-4">
            <Toggle
              label="Item Count Mode"
              checked={calculationMode === 'item_count'}
              onToggle={() => handleModeChange('item_count')}
            />
            <Toggle
              label="Story Points Mode"
              checked={calculationMode === 'story_points'}
              onToggle={() => handleModeChange('story_points')}
            />
            <ExportButton
              label="Export CSV"
              onClick={handleExport}
              disabled={!tasks.length}
            />
          </div>
        </div>
      )}

      {/* Scope Health Summary */}
      <ScopeHealthSummaryPanel
        scopeCreep={scopeCreep}
        ratio={ratio}
        compositeScore={compositeScore}
        epicCompletions={epicCompletions}
        embedMode={embedMode}
      />

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Scope Creep Score */}
        <MetricCard
          title="Scope Creep Score"
          value={`${scopeCreep.value.toFixed(1)}%`}
          status={scopeCreep.status}
          description="Percentage change in committed items after baseline lock"
          detailedViews={
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                Baseline: {scopeCreep.baselineItemCount} items
              </p>
              <p className="text-sm text-gray-600">
                Added: {scopeCreep.itemsAddedPostBaseline} items
              </p>
              <p className="text-sm text-gray-600">
                Change: {scopeCreep.percentageChange.toFixed(1)}%
              </p>
            </div>
          }
        >
          {!embedMode && (
            <Sparkline
              data={healthHistory}
              color={scopeCreep.status}
              titleScopeHealthTitle="Scope Creep History"
            />
          )}
        </MetricCard>

        {/* New vs Completed Ratio */}
        <MetricCard
          title="New / Completed Ratio"
          value={ratio.value.toFixed(2)}
          status={ratio.status === 'warning' ? 'warning' : 'normal'}
          description="Work added vs. work completed in selected period"
          detailedViews={
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                Added: {ratio.addedItems || ratio.addedStoryPoints || 0}
              </p>
              <p className="text-sm text-gray-600">
                Completed: {ratio.completedItems || ratio.completedStoryPoints || 0}
              </p>
              {ratio.value > 1.0 && (
                <p className="mt-2 text-sm font-medium text-orange-600">
                  Warning: More work added than completed
                </p>
              )}
            </div>
          }
        >
          {!embedMode && (
            <DualBarChart
              added={ratio.addedItems || ratio.addedStoryPoints || 0}
              completed={ratio.completedItems || ratio.completedStoryPoints || 0}
              comparison="added"
            />
          )}
        </MetricCard>

        {/* Health History */}
        {!embedMode && (
          <div className="col-span-1 md:col-span-2 lg:col-span-1">
            <MetricCard
              title="Health History"
              value={compositeScore.value.toFixed(1)}
              status={compositeScore.value >= 70 ? 'normal' : compositeScore.value >= 45 ? 'warning' : 'critical'}
              description="Composite Scope Health Score (0-100)"
            >
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full"
                      style={{ width: `${compositeScore.value}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-600 text-center">
                    Score: {compositeScore.value.toFixed(1)}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center">
                      <p className="text-gray-500">Creep</p>
                      <p className="font-medium">{(compositeScore.breakdown.scopeCreep / 100 * 100).toFixed(0)}%</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500">Ratio</p>
                      <p className="font-medium">{(compositeScore.breakdown.ratio / 100 * 100).toFixed(0)}%</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500">Epic</p>
                      <p className="font-medium">{(compositeScore.breakdown.epicCompletion / 100 * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            </MetricCard>
          </div>
        )}
      </div>

      {/* Tabbed Content */}
      {!embedMode && (
        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'epics', label: 'Epic Completion' },
            { id: 'exports', label: 'Exports' },
          ]}
          activeTab={historyTab}
          onChange={setHistoryTab}
        >
          <div className="mt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Detailed View</h3>

            {/* Epic Completion Table */}
            {historyTab === 'epics' && (
              <EpicCompletionTable
                epicCompletions={epicCompletions}
                embedMode={embedMode}
              />
            )}

            {/* Export Options */}
            {historyTab === 'exports' && (
              <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
                <h4 className="text-lg font-medium text-gray-900 mb-4">Export Data</h4>
                <div className="space-y-4">
                  <button
                    onClick={handleExport}
                    disabled={!tasks.length}
                    className="w-full max-w-md px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    Export New/Completed Ratio (CSV)
                  </button>
                  <p className="text-sm text-gray-600">
                    Exports work items added in the selected period with their details.
                  </p>
                </div>
              </div>
            )}

            {/* Overview Page */}
            {historyTab === 'overview' && (
              <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
                <h4 className="text-lg font-medium text-gray-900 mb-4">
                  Scope Health Overview
                </h4>
                <p className="text-gray-600">
                  Use the tabs above to explore epic completions or export data.
                </p>
              </div>
            )}
          </div>
        </Tabs>
      )}

      {/* Embed Mode Footer */}
      {embedMode && renderFooterForEmbed()}
    </div>
  );
};

/**
 * Scope Health Summary Panel
 */
function ScopeHealthSummaryPanel({
  scopeCreep,
  ratio,
  compositeScore,
  epicCompletions,
  embedMode,
}: {
  scopeCreep: any;
  ratio: any;
  compositeScore: ScopeHealthScore;
  epicCompletions: EpicCompletion[];
  embedMode: boolean;
}) {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-2">Scope Health Score</h3>
          <p className="text-sm text-blue-100 opacity-90">
            Based on Scope Creep, New/Done Ratio, and Epic Completion
          </p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold">{Number.isNaN(compositeScore.value) ? 0 : Number(compositeScore.value).toFixed(1)}</div>
          <div className="text-sm text-blue-100 opacity-80">
            / 100
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-blue-200">Scope Creep:</span>{' '}
          <span id="scopeCreepDisplay">{Number.isNaN(scopeCreep.value) ? 0 : Number(scopeCreep.value).toFixed(1)}%</span>
        </div>
        <div>
          <span className="text-blue-200">New/Done:</span>{' '}
          <span id="ratioDisplay">{Number.isNaN(ratio.value) ? 0 : Number(ratio.value).toFixed(2)}</span>
        </div>
        <div>
          <span className="text-blue-200">Epic Completion:</span>{' '}
          <span id="epicCompletionDisplay">
            {Number.isNaN(compositeScore.breakdown.epicCompletion) ? 0 : Number(compositeScore.breakdown.epicCompletion).toFixed(1)}%
          </span>
        </div>
      </div>
      {!embedMode && (
        <div className="mt-4 text-blue-200 text-sm">
          <span className="font-medium">Status:</span>{' '}
          {Number.isNaN(compositeScore.value) ? 'N/A' : compositeScore.value >= 70 ? 'Healthy' : compositeScore.value >= 45 ? 'At Risk' : 'Critical'}
        </div>
      )}
    </div>
  );
}

/**
 * Epic Completion Table
 */
function EpicCompletionTable({
  epicCompletions,
  embedMode,
}: {
  epicCompletions: EpicCompletion[];
  embedMode: boolean;
}) {
  return (
    <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-lg font-medium text-gray-900">Epic Completion</h4>
        {!embedMode && <span className="text-sm text-gray-500">{epicCompletions.length} epics</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">Epic Name</th>
              <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">Status</th>
              <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">Completion</th>
              <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">Total Items</th>
              <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">Completed</th>
            </tr>
          </thead>
          <tbody>
            {epicCompletions.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 px-4 text-center text-gray-500">
                  No epics found
                </td>
              </tr>
            )}
            {epicCompletions.map((e) => (
              <tr key={e.epic.id} className="border-b border-gray-100">
                <td className="py-2 px-4 text-sm text-gray-900">{e.epic.title}</td>
                <td className="py-2 px-4">
                  {Number.isNaN(e.completionPercentage) ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <Badge
                      variant={e.status === 'on_track' ? 'clean' : e.status === 'at_risk' ? 'warning' : 'critical'}
                      label={e.status.replace('_', ' ')}
                    />
                  )}
                </td>
                <td className="py-2 px-4 text-sm text-gray-900">
                  {Number.isNaN(e.completionPercentage) ? 0 : Number(e.completionPercentage).toFixed(1)}%
                </td>
                <td className="py-2 px-4 text-sm text-gray-900">{e.epic.totalItems}</td>
                <td className="py-2 px-4 text-sm text-gray-900">{e.epic.completedItems}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!embedMode && (
        <p className="mt-4 text-xs text-gray-500">
          Status is based on expected completion percentage. Refresh to see updates.
        </p>
      )}
    </div>
  );
}