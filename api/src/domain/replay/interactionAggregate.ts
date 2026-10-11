/**
 * Daily interaction cells — the heatmap read model, as a pure fold.
 *
 * Ingest walks a chunk once and upserts these cells additively. Ranking
 * (heatZones) and painting never reopen R2. The dimensions are the ones
 * `replay_interactions_daily` / the Analytics Engine blobs share:
 * `(path, device, kind, selector, label, gx, gy) → n`.
 *
 * Device class uses the same vocabulary as the filter registry
 * (`mobile|tablet|desktop`), not a second "phone" label.
 */

import {
  toGridCell,
  type ReplayChunk,
  type ReplayChunkEvent,
  type ReplayVisitMeta,
} from '@builderforce/interaction-contract';

export const INTERACTION_CELL_KINDS = ['click', 'rage', 'dead', 'scroll'] as const;
export type InteractionCellKind = (typeof INTERACTION_CELL_KINDS)[number];

/** Matches FILTER_FIELDS `device` in interaction-contract. */
export const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

const PATH_MAX = 512;
const SELECTOR_MAX = 400;
const LABEL_MAX = 120;

const PHONE_MAX_W = 767;
const TABLET_MAX_W = 1023;

export interface InteractionCell {
  path: string;
  device: DeviceClass;
  kind: InteractionCellKind;
  selector: string;
  label: string;
  gx: number;
  gy: number;
  n: number;
}

export function deviceClassFromViewport(viewport: { w: number }): DeviceClass {
  if (viewport.w <= PHONE_MAX_W) return 'mobile';
  if (viewport.w <= TABLET_MAX_W) return 'tablet';
  return 'desktop';
}

function isCellKind(value: string): value is InteractionCellKind {
  return (INTERACTION_CELL_KINDS as readonly string[]).includes(value);
}

function cap(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function stringField(event: ReplayChunkEvent, key: string): string {
  const value = event[key];
  return typeof value === 'string' ? value : '';
}

function numberField(event: ReplayChunkEvent, key: string): number | null {
  const value = event[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cellKey(cell: Omit<InteractionCell, 'n'>): string {
  return `${cell.path}\0${cell.device}\0${cell.kind}\0${cell.selector}\0${cell.label}\0${cell.gx}\0${cell.gy}`;
}

/**
 * Fold chunk events into daily heatmap cells. Scroll uses an empty selector
 * and `gy` as the max-depth decile (0–9); other kinds snap to the 50 px grid.
 */
export function aggregateInteractions(
  chunk: ReplayChunk,
  meta: ReplayVisitMeta,
): InteractionCell[] {
  const device = deviceClassFromViewport(meta.viewport);
  const tallies = new Map<string, InteractionCell>();

  for (const event of chunk.events) {
    if (!isCellKind(event.kind)) continue;
    const path = cap(stringField(event, 'path') || meta.path, PATH_MAX);
    const label = cap(stringField(event, 'label'), LABEL_MAX);
    let selector = cap(stringField(event, 'selector'), SELECTOR_MAX);
    let gx = 0;
    let gy = 0;

    if (event.kind === 'scroll') {
      selector = '';
      const depthDecile = numberField(event, 'depthDecile');
      const depth = numberField(event, 'depth');
      if (depthDecile !== null) {
        gy = Math.max(0, Math.min(9, Math.floor(depthDecile)));
      } else if (depth !== null) {
        gy = Math.max(0, Math.min(9, Math.floor(depth * 10)));
      } else {
        continue;
      }
    } else {
      const x = numberField(event, 'x');
      const y = numberField(event, 'y');
      if (x === null || y === null) continue;
      const cell = toGridCell(x, y);
      gx = cell.gx;
      gy = cell.gy;
    }

    const next: Omit<InteractionCell, 'n'> = {
      path,
      device,
      kind: event.kind,
      selector,
      label: event.kind === 'scroll' ? '' : label,
      gx,
      gy,
    };
    const key = cellKey(next);
    const existing = tallies.get(key);
    if (existing) existing.n += 1;
    else tallies.set(key, { ...next, n: 1 });
  }

  return [...tallies.values()];
}
