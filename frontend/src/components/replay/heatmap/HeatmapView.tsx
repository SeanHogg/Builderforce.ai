/**
 * THE heatmap (PRD 33 §8 S4): a route's clicks, rage, dead clicks, scroll
 * reach or Areas, over the page itself, for a release — alone, side by side
 * with a compare release, or as the difference between them.
 *
 * One container for every place a heatmap shows: the Page stage's `heat` and
 * `stuck` lenses (`compact`, a subset of `layers`) and the `route` panel kind
 * (everything, plus the element table and whatever `renderBelow` adds — the
 * scroll bar and the insights). Counts are exact over every session (D15/D18).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayDeviceClass, ReplayElementRowDto } from '@builderforce/interaction-contract';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { useFormat } from '@/i18n/useFormat';
import { ElementTable } from './ElementTable';
import { HeatLegend } from './HeatmapOverlay';
import { HeatmapControls } from './HeatmapControls';
import { HeatStage } from './HeatStage';
import { issuesOnRoute } from './heatLinks';
import { ALL_HEAT_LAYERS, HEAT_LAYERS, HEAT_MODES, type HeatLayerId, type HeatMode } from './heatLayers';
import { differenceLayer, heatLayer } from './heatRamp';
import { useHeatmapData, type HeatmapSelection } from './useHeatmapData';
import styles from './heatmap.module.css';

export interface HeatmapViewProps {
  siteId: string;
  route: string;
  days?: number;
  /** A release to compare against from the start (the home's release compare). */
  initialCompare?: string | null;
  /** The layers offered, in tab order (default: all). */
  layers?: readonly HeatLayerId[];
  /** A lens: no route picker, compare, modes or element table. */
  compact?: boolean;
  /** Opens panel levels (an element's or an insight's replays). */
  push?: (level: InsightPanelLevel) => void;
  /** Extra sections that follow the selection (the `route` kind's scroll bar and insights). */
  renderBelow?: (selection: HeatmapSelection) => ReactNode;
}

export function HeatmapView({
  siteId,
  route: initialRoute,
  days,
  initialCompare = null,
  layers = ALL_HEAT_LAYERS,
  compact = false,
  push,
  renderBelow,
}: HeatmapViewProps) {
  const t = useTranslations('replay.heat');
  const fmt = useFormat();
  const [route, setRoute] = useState(initialRoute);
  const [release, setRelease] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(compact ? null : initialCompare);
  const [device, setDevice] = useState<ReplayDeviceClass | null>(null);
  const [layerId, setLayerId] = useState<HeatLayerId>(layers[0] ?? 'click');
  const [chosenMode, setMode] = useState<HeatMode>('single');
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const layerDef = HEAT_LAYERS[layerId];
  const modesEnabled = !compact && layerDef.display === 'heat';
  const modeDef = HEAT_MODES.find((row) => row.id === chosenMode);
  // A compare mode without a compare release (or on Areas) shows the one release.
  const mode: HeatMode = modesEnabled && modeDef && (!modeDef.needsCompare || compare) ? chosenMode : 'single';

  const selection: HeatmapSelection = { route, release, compare, device, kind: layerDef.kind, days };
  const data = useHeatmapData(siteId, selection, { withCompareGrid: mode !== 'single', withRoutes: !compact });

  const current = useMemo(() => heatLayer(data.grid), [data.grid]);
  const compared = useMemo(() => heatLayer(data.compareGrid), [data.compareGrid]);
  const difference = useMemo(() => differenceLayer(data.grid, data.compareGrid), [data.grid, data.compareGrid]);

  const releaseName = (key: string | null) => {
    if (!key) return t('allReleases');
    const row = data.releases.find((item) => item.releaseKey === key);
    return row?.label ?? (row ? t('releaseOrdinal', { ordinal: row.ordinal }) : key.slice(0, 12));
  };

  const openElement = push ? (row: ReplayElementRowDto) => push(issuesOnRoute(route, row.selector)) : undefined;
  const stage = { siteId, route, device, days, display: layerDef.display, elements: data.elements, highlighted };

  return (
    <div className={styles.palette} data-testid="heatmap-view" data-mode={mode} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <HeatmapControls
        compact={compact}
        route={route}
        routes={data.routes}
        onRoute={(next) => { setRoute(next); setHighlighted(null); }}
        releases={data.releases}
        release={release}
        onRelease={setRelease}
        compare={compare}
        onCompare={setCompare}
        device={device}
        onDevice={setDevice}
        layers={layers}
        layer={layerId}
        onLayer={setLayerId}
        mode={mode}
        onMode={setMode}
        modesEnabled={modesEnabled}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <HeatLegend difference={mode === 'difference'} />
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
          {data.grid ? t('exactTotal', { count: fmt.number(data.grid.total) }) : ''}
        </span>
      </div>

      {data.error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {data.error}</p>}
      {!data.loading && !data.error && data.grid && data.grid.total === 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>
      )}

      {mode === 'side' ? (
        <div className={styles.stages}>
          <HeatStage {...stage} release={release} layer={current} caption={t('sideCurrent', { release: releaseName(release) })} />
          <HeatStage {...stage} release={compare} layer={compared} caption={t('sideCompare', { release: releaseName(compare) })} />
        </div>
      ) : (
        <HeatStage
          {...stage}
          release={release}
          layer={mode === 'difference' ? difference : current}
          caption={mode === 'difference' ? t('differenceCaption', { release: releaseName(release), compare: releaseName(compare) }) : undefined}
        />
      )}

      {!compact && (
        <section aria-labelledby="heat-elements-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
          <h3 id="heat-elements-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('elements.title')}</h3>
          <ElementTable
            rows={data.elements}
            hasCompare={compare !== null}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onOpen={openElement}
          />
        </section>
      )}

      {renderBelow?.(selection)}
    </div>
  );
}
