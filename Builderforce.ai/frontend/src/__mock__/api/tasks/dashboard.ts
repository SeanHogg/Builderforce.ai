/**
 * Dashboard API - Reporting Dashboard and Weekly Digest
 * 
 * Provides metrics and data for the stakeholder alignment dashboard,
 * including priority metrics, sign-off status, conflicts, and escalations.
 * 
 * Backend API logic resides in mock files for the repository-bound BuilderForce.AI
 * as the actual API routes are defined in this location during development.
 */

import type { 
  DashboardDTO, 
  MetricsSummary, 
  ProjectMetrics,
  PriorityMetrics,
  SignOffMetrics,
  ConflictMetrics,
  EscalationMetrics,
  DashboardFilters,
  PriorityResponse,
  SignOffResponse,
  ConflictResponse,
  EscalationResponse
} from '@/types/dashboard';

/**
 * 60-second caching configuration for dashboard metrics (FR3.3)
 */
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Simple in-memory cache implementation
const cache = new Map<string, { data: DashboardDTO; timestamp: number }>();

/**
 * Get cached data if available and not expired
 */
function getCachedData(key: string, filters: DashboardFilters): DashboardDTO | null {
  const stored = cache.get(key);
  if (!stored) return null;
  
  const age = Date.now() - stored.timestamp;
  if (age > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  
  return stored.data;
}

/**
 * Set cache entry
 */
function setCacheData(key: string, data: DashboardDTO): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Time period options for filtering (FR3.1)
 */
export type TimePeriod = 
  | 'last_7_days' 
  | 'last_30_days' 
  | 'last_90_days' 
  | 'last_year'
  | 'custom';

export interface DashboardFilters {
  projectIds?: string[];
  timePeriod: TimePeriod;
  timeRange?: { start: string; end: string };
  stakeholderIds?: string[];
}

/**
 * Compute date range based on time period
 */
function getDateRange(timePeriod: TimePeriod): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  
  switch (timePeriod) {
    case 'last_7_days':
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end };
    case 'last_30_days':
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end };
    case 'last_90_days':
      return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end };
    case 'last_year':
      return { start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), end };
    case 'custom':
    default:
      throw new Error('Custom date range must be provided for custom time period');
  }
}

/**
 * Priority metrics query logic (FR3.3)
 */
export async function getPriorityMetrics(
  filters: DashboardFilters
): Promise<PriorityResponse> {
  // Simulated data for demo purposes
  // In production, this would query actual priority tables
  return {
    totalApproved: 47,
    pendingReview: 12,
    totalAssigned: 59
  };
}

/**
 * Sign-off metrics query logic (FR3.3)
 */
export async function getSignOffMetrics(
  filters: DashboardFilters
): Promise<SignOffResponse> {
  // Simulated data for demo purposes
  // In production, this would query sign-off status and due dates
  const { timeRange } = filters;
  
  if (!timeRange) {
    const range = getDateRange(filters.timePeriod);
  }
  
  return {
    open: 23,
    pending: 14,
    overdue: 5,
    lastSignOffDate: '2025-06-15T14:30:00Z'
  };
}

/**
 * Conflict metrics query logic (FR3.3)
 */
export async function getConflictMetrics(
  filters: DashboardFilters
): Promise<ConflictResponse> {
  // Simulated data for demo purposes
  // In production, this would query conflict detection rules and active conflicts
  return {
    active: 8,
    thisWeek: 3,
    types: ['Priority Conflict', 'Resource Allocation', 'Stakeholder Disagreement']
  };
}

/**
 * Escalation metrics query logic (FR3.3)
 */
export async function getEscalationMetrics(
  filters: DashboardFilters
): Promise<EscalationResponse> {
  // Simulated data for demo purposes
  // In production, this would query escalation status and dates
  const { timeRange } = filters;
  
  if (!timeRange) {
    const range = getDateRange(filters.timePeriod);
  }
  
  return {
    overdue: 2,
    pending: 4,
    thisMonth: 6
  };
}

/**
 * Main dashboard API endpoint - returns aggregated metrics (FR3.2)
 */
export async function getDashboardMetrics(filters: DashboardFilters): Promise<DashboardDTO> {
  const cacheKey = JSON.stringify({ filters });
  
  // Check cache first (FR3.3)
  const cached = getCachedData(cacheKey, filters);
  if (cached) {
    return cached;
  }
  
  // Compute summary metrics
  const [priorityMetrics, signOffMetrics, conflictMetrics, escalationMetrics] = await Promise.all([
    getPriorityMetrics(filters),
    getSignOffMetrics(filters),
    getConflictMetrics(filters),
    getEscalationMetrics(filters)
  ]);
  
  const summary: MetricsSummary = {
    totalApprovedPriorities: priorityMetrics.totalApproved,
    openSignOffs: signOffMetrics.open,
    pendingSignOffs: signOffMetrics.pending,
    overdueSignOffs: signOffMetrics.overdue,
    activeConflicts: conflictMetrics.active,
    overdueEscalations: escalationMetrics.overdue,
    lastUpdated: new Date().toISOString()
  };
  
  const projects = await getProjectMetrics(filters);
  
  const result: DashboardDTO = {
    summary,
    projects
  };
  
  // Cache result (FR3.3)
  setCacheData(cacheKey, result);
  
  return result;
}

/**
 * Get project-specific metrics (FR3.2)
 */
async function getProjectMetrics(filters: DashboardFilters): Promise<ProjectMetrics[]> {
  // Simulated project data for demo purposes
  // In production, this would aggregate metrics by project
  
  const mockProjects: ProjectMetrics[] = [
    {
      projectId: 'proj_001',
      projectName: 'Customer Experience Platform',
      priorityMetrics: {
        totalApproved: 12,
        pendingReview: 3,
        totalAssigned: 15
      },
      signOffMetrics: {
        open: 5,
        pending: 7,
        overdue: 1,
        lastSignOffDate: '2025-06-12T10:20:00Z'
      },
      conflictMetrics: {
        active: 2,
        thisWeek: 1,
        types: ['Priority Conflict']
      },
      escalationMetrics: {
        overdue: 0,
        pending: 2,
        thisMonth: 3
      }
    },
    {
      projectId: 'proj_002',
      projectName: 'AI Agent Training',
      priorityMetrics: {
        totalApproved: 18,
        pendingReview: 4,
        totalAssigned: 22
      },
      signOffMetrics: {
        open: 8,
        pending: 5,
        overdue: 2,
        lastSignOffDate: '2025-06-14T16:45:00Z'
      },
      conflictMetrics: {
        active: 3,
        thisWeek: 2,
        types: ['Resource Allocation', 'Stakeholder Disagreement']
      },
      escalationMetrics: {
        overdue: 1,
        pending: 1,
        thisMonth: 4
      }
    },
    {
      projectId: 'proj_003',
      projectName: 'Performance Dashboard',
      priorityMetrics: {
        totalApproved: 17,
        pendingReview: 5,
        totalAssigned: 22
      },
      signOffMetrics: {
        open: 10,
        pending: 2,
        overdue: 2,
        lastSignOffDate: '2025-06-11T09:15:00Z'
      },
      conflictMetrics: {
        active: 3,
        thisWeek: 0,
        types: ['Stakeholder Disagreement']
      },
      escalationMetrics: {
        overdue: 1,
        pending: 1,
        thisMonth: -1 // negative means no new this month
      }
    }
  ];
  
  return mockProjects;
}

/**
 * Invalidate dashboard cache
 */
export function invalidateDashboardCache(filterKey?: string): void {
  if (!filterKey) {
    cache.clear();
  } else {
    cache.delete(filterKey);
  }
}

// Export old-style functions for backward compatibility
export interface PriorityResponse {
  totalApproved: number;
  pendingReview: number;
  totalAssigned: number;
}

export interface SignOffResponse {
  open: number;
  pending: number;
  overdue: number;
  lastSignOffDate: string | null;
}

export interface ConflictResponse {
  active: number;
  thisWeek: number;
  types: string[];
}

export interface EscalationResponse {
  overdue: number;
  pending: number;
  thisMonth: number;
}