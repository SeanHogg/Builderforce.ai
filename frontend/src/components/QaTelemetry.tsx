'use client';

/**
 * Mounts the Agentic QA capture client inside the authenticated app shell.
 * Emits a pageview on every route change and starts the document-level
 * click/submit/input listeners. No-op unless NEXT_PUBLIC_QA_CAPTURE === '1'
 * and a tenant token is present (handled inside qaCapture).
 *
 * It also ATTRIBUTES what it captures to the project the user is currently
 * drilled into, so QA heat ranks per project rather than pooling the whole
 * workspace (0955). In the all-projects (portfolio) view there is no project to
 * attribute to and events stay unattributed — which is exactly what every
 * pre-0955 row already means, and what a project-scoped read still includes.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { qaCapture } from '@/lib/qa/telemetry';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

export default function QaTelemetry() {
  const pathname = usePathname();
  // Optional: the capture client mounts in shells that have no project scope
  // provider at all, and must not crash them.
  const scope = useOptionalProjectScope();
  const currentProjectId = scope?.currentProjectId ?? null;

  useEffect(() => {
    qaCapture.start();
    return () => qaCapture.stop();
  }, []);

  // Set the attribution BEFORE the pageview below, so a route change that also
  // changes project does not file the new page under the old project.
  useEffect(() => {
    qaCapture.setProject(currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    if (pathname) qaCapture.pageview(pathname);
  }, [pathname]);

  return null;
}
