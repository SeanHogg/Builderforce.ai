'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowsContent } from '@/components/WorkflowsContent';

function WorkflowsPageInner() {
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main className="max-w-6xl mx-auto px-4 py-5">
        <WorkflowsContent projectId={projectId} />
      </main>
    </div>
  );
}

export default function WorkflowsPage() {
  return (
    <Suspense>
      <WorkflowsPageInner />
    </Suspense>
  );
}
