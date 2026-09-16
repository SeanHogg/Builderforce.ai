// No 'use client' directive: drawn only in `CanvasComposer`'s leading slot, inside the
// `CreationCanvas` client boundary — the same reason its neighbours state at their tops.
import { useTranslations } from 'next-intl';
import { AddObjectIcon, ClosePaletteIcon } from '@/components/canvas/CanvasCommands';
import styles from './CreationCanvas.module.css';

/**
 * THE "+" THAT IS THE COMMAND BAR.
 *
 * On a phone the canvas draws no command bar (see `CanvasActionsSheet` for why), so
 * this one 44px button in front of the composer is how every command is reached. It
 * lives in the composer's `leading` slot rather than floating somewhere on the board
 * because a phone has one place a thumb rests, and the composer already owns it.
 *
 * ── WHY `aria-haspopup="dialog"` AND NOT `menu` ──────────────────────────────────
 * What opens is a sheet with a heading, six captioned sections and controls inside
 * it — not a list of commands one press deep. Announcing it as a menu would promise
 * arrow-key traversal of a flat list that is not what is there.
 *
 * ── WHY IT IS DRAWN AT EVERY WIDTH AND HIDDEN IN CSS ─────────────────────────────
 * The breakpoint is the stylesheet's to know. Gating the node on a JS media query
 * would make the composer's layout depend on a value that is `false` for the first
 * paint and in every test, which is how a control ends up flickering in on mount.
 */
export interface CanvasActionsTriggerProps {
  open: boolean;
  onToggle: () => void;
}

export function CanvasActionsTrigger({ open, onToggle }: CanvasActionsTriggerProps) {
  const t = useTranslations('creationCanvas');
  const label = open ? t('closeActions') : t('actions');

  return (
    <button
      type="button"
      className={styles.composerActionsTrigger}
      data-testid="canvas-actions-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >{open ? <ClosePaletteIcon /> : <AddObjectIcon />}</button>
  );
}
