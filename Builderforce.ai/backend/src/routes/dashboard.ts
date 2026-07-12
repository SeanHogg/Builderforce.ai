/**
 * Dashboard API Routes
 *
 * REST API endpoints for dashboard metrics and weekly digest.
 * Implements FR3.1 (Dashboard API), FR3.2 (DTO Aggregation), FR3.3 (Metrics Query Logic)
 */

import { Router } from 'express';
import { DashboardService } from '../DashboardService';

const router = Router();

/**
 * GET /api/dashboard
 *
 * Gets dashboard metrics with optional filtering.
 * FR3.1 - Priority metrics query templates
 * FR3.2 - DTO aggregation by project and time period
 * FR3.3 - Metrics summary query logic (sign-offs, conflicts, escalations)
 *
 * Query Parameters:
 * - projectIds (comma-separated array): Filter by project IDs
 * - timePeriod: last_7_days, last_30_days, last_90_days, last_year, custom
 * - stakeholderIds (comma-separated array): Filter by stakeholder IDs
 * - timeRange (JSON object): { start, end } for custom time period
 */
router.post('/api/dashboard', async (req, res) => {
  try {
    const filters = req.body as {
      projectIds?: string[];
      timePeriod: 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_year' | 'custom';
      timeRange?: { start: string; end: string };
      stakeholderIds?: string[];
    };

    // Validate time period
    const validTimePeriods: TimePeriod[] = ['last_7_days', 'last_30_days', 'last_90_days', 'last_year', 'custom'];
    if (!validTimePeriods.includes(filters.timePeriod)) {
      res.status(400).json({ error: 'Invalid time period' });
      return;
    }

    // Validate custom time range if specified
    if (filters.timePeriod === 'custom' && (!filters.timeRange || !filters.timeRange.start || !filters.timeRange.end)) {
      res.status(400).json({ error: 'Custom time range requires start and end dates' });
      return;
    }

    // Fetch dashboard data
    const dashboardData = await DashboardService.getDashboardMetrics(filters);

    res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard metrics:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

/**
 * GET /api/dashboard/cache/invalidate
 *
 * Invalidates the dashboard cache manually.
 */
router.post('/api/dashboard/cache/invalidate', (req, res) => {
  try {
    const filterKey = req.body?.filterKey;
    DashboardService.invalidateCache(filterKey);

    res.json({ success: true, message: 'Cache invalidated' });
  } catch (error) {
    console.error('Error invalidating cache:', error);
    res.status(500).json({ error: 'Failed to invalidate cache' });
  }
});

/**
 * Time periods enum (re-exported for validation)
 */
type TimePeriod = 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_year' | 'custom';

export default router;

/**
 * Usage Example:
 * POST /api/dashboard
 * Body: {
 *   "projectIds": ["proj_001", "proj_002"],
 *   "timePeriod": "last_30_days",
 *   "stakeholderIds": ["stakeholder_001"]
 * }
 *
 * Response: {
 *   "summary": {
 *     "totalApprovedPriorities": 47,
 *     "openSignOffs": 23,
 *     "pendingSignOffs": 14,
 *     "overdueSignOffs": 5,
 *     "activeConflicts": 8,
 *     "overdueEscalations": 2,
 *     "lastUpdated": "2025-06-17T14:30:00Z"
 *   },
 *   "projects": [...]
 * }
 */