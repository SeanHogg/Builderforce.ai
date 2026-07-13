'use client';

import React, { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type {
  IntegrationStatus,
  IntegrationHealth,
} from '@/types/integration';

interface AuditDashboardProps {
  segmentId: string;
}

export function AuditDashboard({ segmentId }: AuditDashboardProps) {
  const [healthData, setHealthData] = useState<IntegrationHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchHealth();
  }, [segmentId]);

  const fetchHealth = async () => {
    try {
      const res = await fetch(`/api/v1/audit/health?segmentId=${segmentId}`);
      const data = await res.json();
      setHealthData(data);
    } catch (error) {
      console.error('Failed to fetch audit data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CONNECTED':
        return 'bg-green-100 text-green-800';
      case 'PARTIAL':
        return 'bg-yellow-100 text-yellow-800';
      case 'MISSING':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredData =
    filter === 'all'
      ? healthData
      : healthData.filter((item) => item.type === filter);

  const typeLabels = {
    source_control: 'Source Control',
    issue_tracker: 'Issue Tracker',
    communication: 'Communication',
    cicd: 'CI/CD',
    monitoring: 'Monitoring',
    calendar: 'Calendar/Project Management',
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-gray-500">Loading audit data...</div>
        </CardContent>
      </Card>
    );
  }

  const globalScore =
    healthData.length > 0
      ? Math.round(
          healthData.reduce((acc, item) => acc + item.completenessScore, 0) / healthData.length
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Summary Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Health Summary</CardTitle>
          <CardDescription>
            Global health score across all integrations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className={`text-3xl font-bold ${getScoreColor(globalScore)}`}>
                {globalScore}%
              </div>
              <div className="text-sm text-gray-500">Data Completeness Score</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {healthData.filter((h) => h.status === 'CONNECTED').length}
                </div>
                <div className="text-xs text-gray-600">Connected</div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">
                  {healthData.filter((h) => h.status === 'PARTIAL').length}
                </div>
                <div className="text-xs text-gray-600">Partial</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {healthData.filter((h) => h.status === 'MISSING').length}
                </div>
                <div className="text-xs text-gray-600">Missing</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Dashboard */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Integrations by Type</CardTitle>
              <CardDescription>
                Detailed view of integration status, gaps, and recommendations
              </CardDescription>
            </div>
            <Tabs value={filter} onValueChange={setFilter} className="w-auto">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="source-control">Source Control</TabsTrigger>
                <TabsTrigger value="issue-tracker">Issue Tracker</TabsTrigger>
                <TabsTrigger value="communication">Communication</TabsTrigger>
                <TabsTrigger value="cicd">CI/CD</TabsTrigger>
                <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {filteredData.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No integration data found for this project.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredData.map((integration) => (
                <div
                  key={integration.id}
                  className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">
                          {typeLabels[integration.type as keyof typeof typeLabels]}
                        </h3>
                        <Badge className={getStatusColor(integration.status)}>
                          {integration.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">Last sync: {integration.lastSync || 'Never'}</p>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${getScoreColor(integration.completenessScore)}`}>
                        {integration.completenessScore}%
                      </div>
                      <div className="text-xs text-gray-500">Completeness</div>
                    </div>
                  </div>

                  {/* Completeness Score */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Data Completeness</span>
                      <span className="font-medium">
                        {integration.completenessScore}%
                      </span>
                    </div>
                    <Progress value={integration.completenessScore} />
                  </div>

                  {/* Gaps */}
                  {integration.gaps.length > 0 && (
                    <Card className="border-yellow-200 bg-yellow-50 mb-4">
                      <CardContent className="pt-4">
                        <h4 className="text-sm font-semibold text-yellow-800 mb-2">
                          Identified Gaps:
                        </h4>
                        <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
                          {integration.gaps.map((gap, idx) => (
                            <li key={idx}>{gap}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {/* Recommendations */}
                  {integration.recommendations.length > 0 && (
                    <Card className="border-blue-200 bg-blue-50 mb-4">
                      <CardContent className="pt-4">
                        <h4 className="text-sm font-semibold text-blue-800 mb-2">
                          Recommendations:
                        </h4>
                        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                          {integration.recommendations.map((rec, idx) => (
                            <li key={idx}>{rec}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}