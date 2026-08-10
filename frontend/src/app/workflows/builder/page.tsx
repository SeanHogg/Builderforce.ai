'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { creationSessionsApi } from '@/lib/builderforceApi';

/** Compatibility adapter: workflow authoring now opens from a Canvas object. */
function WorkflowBuilderCanvasRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = searchParams.get('id');
    if (!id) {
      router.replace('/create?filter=workflow');
      return;
    }
    let cancelled = false;
    void creationSessionsApi.openResource('workflow', id)
      .then(({ sessionId, objectId }) => {
        if (!cancelled) router.replace(`/create/${sessionId}?focus=${objectId}`);
      })
      .catch(() => {
        if (!cancelled) router.replace('/create?filter=workflow');
      });
    return () => { cancelled = true; };
  }, [router, searchParams]);

  return null;
}

export default function WorkflowBuilderCompatibilityPage() {
  return <Suspense fallback={null}><WorkflowBuilderCanvasRedirect /></Suspense>;
}
