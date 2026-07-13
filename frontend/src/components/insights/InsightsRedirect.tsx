'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client redirect for the retired standalone insight routes (ai-impact /
 * engineering / recommendations). They now live as drillable sections of the
 * combined /insights/ai dashboard, but the old URLs stay alive (bookmarks, deep
 * links) by redirecting straight into the matching drill-down.
 */
export function InsightsRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
