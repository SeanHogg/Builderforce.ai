import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import { MAX_ANIMATION_FPS, MAX_ONION_DEPTH, type AnimationState } from '@/lib/creation/animation/animationState';
import { ANIMATION_PRESETS } from '@/lib/creation/animation/animationPresets';
import { ANIMATION_EXPORT_FORMATS, type AnimationExportFormat } from '@/lib/creation/animation/animationExport';
import type { BrushSettings, PaintTool } from '@/lib/creation/animation/rasterPaint';
import type { ExportStatus } from '../creative/useExportArtifact';
import { ExportNotice } from '../creative/ExportNotice';

const TOOLS: readonly PaintTool[] = ['brush', 'eraser', 'fill', 'eyedropper'];
const TOOL_KEY: Record<PaintTool, 'toolBrush' | 'toolEraser' | 'toolFill' | 'toolPicker'> = {
  brush: 'toolBrush', eraser: 'toolEraser', fill: 'toolFill', eyedropper: 'toolPicker',
};
const PRESET_KEY = { logoLoop: 'presetLogoLoop', spinner: 'presetSpinner', reaction: 'presetReaction', explainer: 'presetExplainer' } as const;

interface AnimationToolbarProps {
  state: AnimationState;
  editable: boolean;
  playing: boolean;
  tool: PaintTool;
  brush: BrushSettings;
  canPickPreset: boolean;
  exportStatus: ExportStatus;
  /** The failure was the pixel budget, not a fault: say so. */
  exportOverBudget?: boolean;
  onTool: (tool: PaintTool) => void;
  onBrush: (brush: BrushSettings) => void;
  onTogglePlay: () => void;
  onSettings: (patch: Partial<Pick<AnimationState, 'fps' | 'onionSkinDepth'>>) => void;
  onPreset: (presetId: string) => void;
  onClear: () => void;
  onExport: (format: AnimationExportFormat) => void;
}

export function AnimationToolbar({
  state, editable, playing, tool, brush, canPickPreset, exportStatus, exportOverBudget = false,
  onTool, onBrush, onTogglePlay, onSettings, onPreset, onClear, onExport,
}: AnimationToolbarProps) {
  const t = useTranslations('canvas.kinds.animation');
  return <div className={`${styles.toolbar} nodrag nowheel`}>
    <button type="button" className={styles.button} onClick={onTogglePlay} disabled={state.frames.length < 2} aria-pressed={playing}>
      {playing ? t('pause') : t('play')}
    </button>
    {editable && <>
      <div className={styles.group} role="group" aria-label={t('tools')}>
        {TOOLS.map((id) => <button key={id} type="button" className={styles.button} data-active={tool === id || undefined} aria-pressed={tool === id} onClick={() => onTool(id)}>{t(TOOL_KEY[id])}</button>)}
      </div>
      <label className={styles.field}><span>{t('color')}</span><input type="color" value={brush.color} onChange={(event) => onBrush({ ...brush, color: event.target.value })} /></label>
      <label className={styles.field}><span>{t('size')}</span><input type="range" min={1} max={64} value={brush.size} onChange={(event) => onBrush({ ...brush, size: Number(event.target.value) })} /></label>
      <label className={styles.field}><span>{t('onionSkin')}</span><input type="number" min={0} max={MAX_ONION_DEPTH} value={state.onionSkinDepth} onChange={(event) => onSettings({ onionSkinDepth: Number(event.target.value) })} /></label>
      <label className={styles.field}><span>{t('fps')}</span><input type="number" min={1} max={MAX_ANIMATION_FPS} value={state.fps} onChange={(event) => onSettings({ fps: Number(event.target.value) })} /></label>
      <button type="button" className={styles.button} onClick={onClear}>{t('clearFrame')}</button>
      {canPickPreset && <label className={styles.field}>
        <span>{t('startFrom')}</span>
        <select value="" onChange={(event) => event.target.value && onPreset(event.target.value)}>
          <option value="">{t('presetNone')}</option>
          {ANIMATION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(PRESET_KEY[preset.id])}</option>)}
        </select>
      </label>}
    </>}
    <div className={styles.group} role="group" aria-label={t('export')}>
      {ANIMATION_EXPORT_FORMATS.map((spec) => <button key={spec.format} type="button" className={styles.button} disabled={exportStatus === 'busy'} onClick={() => onExport(spec.format)}>
        {t('exportAs', { format: spec.format.toUpperCase() })}
      </button>)}
    </div>
    {exportStatus === 'busy' && <span className={styles.status} role="status">{t('exporting')}</span>}
    {exportStatus === 'failed' && <span className={styles.status} role="alert">{t(exportOverBudget ? 'exportTooLarge' : 'exportFailed')}</span>}
    <ExportNotice status={exportStatus} />
  </div>;
}
