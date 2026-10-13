/**
 * The player's heat overlay (PRD 33 §8 S4): the click heat of the page the
 * replay is on NOW, over the replayed viewport.
 *
 * The page comes from the timeline's latest `page` mark at the playhead; the
 * heat is that route's exact click grid for the recording's device class
 * (every release, so it is the page's settled heat rather than one visit's).
 * The lattice spans the whole document, so the replayed document's height and
 * scroll position (rrweb's same-origin sandbox) place the cells in view.
 */

import { useMemo } from 'react';
import type { ReplayHeatGridDto, ReplayMark, ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { HeatmapOverlay } from './heatmap/HeatmapOverlay';
import { heatLayer } from './heatmap/heatRamp';
import styles from './heatmap/heatmap.module.css';

/** The route on screen at `atMs`: the latest `page` mark at or before it, else the entry path. */
export function routeAt(marks: readonly ReplayMark[], atMs: number, fallback: string): string {
  let route = fallback;
  for (const mark of marks) {
    if (mark.kind !== 'page') continue;
    if (mark.atMs > atMs) break;
    route = mark.key;
  }
  return route;
}

export interface PlayerHeatOverlayProps {
  siteId: string;
  recording: ReplayRecordingDto;
  currentMs: number;
  frameDocument: () => Document | null;
  days?: number;
}

export function PlayerHeatOverlay({ siteId, recording, currentMs, frameDocument, days }: PlayerHeatOverlayProps) {
  const route = routeAt(recording.marks, currentMs, recording.entryPath);
  const device = recording.deviceClass;
  const { data } = useAdminData<ReplayHeatGridDto>(
    () => replayApi.heatGrid(siteId, { route, device, kind: 'click', days }),
    [siteId, route, device, days],
  );
  const layer = useMemo(() => heatLayer(data), [data]);

  // Read on every render: the playhead ticks re-render this while playing, so the cells follow the scroll.
  const doc = frameDocument();
  const root = doc?.scrollingElement ?? doc?.documentElement ?? null;
  const { w, h } = recording.viewport;
  const docHeight = Math.max(root?.scrollHeight ?? 0, h);
  const docWidth = Math.max(root?.scrollWidth ?? 0, w);
  const offsetY = root?.scrollTop ?? 0;

  return (
    <div className={styles.palette} data-testid="player-heat" data-route={route} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <HeatmapOverlay layer={layer} width={w} height={h} docHeight={docHeight} docWidth={docWidth} offsetY={offsetY} />
    </div>
  );
}
