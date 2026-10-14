/**
 * The `route` panel kind (PRD 33 §4.1): everything about one page. Its level
 * id IS the route (`?panel=route:%2Fpricing:heat`). The `heat` tab is the
 * full `HeatmapView` — every layer, release compare, side by side and
 * difference, the element table — followed by the scroll reach and the heat
 * insights for the same selection. The `review` tab is THE page review
 * (`PageReview`, §5.2) — the screen, score, facts, fixes and one prompt.
 */

import { HeatmapView } from '@/components/replay/heatmap/HeatmapView';
import { HeatmapInsights } from '@/components/replay/heatmap/HeatmapInsights';
import { ScrollDepthBar } from '@/components/replay/heatmap/ScrollDepthBar';
import { PageReview } from '@/components/replay/pageReview/PageReview';
import { useInsightsScope } from '../insightsScope';
import type { InsightPanelKindProps } from '../panelKinds';

export function RouteHeatTab({ siteId, id, push }: InsightPanelKindProps) {
  const { days, compare } = useInsightsScope();
  return (
    <HeatmapView
      key={id}
      siteId={siteId}
      route={id}
      days={days}
      initialCompare={compare}
      push={push}
      renderBelow={(selection) => (
        <>
          <ScrollDepthBar siteId={siteId} route={selection.route} release={selection.release} device={selection.device} days={days} />
          <HeatmapInsights
            siteId={siteId}
            route={selection.route}
            release={selection.release}
            compare={selection.compare}
            device={selection.device}
            days={days}
            push={push}
          />
        </>
      )}
    />
  );
}

export function RouteReviewTab({ siteId, id, push }: InsightPanelKindProps) {
  return <PageReview key={id} siteId={siteId} path={id} push={push} />;
}
