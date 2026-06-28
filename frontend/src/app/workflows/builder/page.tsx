'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

function BuilderPageInner() {
  const params = useSearchParams();
  const scope = useOptionalProjectScope();
  const id = params.get('id');
  // A NEW workflow binds to its project from the global TopBar scope param
  // `?project=` (legacy `?projectId=` honoured for old links), falling back to the
  // current scope when neither is present. An existing definition loads its own
  // saved binding, overriding this. One picker for the whole app.
  const projectIdParam = params.get('project') ?? params.get('projectId');
  const initialProjectId = projectIdParam ? Number(projectIdParam) : (scope?.currentProjectId ?? null);
  return <WorkflowBuilder definitionId={id} initialProjectId={initialProjectId} />;
}

export default function WorkflowBuilderPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Loading builder…</div>}>
      <BuilderPageInner />
    </Suspense>
  );
}
