/**
 * The `funnel` panel kind's three tabs (PRD 33 §4.1): Steps (the funnels, who
 * dropped where) · Events (smart events, built-in and custom) · Flow (the
 * kept-recording flow graph, the same `FlowView` Admin uses, fed by the
 * `replay` source). The level id is `funnelLevelId` — which funnel to open on,
 * or a smart-event rule to open the Events editor with.
 */

import { filterToQuery } from '@builderforce/interaction-contract';
import { FlowView } from '@/components/admin/visitors/FlowView';
import { FunnelsView } from '@/components/replay/funnels/FunnelsView';
import { SmartEventsView } from '@/components/replay/funnels/SmartEventsView';
import { parseFunnelLevelId } from '@/components/replay/funnels/funnelLevel';
import { useInsightsScope } from '../insightsScope';
import type { InsightPanelKindProps } from '../panelKinds';

export function FunnelStepsTab({ siteId, id, push }: InsightPanelKindProps) {
  return <FunnelsView siteId={siteId} initialFunnelId={parseFunnelLevelId(id).funnelId} push={push} />;
}

export function FunnelEventsTab({ siteId, id }: InsightPanelKindProps) {
  return <SmartEventsView siteId={siteId} draft={parseFunnelLevelId(id).draft} />;
}

export function FunnelFlowTab({ siteId, push }: InsightPanelKindProps) {
  const { days, filter } = useInsightsScope();
  return (
    <FlowView
      source={{ kind: 'replay', siteId, days, filter }}
      onWatchStep={(path) => push({
        kind: 'issues',
        id: filterToQuery({ all: [{ field: 'visitedPath', op: 'eq', value: path }] }).toString(),
      })}
    />
  );
}
