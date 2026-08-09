'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { creationSessionsApi } from '@/lib/builderforceApi';

function BuilderPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const scope = useOptionalProjectScope();
  const id = params.get('id');
  const adaptToCanvas = process.env.NEXT_PUBLIC_CREATION_SESSIONS_NAV !== 'false' && !!id;
  const [adapterFailed, setAdapterFailed] = useState(false);
  useEffect(() => {
    if (!adaptToCanvas || !id) return;
    let stopped = false;
    void creationSessionsApi.openResource('workflow', id).then(({ sessionId, objectId }) => {
      if (!stopped) router.replace(`/create/${sessionId}?focus=${objectId}&from=workflow`);
    }).catch(() => { if (!stopped) setAdapterFailed(true); });
    return () => { stopped = true; };
  }, [adaptToCanvas, id, router]);
  // A NEW workflow binds to its project from the global TopBar scope param
  // `?project=` (legacy `?projectId=` honoured for old links), falling back to the
  // current scope when neither is present. An existing definition loads its own
  // saved binding, overriding this. One picker for the whole app.
  const projectIdParam = params.get('project') ?? params.get('projectId');
  const initialProjectId = projectIdParam ? Number(projectIdParam) : (scope?.currentProjectId ?? null);
  if (adaptToCanvas && !adapterFailed) return <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Opening workflow on the creation canvas…</div>;
  return <><WorkflowBuilder definitionId={id} initialProjectId={initialProjectId} />{adapterFailed && <div role="status" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 20, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>Canvas migration was unavailable. The workflow builder remains open.</div>}</>;
}

export default function WorkflowBuilderPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Loading builder…</div>}>
      <BuilderPageInner />
    </Suspense>
  );
}
