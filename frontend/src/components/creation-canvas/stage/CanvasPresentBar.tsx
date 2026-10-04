import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { presentationStepAt, type PresentationStep } from '@/lib/canvasPresentation';
import styles from '../CreationCanvas.module.css';

export interface CanvasPresentBarProps {
  presentMode: boolean;
  steps: readonly PresentationStep[];
  step: number;
  onMove: (delta: number) => void;
  setPresentMode: (value: boolean) => void;
}

/**
 * THE PRESENTATION CONTROL — the only chrome present mode ADDS rather than hides.
 * It self-gates on there being a sequence at all: a board with no frames has
 * nothing to walk, and present mode there behaves exactly as it always has.
 * The presenter's camera is the transport (see `goToPresentationStep`), so
 * every follower moves with these buttons for free.
 */
export const CanvasPresentBar = memo(function CanvasPresentBar({ presentMode, steps, step, onMove, setPresentMode }: CanvasPresentBarProps) {
  const t = useTranslations('creationCanvas');
  if (!presentMode || steps.length === 0) return null;
  return <div className={styles.presentBar} aria-label={t('presentSequence')}>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={step <= 0}
            aria-label={t('presentPrevious')}
          ><span aria-hidden>‹</span></button>
          <span className={styles.presentPosition}>
            <b>{t('presentPosition', { index: step + 1, total: steps.length })}</b>
            {presentationStepAt(steps, step)?.title
              ? <small>{presentationStepAt(steps, step)?.title}</small>
              : null}
          </span>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={step >= steps.length - 1}
            aria-label={t('presentNext')}
          ><span aria-hidden>›</span></button>
          <button type="button" className={styles.presentExit} onClick={() => setPresentMode(false)}>{t('exitPresentation')}</button>
        </div>;
});
