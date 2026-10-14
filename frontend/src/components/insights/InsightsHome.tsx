/**
 * THE Insights home (PRD 33 D16, §4.1): one screen that fits 1440×900 with
 * nothing below the fold, plus ONE stacked panel. Rendered by `/apps/insights`,
 * the canvas's Measure ▸ Visitors surface and any later host — with the panel
 * docked opposite the Brain where there is one (`panelSide`).
 *
 * Owns the scope (window, goal, filter, release compare, Page-stage route)
 * through `InsightsScopeProvider`, and lays out `HOME_BANDS` on the grid
 * `homeGridTemplate` derives from them. The filter starts from the address
 * (`?f.visitedPath.eq=/pricing` from Admin's Flow view) and the address follows
 * it, so links arrive filtered and a filtered view is a link.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { InsightsScopeProvider } from './insightsScope';
import { InsightsPanelProvider } from './usePanel';
import { InsightsPanel } from './InsightsPanel';
import { BODY_AREAS, HOME_BANDS, HOME_COLUMNS, HOME_ROWS, homeGridTemplate, type HomeArea } from './homeBands';
import styles from './insightsHome.module.css';

export interface InsightsHomeProps {
  siteId: string;
  panelSide?: 'left' | 'right';
}

function HomeGrid() {
  const t = useTranslations('insights.overview');
  const template = useMemo(() => homeGridTemplate(HOME_BANDS), []);
  const areas = useMemo(() => HOME_ROWS.flat().filter((area, index, all) => all.indexOf(area) === index), []);

  return (
    <div
      className={styles.root}
      data-testid="insights-home"
      aria-label={t('homeAria')}
      role="region"
      style={{
        display: 'grid',
        gridTemplateColumns: HOME_COLUMNS,
        gridTemplateAreas: template.areas,
        gridTemplateRows: template.rows,
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--surface)',
        color: 'var(--text-primary)',
      }}
    >
      {areas.map((area: HomeArea) => {
        const bands = HOME_BANDS.filter((band) => band.area === area);
        if (bands.length === 0) return null;
        const body = BODY_AREAS.has(area);
        return (
          <div
            key={area}
            data-area={area}
            className={body ? `${styles.area} ${styles.bodyCard}` : styles.area}
            style={{
              gridArea: area,
              minWidth: 0,
              minHeight: 0,
              overflow: body ? 'hidden' : 'visible',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            {bands.map(({ id, Component }) => <Component key={id} />)}
          </div>
        );
      })}
    </div>
  );
}

export function InsightsHome({ siteId, panelSide = 'right' }: InsightsHomeProps): React.JSX.Element {
  // The scope reads its filter from the address and keeps the two in sync (`useReplayFilterState`).
  return (
    <InsightsScopeProvider key={siteId} siteId={siteId}>
      <InsightsPanelProvider>
        <HomeGrid />
        <InsightsPanel siteId={siteId} side={panelSide} />
      </InsightsPanelProvider>
    </InsightsScopeProvider>
  );
}
