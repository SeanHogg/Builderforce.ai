'use client';

import { useSearchParams } from 'next/navigation';
import { WorkflowsContent } from '@/components/WorkflowsContent';

/**
 * The client leaf of `/workflows`: reads the `?projectId=` scope out of the URL
 * so switching project scope stays a client-side navigation.
 */
export function WorkflowsPageBody() {
  const projectIdParam = useSearchParams().get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;
  return <WorkflowsContent projectId={Number.isFinite(projectId) ? projectId : null} />;
}
