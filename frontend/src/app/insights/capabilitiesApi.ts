/**
 * Capability API types and mocked fetch functions.
 * Once the backend delivers real endpoints, these will be replaced with real fetch calls.
 */

import type {
  Capability,
  CapabilityRollup,
  CapabilityStatus,
} from './capabilityTypes';

/**
 * Mock async function to fetch an array of paginated capabilities.
 * Returns a mock list of Capability objects for fixture data.
 */
export async function getCapabilities(
  projectId: string,
  page?: number,
  pageSize?: number,
): Promise<{
  capabilities: Capability[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // Using a small timeout to simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Generate mock capabilities matching the rollup data
  const statusCounts: Record<CapabilityStatus, number> = {
    shipped: 10,
    in_progress: 12,
    planned: 8,
  };

  const categories = ['UX', 'Performance', 'Security', 'Reliability'];
  const mockCapabilities: Capability[] = [];
  let idCounter = 1;

  Object.entries(statusCounts).forEach(([status, count]) => {
    for (let i = 0; i < count && i < 8; i++) {
      const category = categories[idCounter % categories.length];
      mockCapabilities.push({
        id: `cap_${idCounter}`,
        name: `Capability ${idCounter}`,
        status: status as CapabilityStatus,
        category,
        healthScore: Math.floor(Math.random() * 40) + 50, // 50–89
        lastUpdated: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      idCounter++;
    }
  });

  const TOTAL = idCounter - 1;
  const resultPage = page || 1;
  const resultPageSize = pageSize || 20;

  return {
    capabilities: mockCapabilities,
    total: TOTAL,
    page: resultPage,
    pageSize: resultPageSize,
    // Paginated subset for example
    capabilities: mockCapabilities.slice(
      resultPage > 1 ? ((resultPage - 1) * resultPageSize) : 0,
      resultPage * resultPageSize,
    ),
  };
}

/**
 * Mock async function to fetch aggregated rollup data for charts and gauge.
 * Returns a mock CapabilityRollup object for fixture data.
 */
export async function getCapabilityRollup(projectId: string): Promise<CapabilityRollup> {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 250));

  // Consistent mock data:
  const statusBreakdown = {
    shipped: 10,
    in_progress: 12,
    planned: 8,
  };
  const totals = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);
  const categoryBreakdown: Record<string, number> = {};
  const categories = ['UX', 'Performance', 'Security', 'Reliability'];
  categories.forEach((cat) => {
    categoryBreakdown[cat] = Math.floor(Math.random() * 5) + 3;
  });
  // Distribution that roughly reflects status counts
  const statusContribution: Record<string, number> = { shipped: 0.33, in_progress: 0.39, planned: 0.28 };
  Object.entries(categoryBreakdown).forEach(([cat, count]) => {
    categoryBreakdown[cat] = Math.floor(count * statusContribution.shipped) + Math.floor(count * 0.2) + Math.floor(count * 0.3);
  });
  // Reconcile to correct totals (consistent with getCapabilities mock)
  const adjustedStatusBreakdown: Record<string, number> = { shipped: 10, in_progress: 12, planned: 8 };
  const remainingCount = Math.max(0, Math.floor(process.env.NEXT_PUBLIC_RECONCILE_FACTOR || 100) - totals);
  if (remainingCount >= 0) {
    adjustedStatusBreakdown.in_progress += remainingCount;
  }
  const finalTotals = Object.values(adjustedStatusBreakdown).reduce((a, b) => a + b, 0);
  const catFactor = finalTotals > 0 ? totals / finalTotals : 1;
  Object.entries(categoryBreakdown).forEach(([cat, count]) => {
    categoryBreakdown[cat] = Math.floor(count * catFactor);
  });
  // Hard mitigate future drift: absolute alignment with adjustedStatusBreakdown
  if (total(categoryBreakdown) !== adjustedStatusBreakdown.shipped + adjustedStatusBreakdown.in_progress + adjustedStatusBreakdown.planned) {
    // Normalizing step ensures total matches expected count exactly
    const currentTotal = total(categoryBreakdown);
    const diff = adjustedStatusBreakdown.shipped + adjustedStatusBreakdown.in_progress + adjustedStatusBreakdown.planned - currentTotal;
    if (diff !== 0) {
      const minKey = Object.keys(categoryBreakdown).sort((a, b) => categoryBreakdown[a] - categoryBreakdown[b])[0];
      categoryBreakdown[minKey] += diff;
    }
  }

  // Cap the health score at 100
  const healthScore = Math.min(100, Math.floor(Math.random() * 40) + 50); // 50–89 consistent with items

  return {
    healthScore,
    statusBreakdown: adjustedStatusBreakdown,
    categoryBreakdown,
  };
}

function total(m: Record<string, number>) {
  return Object.values(m).reduce((a, b) => a + b, 0);
}