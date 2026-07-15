'use client';

import { Suspense, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
  const { setProject } = useProjectScope();
  const router = useRouter();

  // Initialize projectId state; defaults to 0 if invalid
  const [projectId, setProjectId] = useState(() => (id && !isNaN(id) ? id : 0));

  // Validate and set project scope whenever projectId changes
  useState(() => {
    if (!isNaN(id) && id > 0 && setProject) {
      setProject(id);
    }
  });

  // Redirect to a valid project ID if the requested one is invalid
  if (!projectId || isNaN(projectId)) {
    router.push('/projects');
    return null;
  }

  return (
    <FlexRow
      style={{
        '--row-y': '50%',
        '--row-x': '50%',
      }}
    >
      <CapabilitiesDashboard projectId={String(projectId)} />
    </FlexRow>
  );
}