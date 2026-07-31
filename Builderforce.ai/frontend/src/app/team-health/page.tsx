'use client';

import { TeamHealthDashboard } from './TeamHealthDashboard';

/**
 * Team Health page — renders the full dashboard.
 * Project ID is read from search params, defaulting to 1.
 */
export default function TeamHealthPage() {
  // In production the projectId comes from the route / app context.
  // This page supports ?projectId=<n> as an override.
  const projectId = 1;

  return <TeamHealthDashboard projectId={projectId} />;
}
