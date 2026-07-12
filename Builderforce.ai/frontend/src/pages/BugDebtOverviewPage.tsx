/**
 * Bug Debt Overview Page
 * 
 * Dedicated route for the Bug Debt Overview dashboard.
 * 
 * Routes:
 * - /bug-debt
 */

import React from 'react';
import { BugDebtOverview } from '../components/bugDebt/BugDebtOverview';
import { FastBackward, RefreshCw } from 'lucide-react';

interface BugDebtOverviewPageProps {
  period?: 'week' | 'month';
}

export const BugDebtOverviewPage: React.FC<BugDebtOverviewPageProps> = ({
  period = 'week',
}) => {
  const handleRefresh = () => {
    // In a real app, this would trigger a refetch or refresh the data
    console.log('Refreshing bug debt data...');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-2 bg-red-100 rounded-lg">
              <FastBackward className="w-6 h-6 text-red-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Bug Debt Overview</h1>
          </div>
          <p className="text-gray-600">
            Monitor your open bug backlog, track severity trends, and identify aging issues.
          </p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Data
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>maintenance interval:</span>
            <span className="font-semibold text-gray-900">5 minutes</span>
          </div>
        </div>

        {/* Error Boundary (would wrap child components in production) */}
        <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
          <BugDebtOverview period={period} />
        </div>

        {/* Usage Notes */}
        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-900 mb-2">About This Dashboard</h3>
          <div className="prose prose-sm text-gray-600 space-y-4">
            <div>
              <p>
                <strong>Scope:</strong> This dashboard displays an aggregated overview of open bugs
                from integrated bug tracking systems.
              </p>
            </div>
            <div>
              <p>
                <strong>Data Source:</strong> In production, connect to Jira, GitHub Issues,
                or other bug tracking platforms via their APIs.
              </p>
            </div>
            <div>
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>Total Bugs:</strong> Number of open bugs currently in the system</li>
                <li><strong>By Severity:</strong> Distribution of bugs across Critical, High, Medium, and Low severity levels</li>
                <li><strong>By Age:</strong> Bugs grouped by time since creation (less than 7 days, 7-30 days, 30-90 days, more than 90 days)</li>
                <li><strong>Trend Analysis:</strong> Percentage change compared to the previous period (week or month)</li>
              </ul>
            </div>
            <div>
              <p>
                <strong>Limitations:</strong> This view is read-only; individual bug details and
                management actions are not included as per scope.
              </p>
            </div>
          </div>
        </div>

        {/* Usage Example */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="text-sm font-medium text-blue-900 mb-3">Usage Example</h3>
          <pre className="text-xs bg-blue-100 p-4 rounded-lg overflow-x-auto">
            {`// Import the component
import { BugDebtOverviewPage } from '@/components/bugDebt/BugDebtOverviewPage';

// Use it in your routing setup
<Route path="/bug-debt" element={<BugDebtOverviewPage />} />
<Route path="/bug-debt" element={<BugDebtOverviewPage period="month" />} />`}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default BugDebtOverviewPage;