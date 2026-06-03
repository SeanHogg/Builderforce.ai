'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';

function BuilderPageInner() {
  const id = useSearchParams().get('id');
  return <WorkflowBuilder definitionId={id} />;
}

export default function WorkflowBuilderPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Loading builder…</div>}>
      <BuilderPageInner />
    </Suspense>
  );
}
