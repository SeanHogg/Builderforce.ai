'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowsContent } from '@/components/WorkflowsContent';
import PageContainer from '@/components/PageContainer';

function WorkflowsPageInner() {
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;

  return (
    <PageContainer style={{ padding: '20px 16px' }}>
      <WorkflowsContent projectId={projectId} />
    </PageContainer>
  );
}

export default function WorkflowsPage() {
  return (
    <Suspense>
      <WorkflowsPageInner />
    </Suspense>
  );
}
