/**
 * Open an Insights panel level from a fix card wherever the card is shown
 * (PRD 33 D16): inside the Insights home it is a push onto the ONE panel; outside
 * it (the proof scoreboard on `/realize`) it is a link to `/apps/insights` with
 * `?site=` and `?panel=` — the same address `panelUrl.ts` writes, never a
 * second overlay.
 */

import { withPanelParams } from '@/components/insights/panelUrl';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { useOptionalPanel } from '@/components/insights/usePanel';

export const INSIGHTS_APP_PATH = '/apps/insights';

export function insightsAppHref(siteId: string, level: InsightPanelLevel): string {
  return `${INSIGHTS_APP_PATH}?${withPanelParams(new URLSearchParams({ site: siteId }), level).toString()}`;
}

export interface InsightsLevelOpener {
  /** Set when there is a panel to push onto. */
  push: ((level: InsightPanelLevel) => void) | null;
  href: (level: InsightPanelLevel) => string;
}

export function useInsightsLevel(siteId: string, push?: (level: InsightPanelLevel) => void): InsightsLevelOpener {
  const panel = useOptionalPanel();
  return { push: push ?? panel?.push ?? null, href: (level) => insightsAppHref(siteId, level) };
}
