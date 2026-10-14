/**
 * HEAT_LAYERS and HEAT_MODES — what a heatmap can show and how (PRD 33 §8 S4).
 *
 * Data, not branches: a layer names the rollup `kind` it reads and how it is
 * drawn (heat cells, or Areas boxes over the top elements); a mode says
 * whether it needs a compare release. The Page stage's `heat` and `stuck`
 * lenses and the `route` kind each pass the subset they offer.
 */

import type { ReplayHeatKind } from '@builderforce/interaction-contract';

export type HeatLayerId = 'click' | 'rage' | 'dead' | 'scroll' | 'areas';
export type HeatDisplay = 'heat' | 'areas';

export interface HeatLayerDef {
  id: HeatLayerId;
  /** The `replay_heat_daily` kind the layer reads. */
  kind: ReplayHeatKind;
  display: HeatDisplay;
}

export const HEAT_LAYERS: Readonly<Record<HeatLayerId, HeatLayerDef>> = {
  click: { id: 'click', kind: 'click', display: 'heat' },
  rage: { id: 'rage', kind: 'rage', display: 'heat' },
  dead: { id: 'dead', kind: 'dead', display: 'heat' },
  scroll: { id: 'scroll', kind: 'scroll', display: 'heat' },
  areas: { id: 'areas', kind: 'click', display: 'areas' },
};

/** Every layer, in tab order (the `route` kind's set). */
export const ALL_HEAT_LAYERS: readonly HeatLayerId[] = ['click', 'rage', 'dead', 'scroll', 'areas'];

export type HeatMode = 'single' | 'side' | 'difference';

export interface HeatModeDef {
  id: HeatMode;
  needsCompare: boolean;
}

export const HEAT_MODES: ReadonlyArray<HeatModeDef> = [
  { id: 'single', needsCompare: false },
  { id: 'side', needsCompare: true },
  { id: 'difference', needsCompare: true },
];
