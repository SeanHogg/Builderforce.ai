/**
 * PAGE_STAGE_LENSES — what the Page stage can show for its route (PRD 33 §4.1:
 * Heat · Stuck · Fixes · Live). `heat` (click · scroll · areas) and `stuck`
 * (rage · dead) are the one `HeatmapView` with a layer subset; `fixes` (S4e) is
 * the route's prescriptions as THE fix card, compact, led by the way into the
 * route's page review (S4f, `route:<route>:review`).
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
import { pageReviewLevel } from '../kinds/PagesKind';

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

/** The route's fixes, ranked (`pagePath` = the stage's route), and the way into its page review. */
function FixesLens({ siteId, route }: PageStageLensProps) {
  const t = useTranslations('replay.fixes');
  const tStage = useTranslations('insights.route.review');
  const { push } = usePanel();
  const { items, loading } = usePrescriptionsFor({ siteId, route });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <button type="button" className="btn-secondary" data-testid="open-page-review" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={() => push(pageReviewLevel(route))}>
        {tStage('open')}
      </button>
      {!loading && items.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
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
