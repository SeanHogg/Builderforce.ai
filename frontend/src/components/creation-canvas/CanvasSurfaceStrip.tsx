// No 'use client' directive: rendered only by `CreationCanvas`, which already declares
// the boundary — the same reason `PhaseModalitySelector` states at its top.
import { useTranslations } from 'next-intl';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasSurfaceSwitcher } from './CanvasSurfaceSwitcher';
import styles from './CreationCanvas.module.css';

/**
 * WHAT YOU ARE LOOKING AT, as a phone's tab strip.
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────────────
 * A floating icon COLUMN (`.boardRail > .mobileCanvasActions`) parked over the board's
 * top-left corner: five unlabelled glyphs stacked on top of the surface's own heading,
 * with a rule that flipped them into a horizontal row ACROSS that heading whenever the
 * Brain sheet opened. The control that answers "which reading of this session am I
 * on" was drawn over the thing it was naming, and answered it with glyphs.
 *
 * So it is a strip, directly under the canvas app bar, where a phone's tabs belong:
 * icon and word, 44px tall, one lit, scrolling sideways in the one place a sideways
 * scroll is expected — its own band — and never over the work.
 *
 * ── WHY A COMPONENT AND NOT A `<div>` IN THE HOST ────────────────────────────────
 * It carries `role="group"` and a name, and it is the element the app bar's measured
 * band has to include. Both of those are properties of the STRIP, and a wrapper the
 * host re-types each time it moves is how a named region quietly loses its name — the
 * column's did, twice, to a `display:contents` that removed the box some assistive
 * tech announces it from.
 */
export interface CanvasSurfaceStripProps {
  surface: CanvasSurfaceId;
  onChange: (surface: CanvasSurfaceId) => void;
}

export function CanvasSurfaceStrip({ surface, onChange }: CanvasSurfaceStripProps) {
  const t = useTranslations('creationCanvas');

  return (
    <div
      className={styles.surfaceStrip}
      role="group"
      aria-label={t('surfaceStrip')}
      data-testid="canvas-surface-strip"
    >
      <CanvasSurfaceSwitcher surface={surface} onChange={onChange} variant="mobile" />
    </div>
  );
}
