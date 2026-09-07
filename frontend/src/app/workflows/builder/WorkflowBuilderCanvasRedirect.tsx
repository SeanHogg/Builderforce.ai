'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';

/**
 * Compatibility adapter: workflow authoring now opens from a Canvas object. Not a
 * server `retiredRoute()` — resolving `?id=` to a canvas session is an
 * authenticated call, not a URL rewrite.
 */
export function WorkflowBuilderCanvasRedirect() {
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
      .then((opened) => {
        if (!cancelled) router.replace(openedBoardHref(opened));
      })
      .catch(() => {
        if (!cancelled) router.replace('/create?filter=workflow');
      });
    return () => { cancelled = true; };
  }, [router, searchParams]);

  return null;
}
