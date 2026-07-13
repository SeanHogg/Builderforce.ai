'use client';

import { WorkflowsContent } from '@/components/WorkflowsContent';
import PageContainer from '@/components/PageContainer';
import { useProjectScope } from '@/lib/ProjectScopeContext';

export default function WorkflowsPage() {
  // Project scope comes from the global TopBar tenant→project selector — one
  // picker for the whole app. Deep-links carry it as `?project=<id>` (adopted by
  // ProjectScopeProvider on navigation), replacing the old `?projectId=` param.
  const { currentProjectId } = useProjectScope();

  return (
    <PageContainer style={{ padding: '20px 16px' }}>
      <WorkflowsContent projectId={currentProjectId} />
    </PageContainer>
  );
}
