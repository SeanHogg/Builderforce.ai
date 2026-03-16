'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowsContent } from '@/components/WorkflowsContent';

function WorkflowsPageInner() {
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Workflows
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
          Orchestrate multi-step agent tasks. Create a workflow from a spec or start one from scratch.
        </p>
      </div>
      <WorkflowsContent projectId={projectId} />
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
