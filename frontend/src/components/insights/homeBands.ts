/**
 * HOME_BANDS — what the Insights home draws, and where (PRD 33 §4.1, D16).
 *
 * A band is `{ id, Component, area }`; `HOME_ROWS` places the areas on the
 * grid. `FunnelBand` (area `funnel`) arrived with S4c, `DoNext` + `ScoreStrip`
 * (area `next`, stacked in its column) with S4e — rows here; the home never
 * changes. An area with no band takes no row, so an unbuilt band leaves no gap.
 */

import type { ComponentType } from 'react';
import { DoNext } from './bands/DoNext';
import { FunnelBand } from './bands/FunnelBand';
import { GoalBar } from './bands/GoalBar';
import { InsightsHeader } from './bands/InsightsHeader';
import { IssuesTable } from './bands/IssuesTable';
import { KpiTiles } from './bands/KpiTiles';
import { PageStage } from './bands/PageStage';
import { ScoreStrip } from './bands/ScoreStrip';

export type HomeArea = 'header' | 'goal' | 'numbers' | 'funnel' | 'issues' | 'stage' | 'next';

export interface HomeBand {
  id: string;
  Component: ComponentType;
  area: HomeArea;
}

export const HOME_BANDS: ReadonlyArray<HomeBand> = [
  { id: 'header', Component: InsightsHeader, area: 'header' },
  { id: 'goal', Component: GoalBar, area: 'goal' },
  { id: 'kpis', Component: KpiTiles, area: 'numbers' },
  { id: 'funnel', Component: FunnelBand, area: 'funnel' },
  { id: 'issues', Component: IssuesTable, area: 'issues' },
  { id: 'page-stage', Component: PageStage, area: 'stage' },
  { id: 'do-next', Component: DoNext, area: 'next' },
  { id: 'score-strip', Component: ScoreStrip, area: 'next' },
];

/** The grid, top to bottom. The last row takes the remaining height; the body splits 38 / 34 / 28. */
export const HOME_ROWS: ReadonlyArray<ReadonlyArray<HomeArea>> = [
  ['header'],
  ['goal'],
  ['numbers'],
  ['funnel'],
  ['issues', 'stage', 'next'],
];

export const HOME_COLUMNS = '38fr 34fr 28fr';
const COLUMN_COUNT = 3;

/** Areas that hold the body: drawn as cards that scroll inside themselves. */
export const BODY_AREAS: ReadonlySet<HomeArea> = new Set(['issues', 'stage', 'next']);

/** `grid-template-areas` / `-rows` for the bands actually registered. */
export function homeGridTemplate(bands: ReadonlyArray<HomeBand> = HOME_BANDS): { areas: string; rows: string } {
  const present = new Set(bands.map((band) => band.area));
  const rows = HOME_ROWS.filter((row) => row.some((area) => present.has(area)));
  const areas = rows
    .map((row) => (row.length === 1 ? Array(COLUMN_COUNT).fill(row[0]).join(' ') : row.join(' ')))
    .map((line) => `"${line}"`)
    .join(' ');
  const sizes = rows.map((_, index) => (index === rows.length - 1 ? 'minmax(0, 1fr)' : 'auto')).join(' ');
  return { areas, rows: sizes };
}
