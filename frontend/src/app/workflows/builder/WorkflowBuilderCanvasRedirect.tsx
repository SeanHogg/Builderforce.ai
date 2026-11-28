'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';
import { legacyCreationHref, legacyWorkflowLibraryHref } from '@/lib/canvas/legacyCreationRoute';

/**
 * Compatibility adapter: workflow authoring now opens from a Canvas object. Not a
 * server `retiredRoute()` — resolving `?id=` to a canvas session is an
 * authenticated call, not a URL rewrite.
 */
export function WorkflowBuilderCanvasRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const libraryHref = legacyWorkflowLibraryHref('/workflows/builder', searchParams);
    const id = searchParams.get('id');
    if (!id) {
      router.replace(libraryHref);
      return;
    }
    let cancelled = false;
    void creationSessionsApi.openResource('workflow', id)
      .then((opened) => {
        if (!cancelled) router.replace(legacyCreationHref(openedBoardHref(opened), '/workflows/builder'));
      })
      .catch(() => {
        if (!cancelled) router.replace(libraryHref);
      });
    return () => { cancelled = true; };
  }, [router, searchParams]);

  return null;
}
