/**
 * PAGE_STAGE_LENSES — what the Page stage can show for its route (PRD 33 §4.1:
 * Heat · Stuck · Fixes · Live). `heat` (click · scroll · areas) and `stuck`
 * (rage · dead) are the one `HeatmapView` with a layer subset; `fixes` (S4e) is
 * the route's prescriptions as THE fix card, compact.
 */

import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { LiveView } from '@/components/replay/LiveView';
import { HeatmapView } from '@/components/replay/heatmap/HeatmapView';
import type { HeatLayerId } from '@/components/replay/heatmap/heatLayers';
import { PrescriptionCard } from '@/components/replay/prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from '@/components/replay/prescriptions/usePrescriptionsFor';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

export interface PageStageLensProps {
  siteId: string;
  route: string;
}

export interface PageStageLens {
  id: string;
  /** Under `insights.lenses`. */
  labelKey: string;
  Component: ComponentType<PageStageLensProps>;
}

function LiveLens({ siteId, route }: PageStageLensProps) {
  const { push } = usePanel();
  return (
    <LiveView
      compact
      siteId={siteId}
      route={route}
      onOpenRecording={(recordingId) => push({ kind: 'recording', id: recordingId, tab: 'replay', follow: true })}
    />
  );
}

/** The route's fixes, ranked (`pagePath` = the stage's route). */
function FixesLens({ siteId, route }: PageStageLensProps) {
  const t = useTranslations('replay.fixes');
  const { push } = usePanel();
  const { items, loading } = usePrescriptionsFor({ siteId, route });
  if (!loading && items.length === 0) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      {items.map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} push={push} />)}
    </div>
  );
}

/** A heat lens is the compact `HeatmapView` over a subset of layers; the key remounts it per route. */
function heatLens(layers: readonly HeatLayerId[]): ComponentType<PageStageLensProps> {
  function HeatLens({ siteId, route }: PageStageLensProps) {
    const { days } = useInsightsScope();
    const { push } = usePanel();
    return <HeatmapView key={route} compact siteId={siteId} route={route} days={days} layers={layers} push={push} />;
  }
  return HeatLens;
}

export const PAGE_STAGE_LENSES: ReadonlyArray<PageStageLens> = [
  { id: 'heat', labelKey: 'heat', Component: heatLens(['click', 'scroll', 'areas']) },
  { id: 'stuck', labelKey: 'stuck', Component: heatLens(['rage', 'dead']) },
  { id: 'fixes', labelKey: 'fixes', Component: FixesLens },
  { id: 'live', labelKey: 'live', Component: LiveLens },
];
