import { memo } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';

/** What a Brain turn reads — the whole board, the selection, its neighbourhood or a frame. */
export type CanvasScopeMode = 'auto' | 'canvas' | 'selection' | 'connected' | 'frame';

export interface CanvasScopeChipProps {
  scopeMode: CanvasScopeMode;
  onScopeModeChange: (mode: CanvasScopeMode) => void;
  /** How `auto` currently resolves, in words. */
  autoLabel: string;
  /** Objects in the effective selection — zero disables the two selection scopes. */
  selectionCount: number;
  /** The single selected object is a frame, so "current frame" means something. */
  frameSelected: boolean;
}

/** The composer's scope control — the context row of the one `ChatInput`. */
export const CanvasScopeChip = memo(function CanvasScopeChip({ scopeMode, onScopeModeChange, autoLabel, selectionCount, frameSelected }: CanvasScopeChipProps) {
  const t = useTranslations('creationCanvas');
  return <label className={styles.scopeChip}>⌁ <span className="sr-only">{t('brainScope')}</span><select aria-label={t('brainScope')} value={scopeMode} onChange={(event) => onScopeModeChange(event.target.value as CanvasScopeMode)}><option value="auto">{autoLabel}</option><option value="canvas">{t('entireCanvas')}</option><option value="selection" disabled={!selectionCount}>{selectionCount > 1 ? t('selectedObjects', { count: selectionCount }) : t('selectedObject')}</option><option value="connected" disabled={!selectionCount}>{t('connectedScope')}</option><option value="frame" disabled={!frameSelected}>{t('currentFrame')}</option></select></label>;
});
