'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';

function BuilderPageInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const projectIdParam = params.get('projectId');
  const initialProjectId = projectIdParam ? Number(projectIdParam) : null;
  return <WorkflowBuilder definitionId={id} initialProjectId={initialProjectId} />;
}

export default function WorkflowBuilderPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Loading builder…</div>}>
      <BuilderPageInner />
    </Suspense>
  );
}
