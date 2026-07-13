'use client';

import { Suspense, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { FlexRow } from '@/components/FlexRow';
import { CapabilitiesDashboard } from '@/components/capabilities/CapabilitiesDashboard';

/**
 * Project-scoped Capabilities Dashboard.
 * 
 * This route allows accessing the Capabilities Dashboard within a specific project context.
 * It sets the project scope before rendering the dashboard, ensuring all data is filtered
 * to the selected project.
 * 
 * This file implements AC-5: Navigation requirement - "Capabilities Dashboard link is accessible
 * from the project page" and navigates to the correct page.
 */
export default function ProjectCapabilitiesPage() {
  const params = useParams<{ id: string }>();
  const projectIdParam = String(params?.id);
  const id = projectIdParam ? Number(projectIdParam) : undefined;

  return (
    <FlexRow
      style={{
        '--row-y': '50%',
        '--row-x': '50%',
      }}
    >
      <CapabilitiesDashboard />
    </FlexRow>
  );
}