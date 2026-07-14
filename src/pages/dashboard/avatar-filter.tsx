/**
 * @fileoverview Avatar Filter dashboard — projects landing page for the Avatar Filter feature.
 * @example
 * <AvatarFilterDashboard projectId={project.id} />
 */

'use client';

import type { DashboardLayoutProps } from '@/dashboard/Layout';
import { AvatarFilterOverview } from './features';

/**
 * AvatarFilterDashboard
 *
 * Displays an overview of the Avatar Filter:
 *
 * - Red-amber-green project status indicators (RAG)
 * - List of projects in the workspace, filterable by status, score, or date
 * - Links to project detail pages for per-project status and RAG dashboards
 *
 * Layout responsibilities:
 *
 * - Provide a layout dimension and loading state
 * - Apply board-level filters if connected to a Kanban board
 * - Redraw when projects change (database pushes / manual navigation)
 *
 * File responsibilities (this module):
 *
 * - Apply AvatarFilterOverview to the content area
 * - Render a skeleton fallback if data is not yet available
 * - Re-expose AvatarFilterOverview as the primary interactive view
 */
export function AvatarFilterDashboard({
  resources,
  loading = false,
  selectedProjects = new Set(),
  storageUri,
  appId,
}: DashboardLayoutProps): JSX.Element {
  // Layout dimension: adapt to screen size.
  const dims = {
    width: '1fr',
    height: '100%',
  };

  // Skeleton state: before data arrives.
  if (loading) {
    return (
      <div className="bg-background-surface1 p-4" style={dims}>
        <div className="max-w-full max-w-prose space-y-2">
          <div className="h-6 w-1/3 animate-pulse bg-background-surface2 rounded" />
          <div className="h-4 w-full animate-pulse bg-background-surface2 rounded" />
          <div className="h-4 w-3/4 animate-pulse bg-background-surface2 rounded" />
        </div>
      </div>
    );
  }

  // Content: rely on AvatarFilterOverview for interactivity and lists.
  return (
    <div className="bg-background-surface1 p-4" style={dims}>
      <AvatarFilterOverview
        projects={resources}
        selectedProjects={selectedProjects}
        storageUri={storageUri}
        appId={appId}
      />
    </div>
  );
}