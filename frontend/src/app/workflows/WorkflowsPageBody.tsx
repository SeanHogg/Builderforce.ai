'use client';

import { WorkflowsContent } from '@/components/WorkflowsContent';
import { useComponentProjectId } from '@/lib/components/scope';

/**
 * The client leaf of `/workflows`: scoped through the one project resolution, so a
 * `/workflows?project=<id>` link, the TopBar pick and an older `?projectId=` link
 * all land on the same filter.
 */
export function WorkflowsPageBody() {
  return <WorkflowsContent projectId={useComponentProjectId()} />;
}
