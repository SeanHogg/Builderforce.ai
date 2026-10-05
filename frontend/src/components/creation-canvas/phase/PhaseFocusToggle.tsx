// No 'use client' directive: rendered only inside `CreationCanvas`, which declares it.
import { useTranslations } from 'next-intl';
import { useCanvasPhase } from './CanvasPhaseContext';
import styles from '../CreationCanvas.module.css';

/** A lens: a ring with the centre filled — "bring this forward". */
function PhaseFocusIcon() {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.4 1.8" />
    <circle cx="8" cy="8" r="2.4" fill="currentColor" />
  </svg>;
}

/**
 * "Phase focus" — whether the board brings the phase's kinds forward and dims the rest.
 *
 * A row in the ••• menu's view trough, beside the mini map and the marquee: it changes
 * how the board is LOOKED at, which is exactly what that trough holds. Never a floating
 * pill. Self-contained: it reads and writes the preference through `CanvasPhaseContext`
 * and draws nothing outside a canvas.
 */
export function PhaseFocusToggle() {
  const t = useTranslations('creationCanvas');
  const phaseValue = useCanvasPhase();
  if (!phaseValue) return null;
  const { focusEnabled, setFocusEnabled } = phaseValue;
  const label = t('boardMenu.phaseFocus');
  return <button
    type="button"
    className={styles.sessionActionButton}
    data-testid="canvas-phase-focus-toggle"
    aria-pressed={focusEnabled}
    aria-label={label}
    title={focusEnabled ? t('boardMenu.phaseFocusOn') : t('boardMenu.phaseFocusOff')}
    onClick={() => setFocusEnabled(!focusEnabled)}
  ><PhaseFocusIcon /></button>;
}
