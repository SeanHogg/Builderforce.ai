/**
 * One heatmap picture: a release's page (`PageBackground`) with its layer —
 * heat cells (`HeatmapOverlay`) or Areas boxes (`AreasOverlay`) — and the
 * highlighted element-table row on top. `HeatmapView` draws one of these, or
 * two side by side.
 */

import type { ReplayDeviceClass, ReplayElementRowDto } from '@builderforce/interaction-contract';
import { AreasOverlay, ZoneHighlight } from './AreasOverlay';
import { HeatmapOverlay } from './HeatmapOverlay';
import { PageBackground } from './PageBackground';
import type { HeatLayer } from './heatRamp';
import type { HeatDisplay } from './heatLayers';

export interface HeatStageProps {
  siteId: string;
  route: string;
  release: string | null;
  device: ReplayDeviceClass | null;
  days?: number;
  display: HeatDisplay;
  layer: HeatLayer;
  elements: readonly ReplayElementRowDto[];
  highlighted: string | null;
  caption?: string;
}

export function HeatStage({ siteId, route, release, device, days, display, layer, elements, highlighted, caption }: HeatStageProps) {
  return (
    <figure data-testid="heat-stage" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      {caption && <figcaption style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{caption}</figcaption>}
      <PageBackground siteId={siteId} route={route} release={release} device={device} days={days}>
        {(frame) => (
          <>
            {display === 'areas'
              ? <AreasOverlay doc={frame.doc} elements={elements} pageHeight={frame.height} />
              : <HeatmapOverlay layer={layer} width={frame.width} height={frame.height} />}
            <ZoneHighlight doc={frame.doc} selector={highlighted} pageHeight={frame.height} />
          </>
        )}
      </PageBackground>
    </figure>
  );
}
