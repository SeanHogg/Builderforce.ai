/**
 * Risk Health Dashboard client — typed Fetch wrappers for the landing GET /api/v2/risk-health endpoint.
 *
 * Provides summaries, item lists, and utilities to consume the score (FR-2) and drill-down (FR-3).
 */

import { useCallback, useState } from 'react';
import type {
  RiskCategory,
  RiskHealthStatus,
  SourceSystem,
  RiskHealthSummary,
  RiskHealthRequest,
  RiskHealthItemsResponse,
  RiskItem,
  IntegrationConfig,
  RiskClassificationRule,
} from './api/risk/types';

const API_BASE_PATH = '/api/v2';

const API_BASE_PATH = '/api/v2';

export interface RiskHealthApiResponse {
  summary: RiskHealthSummary;
  items: RiskHealthItemsResponse;
  metadata: {
    sourceIntegrations: Record<SourceSystem, IntegrationConfig>;
    classificationRules: RiskClassificationRule[];
    staleBySeconds: number;
  };
}

const DEFAULT_PROJECT_ID = 11;

export async function getRiskHealth(requestParams: { projectId: number; filters?: RiskHealthRequest['filters'] }): Promise<RiskHealthApiResponse> {
  const params = new URLSearchParams({ projectId: String(requestParams.projectId) });
  if (requestParams.filters) {
    if (requestParams.filters.team?.length) params.append('team', requestParams.filters.team.join(','));
    if (requestParams.filters.sourceSystem?.length) params.append('sourceSystem', requestParams.filters.sourceSystem.join(','));
  }
  const resp = await fetch(`${API_BASE_PATH}/risk-health?q=${encodeURIComponent(params.toString())}`);
  if (!resp.ok) throw new Error(`Risk health fetch failed: ${resp.statusText}`);
  return resp.json();
}

export async function getRiskHealthSummary(projectId: number = DEFAULT_PROJECT_ID): Promise<RiskHealthSummary> {
  const { summary } = await getRiskHealth({ projectId });
  return summary;
}

export async function getRiskHealthItems(
  projectId: number = DEFAULT_PROJECT_ID,
  page: number = 1,
  pageSize: number = 50,
  filters?: RiskHealthRequest['filters'],
  sort?: RiskHealthRequest['sort']
): Promise<RiskHealthItemsResponse> {
  const params = new URLSearchParams({ projectId: String(projectId), page: String(page), pageSize: String(pageSize) });
  if (filters?.category?.length) params.append('category', filters.category.join(','));
  if (filters?.sourceSystem?.length) params.append('sourceSystem', filters.sourceSystem.join(','));
  if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
  if (filters?.acknowledged !== undefined) params.append('acknowledged', String(filters.acknowledged));
  if (filters?.projects?.length) params.append('projects', filters.projects.join(','));
  if (filters?.team?.length) params.append('team', filters.team.join(','));
  if (sort?.sortBy) params.append('sortBy', sort.sortBy);
  if (sort?.sortOrder) params.append('sortOrder', sort.sortOrder);

  const url = `${API_BASE_PATH}/risk-health?q=${encodeURIComponent(params.toString())}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Risk health items fetch failed: ${resp.statusText}`);
  const data = (await resp.json()) as RiskHealthApiResponse;
  return data.items;
}

// ============================================================================
// Local helpers for score + category names
// ============================================================================

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  highPriority: 'High Priority',
  dependencyRisk: 'Dependency Risk',
  externalBlocker: 'External Blocker',
};

export const RISK_HEALTH_LABELS: Record<RiskHealthStatus, string> = {
  healthy: 'Healthy',
  atRisk: 'At Risk',
  critical: 'Critical',
};

export const RISK_HEALTH_COLORS: Record<RiskHealthStatus, string> = {
  healthy: '#22c55e', // green
  atRisk: '#eab308',   // yellow
  critical: '#ef4444', // red
};

export const AGE_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  slight: 'Slight',
  moderate: 'Moderate',
  severe: 'Severe',
};

// Utilities for filtering + multi-select UX
export const useRiskFilters = (
  projectId: number,
  projectOptions: readonly { label: string; value: number }[],
  sourceOptions: readonly { label: string; value: SourceSystem }[],
) => {
  const [filters, setFilters] = useState<NonNullable<RiskHealthRequest['filters']>>({});
  const [sortBy, setSortBy] = useState<RiskHealthRequest['sort']['sortBy']>('age');
  const [sortOrder, setSortOrder] = useState<RiskHealthRequest['sort']['sortOrder']>('asc');

  // Reuse frontend debounce if placed in hook file
  const applyFilters = useCallback(async () => {
    const newState: RiskHealthRequest['filters'] = {};

    if (filters.team?.length) newState.team = filters.team;
    if (filters.sourceSystem?.length) newState.sourceSystem = filters.sourceSystem;
    if (filters.assigneeId) newState.assigneeId = filters.assigneeId;
    if (filters.category?.length) newState.category = filters.category;
    if (filters.projects?.length) newState.projects = filters.projects;
    filters.acknowledged && (newState.acknowledged = filters.acknowledged);

    const req: RiskHealthRequest = {
      projectId,
      filters: newState,
      sort: { sortBy, sortOrder },
      page: 1,
      pageSize: 50,
    };

    await getRiskHealthItems(projectId, 1, 50, newState, { sortBy, sortOrder });
  }, [projectId, filters, sortBy, sortOrder]);

  return { filters, setFilters, sortBy, setSortBy, sortOrder, setSortOrder, applyFilters };
};

// ============================================================================
// Sparkline helpers (simulated line chart data)
// ============================================================================

export interface HistoryPoint {
  date: string;
  score: number; // 0–100
  highPriorityCount: number;
  dependencyRiskCount: number;
  externalBlockerCount: number;
}

export const simulateHistory = (days: number = 7): HistoryPoint[] => {
  const arr: HistoryPoint[] = [];
  const now = new Date(Date.now() - days * 24 * 60 * 60 * 1000); // offset start

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    const formatted = date.toISOString().split('T')[0];
    // Simulated with random walk
    const baseScore = 60;
    const noise = Math.floor(Math.random() * 15);
    // Flip occasionally
    const trend = i < days / 2 ? -5 : 5;
    const score = clamp(baseScore + trend + noise, 0, 100);

    const high = clamp(Math.floor(Math.random() * 7), 0, 20);
    const dependency = clamp(Math.floor(Math.random() * 5), 0, 15);
    const external = clamp(Math.floor(Math.random() * 4), 0, 10);

    arr.push({ date: formatted, score, highPriorityCount: high, dependencyRiskCount: dependency, externalBlockerCount: external });
  }

  return arr;
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

export const formatTrendPercentage = (delta: number): string => {
  if (delta === 0) return '0.0%';

  const abs = Math.abs(delta);
  const sign = delta > 0 ? '+' : '';

  // Format with one decimal place; strip trailing zero
  let formatted = `${sign}${abs.toFixed(1)}%`;
  if (formatted.endsWith('.0%')) formatted = formatted.slice(0, -2) + '%';

  return formatted;
};

// ============================================================================
// Type guards and validation helpers (simple)
// ============================================================================

export function isRiskCategory(category: string): category is RiskCategory {
  return ['highPriority', 'dependencyRisk', 'externalBlocker'].includes(category);
}

export function isRiskHealthStatus(status: string): status is RiskHealthStatus {
  return ['healthy', 'atRisk', 'critical'].includes(status);
}