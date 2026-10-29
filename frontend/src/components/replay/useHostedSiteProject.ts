// No `'use client'`: this module exports a hook, not a component.
/**
 * The Builderforce project behind a HOSTED Insights site, or null (an external
 * site has no project; neither does a site still loading or one the read
 * failed for — that failure is recorded). The ONE reading of "does this site have
 * a project?" — the ticket-from-moment action and the proof chip both ask it.
 *
 * The answer is held WITH the site it answers for, so switching sites reads as
 * null until the new site's read lands (never the previous site's project).
 */

import { useEffect, useState } from 'react';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { recordedFailure } from '@/lib/reportError';

export function useHostedSiteProject(siteId: string): number | null {
  const [held, setHeld] = useState<{ siteId: string; projectId: number | null } | null>(null);

  useEffect(() => {
    let live = true;
    replaySitesApi.get(siteId)
      .catch(recordedFailure('Reading the Insights site', null))
      .then((site) => {
        if (live) setHeld({ siteId, projectId: site?.kind === 'hosted' ? site.projectId : null });
      });
    return () => { live = false; };
  }, [siteId]);

  return held?.siteId === siteId ? held.projectId : null;
}
