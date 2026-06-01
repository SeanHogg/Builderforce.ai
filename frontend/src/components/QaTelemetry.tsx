'use client';

/**
 * Mounts the Agentic QA capture client inside the authenticated app shell.
 * Emits a pageview on every route change and starts the document-level
 * click/submit/input listeners. No-op unless NEXT_PUBLIC_QA_CAPTURE === '1'
 * and a tenant token is present (handled inside qaCapture).
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { qaCapture } from '@/lib/qa/telemetry';

export default function QaTelemetry() {
  const pathname = usePathname();

  useEffect(() => {
    qaCapture.start();
    return () => qaCapture.stop();
  }, []);

  useEffect(() => {
    if (pathname) qaCapture.pageview(pathname);
  }, [pathname]);

  return null;
}
