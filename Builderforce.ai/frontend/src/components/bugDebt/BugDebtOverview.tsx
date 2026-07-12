/**
 * Bug Debt Overview Dashboard Component
 * 
 * Displays open bugs by severity, age, and trends.
 * 
 * Features:
 * - Total open bugs with trend indicator
 * - Bugs by severity (pie/bar chart)
 * - Bugs by age (bar chart)
 * - Trend analysis per severity
 */

import React, { useState, useEffect } from 'react';
import {
  BugDebtOverview as BugDebtData,
  bugDebtService,
} from '../../api/bugDebt.service';
import { SeverityBadge, AgeBadge, TrendBadge } from './Badge';

// Component Props
interface BugDebtOverviewProps {
  className?: string;
  period?: 'week' | 'month';
}

/**
 * Format a number to a readable string (e.g., "123", "1.2K")
 */
function formatNumber(num: number): string {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return String(num);
}

// Mini chart components for trend indicators
const TrendBar: React.FC<{ value: number; max: number; color?: string }> = ({ value, max, color = 'blue' }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className="h-full bg-current transition-all duration-500 ease-out"
        style={{ width: `${Math.max(percentage, 2)}%`, color }}
      />
    </div>
  );
};

/**
 * Main Bug Debt Overview Dashboard
 */
export const BugDebtOverview: React.FC<BugDebtOverviewProps> = ({
  className = '',
  period = 'week',
}) => {
  const [data, setData] = useState<BugDebtData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const overview = await bugDebtService.getOverview(period);
        setData(overview);
        // Refresh data every 5 minutes
        const intervalId = setInterval(
          () => bugDebtService.getOverview(period).then(setData),
          5 * 60 * 1000
        );
        return () => clearInterval(intervalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bug debt data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [period]);

  if (loading) {
    return (
      <div className={`w-full p-8 bg-white rounded-xl shadow-sm border border-gray-200 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
        <p className="text-center text-gray-500 mt-4">Loading bug debt overview...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className={`w-full p-8 bg-red-50 rounded-xl shadow-sm border border-red-200 ${className}`}
      >
        <div className="flex items-center">
          <svg
            className="w-6 h-6 text-red-600 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h3 className="font-semibold text-red-800">Error loading data</h3>
            <p className="text-sm text-red-600">{error || 'Unknown error occurred'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bug Debt Overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            Total open bugs: <span className="font-semibold text-gray-900">
              {data.totalOpenBugs.current}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 bg-gray-100 rounded-md text-sm text-gray-600">
            Last updated: {new Date(data.lastUpdated).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Trend Indicator */}
      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="flex-1">
          <p className="text-sm text-gray-600">Overall Trend</p>
          <p
            className={`text-lg font-semibold ${
              data.totalOpenBugs.percentageChange > 0
                ? 'text-green-600'
                : data.totalOpenBugs.percentageChange < 0
                ? 'text-red-600'
                : 'text-gray-600'
            }`}
          >
            {data.totalOpenBugs.percentageChange > 0 ? '↑' : data.totalOpenBugs.percentageChange < 0 ? '↓' : '-'}{' '}
            {Math.abs(data.totalOpenBugs.percentageChange)}% vs.{' '}
            {data.dataSource}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Current / Previous:</span>
          <span className="font-mono text-gray-900">
            {data.totalOpenBugs.current}
            <span className="text-gray-400 mx-1">/</span>
            {data.totalOpenBugs.previous}
          </span>
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-200">
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Bugs by Severity</h2>
        </div>
        <div className="p-4 space-y-4">
          {['Critical', 'High', 'Medium', 'Low'].map((severity) => {
            const trend = data.bySeverity[severity];
            const percentageChange = trend.percentageChange;
            const isGrowing = trend.change > 0;
            
            return (
              <div key={severity} className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-3">
                  <p className="text-sm font-medium text-gray-600 capitalize">{severity}</p>
                </div>
                <div className="col-span-2 text-center">
                  <div className={severity === 'Critical' ? 'text-red-600' : severity === 'High' ? 'text-orange-600' : severity === 'Medium' ? 'text-yellow-600' : 'text-blue-600'}>
                    <TrendBadge trend={trend.percentageChange > 0 ? 'up' : trend.percentageChange < 0 ? 'down' : 'stable'} />
                  </div>
                </div>
                <div className="col-span-3 flex items-center justify-center gap-2">
                  <span className="text-gray-500">:</span>
                  <span className="text-gray-500">/</span>
                </div>
                <div className="col-span-2">
                  <p className="text-sm font-medium text-gray-900">{trend.previous}</p>
                </div>
                <div className="col-span-2 font-mono text-lg font-semibold">
                  {trend.current}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Age Distribution */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-200">
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Bugs by Age</h2>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-3">
              <p className="text-sm font-medium text-gray-600">&lt; 7 days</p>
            </div>
            <div className="col-span-3">
              <div className="h-6">{<TrendBar value={data.byAge.lessThan7Days} max={data.byAge.total} color="#22c55e" />}</div>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-lg font-semibold text-gray-900">
                {data.byAge.lessThan7Days}
              </p>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-sm text-gray-500">
                {data.byAge.total > 0
                  ? Math.round((data.byAge.lessThan7Days / data.byAge.total) * 100)
                  : 0}
                %
              </p>
            </div>
            <div className="col-span-2"></div>
          </div>

          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-3">
              <p className="text-sm font-medium text-gray-600">7-30 days</p>
            </div>
            <div className="col-span-3">
              <div className="h-6">{<TrendBar value={data.byAge.between7And30Days} max={data.byAge.total} color="#eab308" />}</div>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-lg font-semibold text-gray-900">
                {data.byAge.between7And30Days}
              </p>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-sm text-gray-500">
                {data.byAge.total > 0
                  ? Math.round((data.byAge.between7And30Days / data.byAge.total) * 100)
                  : 0}
                %
              </p>
            </div>
            <div className="col-span-2"></div>
          </div>

          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-3">
              <p className="text-sm font-medium text-gray-600">30-90 days</p>
            </div>
            <div className="col-span-3">
              <div className="h-6">{<TrendBar value={data.byAge.between30And90Days} max={data.byAge.total} color="#f97316" />}</div>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-lg font-semibold text-gray-900">
                {data.byAge.between30And90Days}
              </p>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-sm text-gray-500">
                {data.byAge.total > 0
                  ? Math.round((data.byAge.between30And90Days / data.byAge.total) * 100)
                  : 0}
                %
              </p>
            </div>
            <div className="col-span-2"></div>
          </div>

          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-3">
              <p className="text-sm font-medium text-gray-600">&gt; 90 days</p>
            </div>
            <div className="col-span-3">
              <div className="h-6">{<TrendBar value={data.byAge.moreThan90Days} max={data.byAge.total} color="#ef4444" />}</div>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-lg font-semibold text-gray-900">
                {data.byAge.moreThan90Days}
              </p>
            </div>
            <div className="col-span-2 text-right">
              <p className="text-sm text-gray-500">
                {data.byAge.total > 0
                  ? Math.round((data.byAge.moreThan90Days / data.byAge.total) * 100)
                  : 0}
                %
              </p>
            </div>
            <div className="col-span-2"></div>
          </sub>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded"></div>
          <span>< 7 days</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-500 rounded"></div>
          <span>7-30 days</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-orange-500 rounded"></div>
          <span>30-90 days</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded"></div>
          <span>> 90 days</span>
        </div>
      </div>
    </div>
  );
};

export default BugDebtOverview;