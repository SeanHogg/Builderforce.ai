/**
 * The `metric` panel kind (PRD 33 §4.1): opened from a home KPI tile, it is the
 * Overview dashboard over the window and the ONE filter. The level id names the
 * tile it was opened from; the dashboard is the same for every tile.
 */

import { OverviewView } from '@/components/replay/overview/OverviewView';
import type { InsightPanelKindProps } from '../panelKinds';

export function MetricKind({ siteId, push }: InsightPanelKindProps) {
  return <OverviewView siteId={siteId} push={push} />;
}
