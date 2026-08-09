'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Compatibility entry for old IDE links. Builder now lives in Creation Canvas.
 */
export default function IDEEntryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/create?filter=build');
  }, [router]);
  return null;
}
