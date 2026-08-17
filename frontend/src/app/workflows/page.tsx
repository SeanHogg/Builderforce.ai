'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowsContent } from '@/components/WorkflowsContent';

function WorkflowsPageBody() {
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;
  return <WorkflowsContent projectId={Number.isFinite(projectId) ? projectId : null} />;
}

export default function WorkflowsPage() {
  return (
    <main style={{ padding: '24px 24px 48px', maxWidth: 1200, margin: '0 auto' }}>
      <Suspense fallback={null}>
        <WorkflowsPageBody />
      </Suspense>
    </main>
  );
}
