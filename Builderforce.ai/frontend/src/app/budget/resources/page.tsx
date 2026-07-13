'use client';

import { useState, useEffect } from 'react';

// Types based on database schema
type BudgetCategory = {
  id: number;
  category: string;
  planned_amount: number;
  actual_amount: number;
  variance: number;
  percent_consumed: number;
};

type HeadcountRole = {
  id: number;
  role_name: string;
  planned_fte: number;
  actual_fte: number;
  allocation_percent: number;
  status: 'under_allocated' | 'optimal' | 'over_allocated' | 'unfilled';
};

type AIProvider = {
  id: number;
  provider: string;
  model: string;
  monthly_cost: number;
  daily_cost: number;
  token_usage: number;
  daily_rate_limit: number;
  daily_rate_consumed: number;
  limit_remaining: boolean;
  warning_level: boolean;
};

type DashboardData = {
  budget: {
    total_budget: number;
    total_actual: number;
    eac_forecast: number;
    budget_variance: number;
    budget_variance_percent: number;
    burn_rate_2_week: number;
    runway_doi: string;
    rag_status: 'green' | 'amber' | 'red';
    categories: BudgetCategory[];
  };
  headcount: {
    total_plan_fte: number;
    total_actual_fte: number;
    allocation_gap: number;
    roles: HeadcountRole[];
    rag_status: 'green' | 'amber' | 'red';
  };
  ai: {
    total_cost_month: number;
    total_cost_last_7_days: number;
    providers: AIProvider[];
    rag_status: 'green' | 'amber' | 'red';
  };
  top_risks: Array<{
    id: number;
    title: string;
    severity: 'high' | 'medium' | 'low';
    type: 'budget' | 'headcount' | 'ai';
    description: string;
  }>;
};

export default function BudgetResourcesDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/budget/resources/dashboard');
      if (!response.ok) throw new Error('Failed to fetch dashboard data');
      const data = await response.json();
      setData(data);
    } catch (error) {
      console.error('Error fetching budget resources data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p>Loading Budget & Resources Dashboard...</p>
      </div>
    );
  }

  const getRagBadgeColor = (status: string) => {
    switch (status) {
      case 'green': return 'bg-green-100 text-green-800 border-green-300';
      case 'amber': return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'red': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Budget & Resources Dashboard</h1>
          <p className="mt-2 text-gray-600">Real-time budget variance, headcount planning, and AI resource tracking</p>
        </div>

        {/* Executive Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Budget RAG */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Budget Health</p>
                <p className="text-2xl font-bold text-gray-900 capitalize">{data.budget.rag_status}</p>
              </div>
              <span className={`px-3 py-1 rounded-full border text-sm font-medium ${getRagBadgeColor(data.budget.rag_status)}`}>
                {data.budget.rag_status.toUpperCase()}
              </span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Budget variance</span>
                <span className={`font-semibold ${data.budget.budget_variance_percent >= 5 ? 'text-red-600' : 'text-gray-900'}`}>
                  {data.budget.budget_variance_percent >= 0 ? '+' : ''}{data.budget.budget_variance_percent.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Headcount RAG */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Headcount Health</p>
                <p className="text-2xl font-bold text-gray-900 capitalize">{data.headcount.rag_status}</p>
              </div>
              <span className={`px-3 py-1 rounded-full border text-sm font-medium ${getRagBadgeColor(data.headcount.rag_status)}`}>
                {data.headcount.rag_status.toUpperCase()}
              </span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Allocation gap</span>
                <span className="font-semibold text-gray-900">
                  {data.headcount.allocation_gap > 0 ? `+${data.headcount.allocation_gap.toFixed(2)} FTE` : '0 FTE'}
                </span>
              </div>
            </div>
          </div>

          {/* AI Resource RAG */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">AI Resource Health</p>
                <p className="text-2xl font-bold text-gray-900 capitalize">{data.ai.rag_status}</p>
              </div>
              <span className={`px-3 py-1 rounded-full border text-sm font-medium ${getRagBadgeColor(data.ai.rag_status)}`}>
                {data.ai.rag_status.toUpperCase()}
              </span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Last 7 days cost</span>
                <span className="font-semibold text-gray-900">${data.ai.total_cost_last_7_days.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Budget Section */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Budget Overview</h2>
              <button
                onClick={() => {
                  setSelectedCategory(null);
                  setSelectedRole(null);
                  setSelectedProvider(null);
                }}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800"
              >
                ← Reset View
              </button>
            </div>

            {!selectedCategory ? (
              <div className="p-6">
                <div className="mb-6">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-gray-50 rounded p-4">
                      <p className="text-sm text-gray-600">Total Budget</p>
                      <p className="text-2xl font-bold text-gray-900">${data.budget.total_budget.toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-4">
                      <p className="text-sm text-gray-600">Total Actuals</p>
                      <p className="text-2xl font-bold text-gray-900">${data.budget.total_actual.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded p-4 mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-600">Budget Variance</span>
                      <span className={`text-sm font-bold ${data.budget.budget_variance >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {data.budget.budget_variance >= 0 ? '+' : ''}${data.budget.budget_variance.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full ${
                          data.budget.percent_consumed > 100 ? 'bg-red-600' :
                          data.budget.percent_consumed > 75 ? 'bg-amber-500' : 'bg-green-600'
                        }`}
                        style={{ width: `${Math.min(data.budget.percent_consumed, 100)}%` }}
                      ></div>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">
                      {data.budget.percent_consumed.toFixed(2)}% consumed
                    </p>
                  </div>

                  <div className="bg-gray-50 rounded p-4">
                    <p className="text-sm text-gray-600 mb-2">EAC Forecast</p>
                    <p className="text-2xl font-bold text-gray-900">${data.budget.eac_forecast.toLocaleString()}</p>
                    <p className="mt-1 text-sm">
                      {data.budget.budget_variance_percent >= 5 ? '⚠️ Exceeds budget threshold' : 'On track'}
                    </p>
                  </div>
                </div>

                <hr className="my-6 border-gray-200" />

                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-md font-medium text-gray-900">Cost Categories</h3>
                </div>

                <div className="space-y-4">
                  {data.budget.categories.map((category) => (
                    <div
                      key={category.id}
                      className="border rounded-lg p-4 hover:shadow-md cursor-pointer transition"
                      onClick={() => setSelectedCategory(category.category)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{category.category}</p>
                          <p className="text-sm text-gray-600">{category.line_item_name}</p>
                        </div>
                        <button className="text-blue-600 hover:text-blue-800">
                          View →
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Planned</p>
                          <p className="font-semibold text-gray-900">${category.planned_amount.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Actual</p>
                          <p className="font-semibold text-gray-900">${category.actual_amount.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Variance</p>
                          <p
                            className={`font-semibold ${
                              category.variance >= 0 ? 'text-red-600' : 'text-green-600'
                            }`}
                          >
                            {category.variance >= 0 ? '+' : ''}${category.variance.toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full ${
                              category.percent_consumed > 100 ? 'bg-red-600' :
                              category.percent_consumed > 75 ? 'bg-amber-500' : 'bg-green-600'
                            }`}
                            style={{ width: `${Math.min(category.percent_consumed, 100)}%` }}
                          ></div>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {category.percent_consumed.toFixed(2)}% consumed
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="text-sm text-blue-600 hover:text-blue-800 mb-4"
                >
                  ← Back to Overview
                </button>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Drill Down: {selectedCategory}
                </h3>
                <p className="mb-4 text-gray-600">
                  Drill-down view for {selectedCategory} - integration endpoint to be implemented with actual line-item data.
                </p>
                
                <div className="border rounded-lg p-4 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    Line-item level detail table would display here for {selectedCategory} including vendor, invoice details, payment status, and audit notes.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Headcount Section */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Headcount Planning</h2>
              <button
                onClick={() => {
                  setSelectedRole(null);
                  setSelectedProvider(null);
                }}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800"
              >
                ← Reset View
              </button>
            </div>

            {!selectedRole ? (
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-50 rounded p-4">
                    <p className="text-sm text-gray-600">Total Planned FTE</p>
                    <p className="text-2xl font-bold text-gray-900">{data.headcount.total_plan_fte.toFixed(2)}</p>
                  </div>
                  <div className="bg-gray-50 rounded p-4">
                    <p className="text-sm text-gray-600">Total Actual FTE</p>
                    <p className="text-2xl font-bold text-gray-900">{data.headcount.total_actual_fte.toFixed(2)}</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded p-4 mb-6">
                  <p className="text-sm text-gray-600 mb-2">Demand Forecast - Next 2 Weeks</p>
                  <p className="text-lg font-bold text-gray-900">
                    {data.headcount.roles
                      .filter(role => role.status === 'under_allocated')
                      .reduce((sum, role) => sum + role.planned_fte - role.actual_fte, 0)
                      .toFixed(2)} FTE needed by un-allocated roles
                  </p>
                </div>

                <div className="space-y-4">
                  {data.headcount.roles.map((role) => (
                    <div
                      key={role.id}
                      className="border rounded-lg p-4 hover:shadow-md cursor-pointer transition"
                      onClick={() => setSelectedRole(role.role_name)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{role.role_name}</p>
                          <div className="mt-1 flex gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                role.status === 'under_allocated' ? 'bg-red-100 text-red-800' :
                                role.status === 'over_allocated' ? 'bg-amber-100 text-amber-800' :
                                role.status === 'unfilled' ? 'bg-gray-100 text-gray-800' :
                                'bg-green-100 text-green-800'
                              }`}
                            >
                              {role.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <button className="text-blue-600 hover:text-blue-800">
                          View →
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Planned</p>
                          <p className="font-semibold text-gray-900">{role.planned_fte.toFixed(2)} FTE</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Assigned</p>
                          <p className="font-semibold text-gray-900">{role.actual_fte.toFixed(2)} FTE</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Utilization</p>
                          <p
                            className={`font-semibold ${
                              role.allocation_percent < 50 ? 'text-red-600' :
                              role.allocation_percent > 100 ? 'text-amber-600' : 'text-green-600'
                            }`}
                          >
                            {role.allocation_percent.toFixed(0)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6">
                <button
                  onClick={() => setSelectedRole(null)}
                  className="text-sm text-blue-600 hover:text-blue-800 mb-4"
                >
                  ← Back to Overview
                </button>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Drill Down: {selectedRole}
                </h3>
                <p className="mb-4 text-gray-600">
                  Detailed view for {selectedRole} including person assignments, utilization distribution, timesheet data, and availability schedules.
                </p>

                <div className="border rounded-lg p-4 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    Full person roster table would display here showing assigned team members, their allocations, utilization rate against project commitments, and upcoming leave/time-off scheduling.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* AI Resources Section */}
          <div className="bg-white rounded-lg shadow lg:col-span-2">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">AI Resource Usage & Monitoring</h2>
              <button
                onClick={() => setSelectedProvider(null)}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800"
              >
                ← Reset View
              </button>
            </div>

            {!selectedProvider ? (
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-50 rounded p-4">
                    <p className="text-sm text-gray-600">Monthly Cost (YTD)</p>
                    <p className="text-2xl font-bold text-gray-900">${data.ai.total_cost_month.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 rounded p-4">
                    <p className="text-sm text-gray-600">Last 7 Days</p>
                    <p className="text-2xl font-bold text-gray-900">${data.ai.total_cost_last_7_days.toFixed(2)}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {data.ai.providers.map((provider) => (
                    <div
                      key={provider.id}
                      className="border rounded-lg p-4 hover:shadow-md cursor-pointer transition"
                      onClick={() => setSelectedProvider(provider.provider)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{provider.provider}</p>
                          <p className="text-sm text-gray-600">{provider.model}</p>
                        </div>
                        <button className="text-blue-600 hover:text-blue-800">
                          View →
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Daily Cost</p>
                          <p className="font-semibold text-gray-900">${provider.daily_cost.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Daily Tokens</p>
                          <p className="font-semibold text-gray-900">
                            {(provider.daily_rate_consumed / 1000).toFixed(0)}K
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Rate Limit</p>
                          <p
                            className={`font-semibold ${
                              provider.limit_remaining ? 'text-gray-900' : 'text-red-600'
                            }`}
                          >
                            {provider.limit_remaining ? 'Active' : 'Exceeded'}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Alert Status</p>
                          <p
                            className={`font-semibold ${
                              provider.warning_level ? 'text-amber-600' : 'text-green-600'
                            }`}
                          >
                            {provider.warning_level ? '⚠️ Warning' : 'OK'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full ${
                              provider.warning_level ? 'bg-amber-500' :
                              provider.limit_remaining ? 'bg-green-600' : 'bg-red-600'
                            }`}
                            style={{ width: `${(provider.daily_rate_consumed / provider.daily_rate_limit) * 100}%` }}
                          ></div>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {((provider.daily_rate_limit - provider.daily_rate_consumed) / provider.daily_rate_limit * 100).toFixed(1)}%
                          remaining today
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6">
                <button
                  onClick={() => setSelectedProvider(null)}
                  className="text-sm text-blue-600 hover:text-blue-800 mb-4"
                >
                  ← Back to Overview
                </button>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Drill Down: {selectedProvider}
                </h3>
                <p className="mb-4 text-gray-600">
                  Detailed view for {selectedProvider} API including API cost attribution by team/feature, token usage breakdown per model family, cost-per-task or cost-per-output-unit metrics, and trend charts over time.
                </p>

                <div className="border rounded-lg p-4 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    Detailed usage tables, API endpoint breakdown, cost attribution to features or teams, and efficiency metrics table would display here.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top Risks Alert */}
        <div className="mt-8 bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Top 3 Risks</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {data.top_risks.slice(0, 3).map((risk) => (
                <div
                  key={risk.id}
                  className={`border-l-4 ${
                    risk.severity === 'high' ? 'border-red-600' :
                    risk.severity === 'medium' ? 'border-amber-600' : 'border-gray-400'
                  } bg-gray-50 rounded-r-lg p-4`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
                          risk.type === 'budget' ? 'bg-blue-100 text-blue-800' :
                          risk.type === 'headcount' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {risk.type}
                        </span>
                        <span className={`text-sm font-medium ${
                          risk.severity === 'high' ? 'text-red-700' :
                          risk.severity === 'medium' ? 'text-amber-700' : 'text-gray-700'
                        }`}>
                          {risk.severity}
                        </span>
                      </div>
                      <h3 className="text-md font-semibold text-gray-900">{risk.title}</h3>
                      <p className="mt-1 text-sm text-gray-600">{risk.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}