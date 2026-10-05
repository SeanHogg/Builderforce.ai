/**
 * The People summary for the session's published app — `siteAudienceApi.summary`,
 * read once per project (and window).
 *
 * Skipped — `idle`, no request — when there is no durable project yet (a local
 * workspace has no site to count) or when the session itself is browser-local:
 * a guest's canvas cannot read the tenant's site routes, and asking would only
 * produce a 401. No refetch on focus: the server caches the aggregate for two
 * minutes, so re-reading on every focus would not show anything newer.
 */
import { useEffect, useState } from 'react';
import { siteAudienceApi, type SiteAudienceSummary, type SiteAudienceWindow } from '@/lib/siteAudienceApi';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';

export type SiteAudienceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SiteAudienceState {
  status: SiteAudienceStatus;
  summary: SiteAudienceSummary | null;
}

interface SettledRead {
  /** The request this answers — a stale answer for another project is ignored. */
  key: string;
  summary: SiteAudienceSummary | null;
  failed: boolean;
}

export function useSiteAudience(projectId: number | null, days: SiteAudienceWindow = 30): SiteAudienceState {
  const { persistence } = useCanvasSessionFacts();
  const key = projectId !== null && persistence === 'server' ? `${projectId}:${days}` : null;
  const [settled, setSettled] = useState<SettledRead | null>(null);

  useEffect(() => {
    if (key === null || projectId === null) return;
    let cancelled = false;
    siteAudienceApi.summary(projectId, days).then(
      (summary) => { if (!cancelled) setSettled({ key, summary, failed: false }); },
      () => { if (!cancelled) setSettled({ key, summary: null, failed: true }); },
    );
    return () => { cancelled = true; };
  }, [key, projectId, days]);

  if (key === null) return { status: 'idle', summary: null };
  if (!settled || settled.key !== key) return { status: 'loading', summary: null };
  return settled.failed ? { status: 'error', summary: null } : { status: 'ready', summary: settled.summary };
}
