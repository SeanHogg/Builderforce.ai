'use client';

import { useComponentProjectId } from '@/lib/components/scope';
import { LiveOrchestrationWorkspace } from '@/components/orchestration/LiveOrchestrationWorkspace';

export function OrchestrationPageBody() {
  const projectId = useComponentProjectId();
  return <LiveOrchestrationWorkspace projectId={projectId} />;
}
