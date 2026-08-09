'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** The former IDE launcher is now the Builder filter in the Canvas library. */
export default function IDEDashboardCanvasRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/create?filter=build'); }, [router]);
  return null;
}
