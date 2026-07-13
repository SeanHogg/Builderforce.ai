/**
 * API client for capabilities dashboard endpoints.
 * In production, this would fetch from real endpoints (/api/projects/:id/capabilities and /api/capabilities/rollup).
 */

import type { Capability, CapabilityRollup, CapabilitiesTableFilter } from '@/types/capabilities';

// Mock data generator for demonstration
function generateMockCapabilities(projectId: string): Capability[] {
  const statuses: CapabilityStatus[] = ['shipped', 'in_progress', 'planned'];
  const categories = ['Performance', 'Security', 'UX', 'Developer Experience', 'Integration'];
  const categoryDisplayMap: Record<string, string> = {
    Performance: 'Performance',
    Security: 'Security',
    UX: 'User Experience',
    'Developer Experience': 'DevEx',
    Integration: 'Integration',
  };

  return statuses.flatMap((status) => {
    const count = Math.floor(Math.random() * 8) + 1; // 1-8 items per status
    return Array.from({ length: count }, (_, i) => ({
      id: `${projectId}-${status}-${i}`,
      name: `${status.charAt(0).toUpperCase() + status.slice(1)} Capability ${i + 1}`,
      status,
      category: categories[Math.floor(Math.random() * categories.length)],
      healthScore: Math.floor(Math.random() * 40) + 60, // 60-100
      lastUpdated: new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000)).toISOString(),
      categoryDisplay: categoryDisplayMap[categories[Math.floor(Math.random() * categories.length)]],
    }));
  });
}

/**
 * Fetch rollup data for dashboard charts.
 * Returns aggregated health, status breakdown, and category data.
 */
export async function getCapabilityRollup(projectId: string): Promise<CapabilityRollup> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  const capabilities = generateMockCapabilities(projectId);

  // Calculate health score (average weighted by status)
  const totalScore = capabilities.reduce((sum, c) => sum + c.healthScore, 0);
  const shipped = capabilities.filter((c) => c.status === 'shipped');
  const inProgress = capabilities.filter((c) => c.status === 'in_progress');
  const planned = capabilities.filter((c) => c.status === 'planned');

  // Weight more towards 'shipped' and 'in_progress'
  const healthScore =
    (shipped.length * totalScore) / capabilities.length +
    (inProgress.length * totalScore) / capabilities.length * 0.7 +
    (planned.length * totalScore) / capabilities.length * 0.5;

  // Status breakdown
  const statusBreakdown = {
    shipped: shipped.length,
    in_progress: inProgress.length,
    planned: planned.length,
  };

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  const categoryCounts = capabilities.reduce(
    (acc, c) => {
      acc[c.category] = (acc[c.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  Object.entries(categoryCounts).forEach(([category, count]) => {
    categoryBreakdown[categoryDisplayMap[category] || category] = count;
  });

  return {
    healthScore: Math.min(100, Math.max(0, Math.round(healthScore))),
    statusBreakdown,
    categoryBreakdown,
  };
}

/**
 * Fetch list of capabilities for the table.
 * Supports optional filtering by status, category, and health score range.
 */
export async function getCapabilities(
  projectId: string,
  filter: CapabilitiesTableFilter = {}
): Promise<Capability[]> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  const capabilities = generateMockCapabilities(projectId);

  // Apply client-side filtering
  return capabilities.filter((c) => {
    if (filter.status && c.status !== filter.status) return false;
    if (filter.category && c.category !== filter.category) return false;
    if (filter.healthMinScore !== undefined && c.healthScore < filter.healthMinScore) return false;
    if (filter.healthMaxScore !== undefined && c.healthScore > filter.healthMaxScore) return false;
    return true;
  });
}

function categoryDisplayMap: Record<string, string> = {
  Performance: 'Performance',
  Security: 'Security',
  UX: 'User Experience',
  'Developer Experience': 'DevEx',
  Integration: 'Integration',
};