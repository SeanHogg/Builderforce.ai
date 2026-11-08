import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { slugify } from '@builderforce/creation-canvas-contract';
import styles from '../styles/creativeEditors.module.css';
import type { CreationBodyProps } from './types';
import { AnimationPaintStage } from '../animation/AnimationPaintStage';
import { AnimationFramesRail } from '../animation/AnimationFramesRail';
import { AnimationToolbar } from '../animation/AnimationToolbar';
import { useAnimationEditor } from '../animation/useAnimationEditor';
import { useExportArtifact } from '../creative/useExportArtifact';
import { useCreationNodeActions } from './nodeActions';
import { ANIMATION_EXPORT_FORMATS, AnimationOverBudgetError, renderAnimation, type AnimationExportFormat } from '@/lib/creation/animation/animationExport';
import type { BrushSettings, PaintTool } from '@/lib/creation/animation/rasterPaint';

/**
 * A frame-by-frame animation, drawn and played on the card itself: paint a frame, add
 * the next, scrub the strip, export a GIF or APNG. The strip is `data.animation`.
 */
export function AnimationBody({ data }: CreationBodyProps) {
  const t = useTranslations('canvas.kinds.animation');
  const editor = useAnimationEditor(data);
  const { state, activeId, editable, actions, palette } = editor;
  const { edit: onEdit } = useCreationNodeActions();
  const [tool, setTool] = useState<PaintTool>('brush');
  // The brush starts in the palette's default and stays whatever the person picks after.
  const [picked, setBrush] = useState<BrushSettings | null>(null);
  const brush: BrushSettings = picked ?? { color: palette.defaultBrush, size: 6 };

  const exporter = useExportArtifact<AnimationExportFormat>({
    data,
    artifactKind: 'animation',
    onEdit,
    render: async (format, object) => {
      const { blob, durationSec } = await renderAnimation(state, format, palette.paper);
      const spec = ANIMATION_EXPORT_FORMATS.find((entry) => entry.format === format)!;
      return {
        blob, mimeType: spec.mimeType, label: format.toUpperCase(),
        fileName: `${slugify(object.title, { maxLength: 60, fallback: 'animation' })}.${spec.extension}`,
        detail: `${state.frames.length} frames · ${state.fps} fps · ${durationSec.toFixed(1)} s`,
        metadata: { frames: state.frames.length },
      };
    },
  });

  return <div className={styles.editor}>
    <div className={styles.summary}>
      <span>{t('summary', { count: state.frames.length, fps: state.fps, seconds: editor.durationSec.toFixed(1) })}</span>
      <span>{t('dimensions',{ width: state.width, height: state.height })}</span>
    </div>
    <AnimationPaintStage
      state={state}
      activeId={activeId}
      tool={tool}
      brush={brush}
      paintable={editable && !editor.playing}
      onCommitPixels={actions.commitPixels}
      onStoreFailed={editor.onStoreFailed}
      onPickColor={(color) => { setBrush({ ...brush, color }); setTool('brush'); }}
    />
    {editor.storeFailed && <span className={styles.status} role="alert">{t('frameNotSaved')}</span>}
    <AnimationFramesRail
      state={state}
      activeId={activeId}
      editable={editable}
      limit={editor.frameLimit}
      onSelect={editor.select}
      onAdd={actions.addFrame}
      onDuplicate={actions.duplicate}
      onRemove={actions.remove}
      onMove={actions.move}
      onHold={actions.setHold}
    />
    <AnimationToolbar
      state={state}
      editable={editable}
      playing={editor.playing}
      tool={tool}
      brush={brush}
      canPickPreset={editor.canPickPreset}
      exportStatus={exporter.status}
      exportOverBudget={exporter.error instanceof AnimationOverBudgetError}
      onTool={setTool}
      onBrush={setBrush}
      onTogglePlay={editor.togglePlay}
      onSettings={actions.setSettings}
      onPreset={actions.applyPreset}
      onClear={() => actions.clearFrame(activeId)}
      onExport={exporter.run}
    />
  </div>;
}
