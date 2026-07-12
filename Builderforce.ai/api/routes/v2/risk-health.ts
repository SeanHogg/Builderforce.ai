/**
 * Risk Health Dashboard API — Landing point for PRD FR-2/FR-3 (score & basic drill-down).
 *
 * In scope for milestone landing (AC-1..AC-3): GET /api/v2/risk-health?q=<project_id>
 * - Aggregated counts by category (HighPriority, DependencyRisk, ExternalBlocker)
 * - Risk Health Score (0-100) + delta
 * - Paginated list of items by filter
 * - Score + category trends simulation (7d rolling)
 * - Basic current-user project-read gate
 *
 * Out of scope for this landing:
 * - Alert delivery FR-4 (immediate + digest + Slack/Teams)
 * - Historical persistence FR-5 (daily snapshots, line charts, shareable URLs)
 * - Live ingestion classification FR-1 (Jira/Linear/GitHub OAuth + rules)
 *
 * This file defines the schema placeholder for those future tasks.
 */

import { NextRequest, NextResponse } from 'next/server';

// ============================================================================
// Types (LANDING SCAFFOLD; extend in follow-ups)
// ============================================================================

export type RiskCategory = 'highPriority' | 'dependencyRisk' | 'externalBlocker';
export type RiskHealthStatus = 'healthy' | 'atRisk' | 'critical';
export type SourceSystem = 'jira' | 'linear' | 'github';
export type SortBy = 'age' | 'title' | 'lastUpdated';
export type SortOrder = 'asc' | 'desc';

// In-memory schema placeholder for ingestion FR-1 (extend with DB tables in follow-up)
export interface IntegrationConfig {
  integrationId: number;
  tenantId: number;
  projectId: number;
  source: SourceSystem;
  config: Record<string, unknown>;
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt: Date | null;
  errorReason?: string;
}

export interface RiskClassificationRule {
  ruleId: number;
  tenantId: number;
  projectId: number;
  name: string;
  conditions: {
    priorityLevels: string[];
    labels: string[];
    external: boolean;
  };
  categories: RiskCategory[];
  isActive: boolean;
  createdAt: Date;
}

// Live aggregated dashboard state (landing point; persisted by backend in follow-up)
export interface RiskHealthSummary {
  projectId: number;
  riskHealthScore: number;        // 0–100
  riskHealthStatus: RiskHealthStatus;
  highPriorityCount: number;
  dependencyRiskCount: number;
  externalBlockerCount: number;
  deltaScore: number;
  deltaHighPriorityCount: number;
  deltaDependencyRiskCount: number;
  deltaExternalBlockerCount: number;
  lastSyncAt: Date;
}

// Item from the drill-down panel
export interface RiskItem {
  itemId: string;
  title: string;
  source: SourceSystem;
  projectId: number;
  assigneeId?: string | null;
  assigneeName?: string | null;
  category: RiskCategory;
  ageDays: number;
  ageStatus: 'new' | 'slight' | 'moderate' | 'severe'; // defined by PRD SLA
  acknowledgedComment?: string | null;
  acknowledgedAt?: Date | null;
  lastUpdated: Date;
}

export interface RiskHealthItemsResponse {
  items: RiskItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface RiskHealthRequest {
  projectId: number;
  filters?: {
    team?: string[];
    sourceSystem?: SourceSystem[];
    assigneeId?: string | null;
    category?: RiskCategory[];
    acknowledged?: boolean;
    projects?: number[];
  };
  sort?: {
    sortBy: SortBy;
    sortOrder: SortOrder;
  };
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const HOURS_7 = 7 * 60 * 60 * 1000; // 7 days in milliseconds

// ============================================================================
// Simulated state (LANDING STUB; replace with DB in follow-up)
// ============================================================================

// Example incoming risk items from the ingestion source (FR-1) — cached in DB
const mockRiskItems: RiskItem[] = [
  {
    itemId: 'JIRA-101',
    title: 'Payment API integration failing with 503',
    source: 'jira',
    projectId: 11,
    assigneeId: 'user-42',
    assigneeName: 'Alice Engineer',
    category: 'highPriority',
    ageDays: 4,
    ageStatus: 'moderate',
    lastUpdated: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
  },
  {
    itemId: 'LINE-pending-55',
    title: 'Backend service degrades under load',
    source: 'linear',
    projectId: 11,
    assigneeId: 'user-192',
    assigneeName: 'Bob Senior',
    category: 'dependencyRisk',
    ageDays: 7,
    ageStatus: 'severe',
    lastUpdated: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  },
  {
    itemId: 'GITHUB-GH-203',
    title: 'Customer facing checkout flakiness at scale',
    source: 'github',
    projectId: 11,
    assigneeId: 'user-42',
    assigneeName: 'Alice Engineer',
    category: 'externalBlocker',
    ageDays: 2,
    ageStatus: 'new',
    lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
];

// Example classification rules FR-1 (saved via workspace admin UI)
const mockClassificationRules: RiskClassificationRule[] = [
  {
    ruleId: 1,
    tenantId: 1,
    projectId: 11,
    name: 'High-priority P0/P1',
    conditions: { priorityLevels: ['P0', 'P1', 'Critical', 'High'], labels: ['blocker'], external: false },
    categories: ['highPriority'],
    isActive: true,
    createdAt: new Date('2024-01-15'),
  },
  {
    ruleId: 2,
    tenantId: 1,
    projectId: 11,
    name: 'External vendor dependency',
    conditions: { priorityLevels: ['High', 'Medium'], labels: ['waiting-on-vendor'], external: true },
    categories: ['externalBlocker'],
    isActive: true,
    createdAt: new Date('2024-01-15'),
  },
];

// In-memory rubric FR-2 (weights configurable by workspace admin)
const WEIGHTRISK_HEALTH_SCORE: Record<RiskCategory, number> = {
  highPriority: 30,
  dependencyRisk: 30,
  externalBlocker: 40,
};

// Simple cache key for the landing endpoints
function cacheKey(userId: number, projectId: number): string {
  return `risk-health:${userId}:${projectId}`;
}

let riskHealthCache: Record<string, RiskHealthSummary> = {};
let riskItemsCache: Record<string, RiskItem[]> = {}; // bounded by page also

function refreshAggregatedState(userId: number, projectId: number): RiskHealthSummary {
  const key = cacheKey(userId, projectId);
  const now = new Date();

  // 1) Classify each item (FR-1) using rules — simplified stub
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  const oneWeekAgo = new Date(today.getTime() - HOURS_7);

  // Filter to items from last 7 days
  const recentItems = mockRiskItems.filter((i) => i.lastUpdated >= oneWeekAgo && i.lastUpdated <= today);

  // 2) Count by category
  const counts = {
    highPriority: recentItems.filter((i) => i.category === 'highPriority').length,
    dependencyRisk: recentItems.filter((i) => i.category === 'dependencyRisk').length,
    externalBlocker: recentItems.filter((i) => i.category === 'externalBlocker').length,
  };

  // 3) Aging penalty FR-2.3
  // default: +5 for >3 days open, +10 for >7 days open (per PRD formula)
  const penalty = recentItems.reduce((acc, item) => {
    if (item.ageDays > 7) return acc + 10;
    if (item.ageDays > 3) return acc + 5;
    return acc; // negligible penalty for <=3 days
  }, 0);

  const totalWeight = Object.values(WEIGHTRISK_HEALTH_SCORE).reduce((a, w) => a + w, 0);
  const scoreNoPenalty =
    100 - (counts.highPriority * WEIGHTRISK_HEALTH_SCORE.highPriority +
            counts.dependencyRisk * WEIGHTRISK_HEALTH_SCORE.dependencyRisk +
            counts.externalBlocker * WEIGHTRISK_HEALTH_SCORE.externalBlocker);
  const riskHealthScore = Math.max(0, Math.min(100, scoreNoPenalty - penalty));

  let status: RiskHealthStatus;
  if (riskHealthScore >= 80) status = 'healthy';
  else if (riskHealthScore >= 50) status = 'atRisk';
  else status = 'critical';

  // 4) Score delta vs previous period (compare 30 days segment vs landed period)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const monthlyItems = mockRiskItems.filter((i) => i.projectId === projectId && i.lastUpdated >= thirtyDaysAgo);
  const monthlyCounts = {
    highPriority: monthlyItems.filter((i) => i.category === 'highPriority').length,
    dependencyRisk: monthlyItems.filter((i) => i.category === 'dependencyRisk').length,
    externalBlocker: monthlyItems.filter((i) => i.category === 'externalBlocker').length,
  };
  const monthlyWeighted = monthlyCounts.highPriority * WEIGHTRISK_HEALTH_SCORE.highPriority +
                          monthlyCounts.dependencyRisk * WEIGHTRISK_HEALTH_SCORE.dependencyRisk +
                          monthlyCounts.externalBlocker * WEIGHTRISK_HEALTH_SCORE.externalBlocker;
  const monthlyScoreNoPenalty = 100 - monthlyWeighted;
  const monthlyScore = Math.max(0, Math.min(100, monthlyScoreNoPenalty - penalty));
  const deltaScore = riskHealthScore - monthlyScore;

  const deltaCounts = {
    highPriority: counts.highPriority - monthlyCounts.highPriority,
    dependencyRisk: counts.dependencyRisk - monthlyCounts.dependencyRisk,
    externalBlocker: counts.externalBlocker - monthlyCounts.externalBlocker,
  };

  const riskHealthSummary: RiskHealthSummary = {
    projectId,
    riskHealthScore,
    riskHealthStatus: status,
    highPriorityCount: counts.highPriority,
    dependencyRiskCount: counts.dependencyRisk,
    externalBlockerCount: counts.externalBlocker,
    deltaScore,
    deltaHighPriorityCount: deltaCounts.highPriority,
    deltaDependencyRiskCount: deltaCounts.dependencyRisk,
    deltaExternalBlockerCount: deltaCounts.externalBlocker,
    lastSyncAt: now,
  };

  riskHealthCache[key] = riskHealthSummary;
  return riskHealthSummary;
}

function refreshPaginatedItems(userId: number, projectId: number, params: RiskHealthRequest): RiskItem[] {
  const key = `risk-items:${userId}:${projectId}`;
  const now = new Date();

  if (!riskItemsCache[key]) {
    riskItemsCache[key] = [...mockRiskItems];
  }

  let items = riskItemsCache[key] as RiskItem[];

  // Align to params (baseline: filter + sort)
  if (params.filters?.category) {
    items = items.filter((i) => params.filters.category.includes(i.category));
  }
  if (params.filters?.sourceSystem) {
    items = items.filter((i) => params.filters.sourceSystem!.includes(i.source));
  }
  if (params.filters?.assigneeId) {
    items = items.filter((i) => i.assigneeId === params.filters.assigneeId);
  }
  if (params.filters?.acknowledged !== undefined) {
    const flag = params.filters.acknowledged;
    items = items.filter((i) => (flag === true ? i.acknowledgedAt !== null : i.acknowledgedAt === null));
  }
  if (params.filters?.projects?.length) {
    items = items.filter((i) => params.filters.projects!.includes(i.projectId));
  }
  if (params.filters?.team && items.some((i) => i.assigneeName)) {
    items = items.filter((i) => params.filters.team!.includes(i.assigneeName!));
  }

  // Sort
  const { sortBy, sortOrder } = params.sort ?? { sortBy: 'age', sortOrder: 'asc' };
  items.sort((a, b) => {
    let aVal: unknown, bVal: unknown;
    switch (sortBy) {
      case 'age': aVal = a.ageDays; bVal = b.ageDays; break;
      case 'title': aVal = a.title.toLowerCase(); bVal = b.title.toLowerCase(); break;
      case 'lastUpdated': aVal = a.lastUpdated.getTime(); bVal = b.lastUpdated.getTime(); break;
      default: aVal = a.itemId; bVal = b.itemId; break;
    }
    if (typeof aVal === 'string') {
      return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  items = riskItemsCache[key] = items; // persist filtered/sorted

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;
  const paginated = items.slice(offset, offset + pageSize);

  return paginated;
}

// ============================================================================
// GET /api/v2/risk-health
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    // In landing stub, currentUserId = pseudorandom for demo; in production:
    // const currentUserId = Number((request.nextUrl.searchParams.get('userId') ?? ...))
    const currentUserId = 101; // demo
    const projectId = Number(request.nextUrl.searchParams.get('projectId') ?? '11');

    // Validate project sanity (swept in production)
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const summaryData = refreshAggregatedState(currentUserId, projectId);

    const items = refreshPaginatedItems(currentUserId, projectId, {
      projectId,
      filters: undefined, // no filtering applied for landing drilldown
      sort: { sortBy: 'age', sortOrder: 'asc' },
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });

    const hasMore = items.length === DEFAULT_PAGE_SIZE;
    const itemsPayload: RiskHealthItemsResponse = {
      items,
      total: 20, // stub total
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      hasMore,
    };

    const backendHeaders = {
      'X-Risk-Health-Version': 'landing', // future: keep after FR-5 upgrade
    };

    return NextResponse.json(
      {
        summary: summaryData,
        items: itemsPayload,
        metadata: {
          sourceIntegrations: {
            jira: { status: 'connected', lastSyncAt: summaryData.lastSyncAt } as any,
            linear: { status: 'connected', lastSyncAt: summaryData.lastSyncAt } as any,
            github: { status: 'connected', lastSyncAt: summaryData.lastSyncAt } as any,
          },
          classificationRules: mockClassificationRules,
          staleBySeconds: 300, // landing cache TTL seconds
        },
      },
      {
        status: 200,
        headers: backendHeaders,
      }
    );
  } catch (err) {
    console.error('[risk-health]', err);
    const errorBody: Record<string, unknown> = err instanceof Error ? { error: err.message, stack: err.stack } : { error: 'Unknown error' };
    return NextResponse.json(errorBody, { status: 500 });
  }
}

// ============================================================================
// Dictionary schema placeholders (fr-1) — extend in follow-up
// ============================================================================
export interface MultiSourceRisksSchema {
  tenantId: number;
  metadata: {
    lastUpdatedAt: Date;
    integrationConfig: Record<SourceSystem, IntegrationConfig>;
    riskClassificationRules: RiskClassificationRule[];
  };
}