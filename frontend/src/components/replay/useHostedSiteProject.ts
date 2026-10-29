// No `'use client'`: this module exports a hook, not a component.
/**
 * The Builderforce project behind a HOSTED Insights site, or null (an external
 * site has no project; neither does a site still loading or one the read
 * failed for). The ONE reading of "does this site have a project?" — the
 * ticket-from-moment action and the proof chip both ask it.
 */

import { useEffect, useState } from 'react';
import { replaySitesApi } from '@/lib/replaySitesApi';

export function useHostedSiteProject(siteId: string): number | null {
  const [projectId, setProjectId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    replaySitesApi.get(siteId)
      .then((site) => { if (live) setProjectId(site?.kind === 'hosted' ? site.projectId : null); })
      .catch(() => { if (live) setProjectId(null); });
    return () => { live = false; };
  }, [siteId]);

  return projectId;
}
