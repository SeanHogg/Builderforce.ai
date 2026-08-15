/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { canvasVideoDuration, canvasVideoTimelineFrom } from '@builderforce/creation-canvas-contract';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { CanvasVideoEditor } from './CanvasVideoEditor';
import type { CreationNodeData } from './types';

/**
 * Tracks × seconds, at a width where both are legible — the timeline runtime.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * A `video` and a `voice` object already persist a real `CanvasVideoTimeline`: sources,
 * clips, four tracks, trims, captions, chapters. `CanvasVideoEditor` already edits all of
 * it — inside a ~340px node body, where a second track has nowhere to go and a two-minute
 * cut is a few pixels per clip. Time is this medium's axis and the card had no room for
 * it. That is the whole defect, so this surface introduces no new editor: it is the same
 * component with the horizontal room its content always assumed.
 *
 * ── WHY THE DURATION IS DERIVED AND NOT STORED ───────────────────────────────────
 * `canvasVideoDuration` reads the clips, so the header cannot disagree with the edit
 * underneath it. Storing a total beside the clips that produce it is exactly the shape
 * `SpecField.derive` exists to prevent — a number the rows can contradict.
 */

export interface CanvasTimelineSurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a board the viewer cannot drive; the editor renders read-only. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

/** `m:ss`, because a cut is read in minutes and seconds and never in float seconds. */
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function CanvasTimelineSurface({ data, onExit, onEdit }: CanvasTimelineSurfaceProps) {
  const t = useTranslations('creationCanvas');
  const timeline = useMemo(() => canvasVideoTimelineFrom(data.videoTimeline), [data.videoTimeline]);
  const duration = canvasVideoDuration(timeline);

  const actions = <span className={styles.timelineMeta}>
    <strong>{formatDuration(duration)}</strong>
    <small>{t('surface.timeline.clipCount', { count: timeline.clips.length })}</small>
  </span>;

  return (
    <CanvasObjectSurface surface="timeline" data={data} onExit={onExit} actions={actions}>
      <div className={styles.timelineStage}>
        <CanvasVideoEditor data={data} {...(onEdit ? { onEdit } : {})} />
      </div>
    </CanvasObjectSurface>
  );
}
