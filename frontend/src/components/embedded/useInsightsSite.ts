// No `'use client'`: this module exports a hook, not a component.

/**
 * The workspace's Insights site key, for the embed install tag (PRD 33 §4.2).
 *
 * Heatmaps and session replay record only when the install tag carries
 * `data-site` — an Insights site key — so the embedded-capabilities surface
 * asks whether one exists. The licence is read first through the shared
 * capability answer (`useCapability`), and the site list only when the
 * workspace is entitled and has a site: the sites route is gated, and asking
 * an unlicensed workspace would be a guaranteed error.
 */

import { useEffect, useState } from 'react';
import { CAPABILITY_APPS } from '@/lib/marketplace/capabilityApps';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { useCapability } from '@/lib/useCapability';

export interface InsightsSiteReading {
  /** The first active site's public `bfr_` key, or null when the workspace has none (yet). */
  siteKey: string | null;
  /** Whether the workspace holds Insights; null while unknown. */
  entitled: boolean | null;
}

export function useInsightsSite(): InsightsSiteReading {
  const capability = useCapability(CAPABILITY_APPS.insights.listingSlug);
  const hasSite = capability.entitled === true && (capability.state?.siteCount ?? 0) > 0;
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSite) { setSiteKey(null); return undefined; }
    let live = true;
    replaySitesApi.list()
      .then((sites) => {
        if (live) setSiteKey(sites.find((site) => site.status === 'active' && site.publicKey)?.publicKey ?? null);
      })
      .catch((error: unknown) => {
        void error;
        if (live) setSiteKey(null);
      });
    return () => { live = false; };
  }, [hasSite]);

  return { siteKey, entitled: capability.entitled };
}
