'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { CopyButton } from '@/components/CopyButton';
import { managerApi, type ManagerOverview } from '@/lib/builderforceApi';
import { buildManagerDiagnosticsReport } from '@/lib/managerDiagnostics';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';

/**
 * The AI Manager's one-paste HANDOVER.
 *
 * ── WHY IT IS ITS OWN COMPONENT, IN THE PAGE HEADER ──────────────────────────────
 * It used to live inside the stuck register, which meant it only existed on the Stuck
 * sub-tab. That is the wrong place twice over: most of what the report explains
 * (policy tiers, pass outcomes, autonomy health, the decision feed) is on OTHER
 * sub-tabs, and the moment a human most wants to hand the state over is right after
 * clicking "Run manager now" and seeing nothing change. Sitting beside that button, it
 * is reachable from every sub-tab and pairs the two actions a person actually
 * alternates between: run it, then capture why it did nothing.
 *
 * ── IT FETCHES ON CLICK, NEVER ON RENDER ─────────────────────────────────────────
 * The report serialises the whole manager state, so building it per render would cost
 * three API calls on every keystroke elsewhere on the page. Fetching on click also makes
 * the capture HONEST: a report stamped "now" that carried minutes-old rows from a
 * panel's mount-time load is subtly wrong in exactly the way that wastes a debugging
 * session. Every read fails soft and the report states which one was unavailable —
 * "the census could not be loaded" is itself a finding, and far better than a silent
 * zero that reads as "nothing is stalled".
 *
 * The THROUGHPUT digest is captured alongside the state reads (added with the Manager
 * page's Today panel): a handover that describes a backlog's configuration but cannot
 * say whether anything finished today is missing the first thing its reader will ask,
 * and its "0 shipped" is only meaningful next to yesterday's number.
 */
export interface ManagerCopyDiagnosticsProps {
  projectId: number;
  /**
   * The overview the page already loaded. Passed in rather than re-fetched — the parent
   * has it live, and it is the one input the report cannot degrade without. `null` while
   * it loads, which hides the button rather than offering an empty capture.
   */
  overview: ManagerOverview | null;
}

export function ManagerCopyDiagnostics({ projectId, overview }: ManagerCopyDiagnosticsProps) {
  const t = useTranslations('manager.stalls');
  const tCommon = useTranslations('common');

  const buildReport = useCallback(async (): Promise<string> => {
    if (!overview) return '';
    // All three in parallel, all fail-soft: a missing block is reported as missing.
    const [stalls, census, digest] = await Promise.all([
      managerApi.stalls(projectId).catch(() => null),
      managerApi.census(projectId).catch(() => null),
      managerApi.digest(projectId).catch(() => null),
    ]);
    return buildManagerDiagnosticsReport(
      {
        projectId,
        overview,
        stalls,
        stallsError: stalls == null ? 'the stuck register could not be loaded' : null,
        census,
        censusError: census == null ? 'the stall census could not be loaded' : null,
        digest,
        digestError: digest == null ? "today's throughput digest could not be loaded" : null,
      },
      await captureDiagnosticsContext(),
    );
  }, [projectId, overview]);

  // Nothing to hand over until the overview is in — the report is built around it.
  if (!overview) return null;

  return (
    <CopyButton
      label={tCommon('copyDiagnostics')}
      ariaLabel={t('copyDiagnosticsAria')}
      getText={buildReport}
    />
  );
}
