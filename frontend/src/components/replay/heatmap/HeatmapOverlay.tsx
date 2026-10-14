/**
 * The heat canvas (PRD 33 §4.3, §8 S4): one `HeatLayer` painted over a page.
 *
 * Laid absolutely over its parent, which is sized in PAGE pixels — the
 * heatmap background (full document) or the player's viewport. The lattice
 * covers the whole document, so a cell's height is `docHeight / rows` and the
 * player passes its scroll offset to show the part in view.
 *
 * The ramp is ONLY the `--heat-*` custom properties (`heatmap.module.css`),
 * read with getComputedStyle; the legend carries "cold → hot" as text so the
 * scale never relies on colour alone.
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { readHeatPalette, rampColor, type HeatLayer } from './heatRamp';
import styles from './heatmap.module.css';

export interface HeatmapOverlayProps {
  layer: HeatLayer;
  /** Overlay box, in page pixels. */
  width: number;
  height: number;
  /** Document height the lattice spans (default: the overlay's height). */
  docHeight?: number;
  /** Document width the lattice spans (default: the overlay's width). */
  docWidth?: number;
  /** Document scroll offset of the overlay's top edge (the player follows the replayed scroll). */
  offsetY?: number;
}

export function HeatmapOverlay({ layer, width, height, docHeight, docWidth, offsetY = 0 }: HeatmapOverlayProps) {
  const t = useTranslations('replay.heat');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // no 2D context (a test environment, a blocked canvas): nothing to paint
    const ratio = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const palette = readHeatPalette(canvas, ctx);
    if (!palette) return;
    const cellW = (docWidth ?? width) / layer.cols;
    const cellH = (docHeight ?? height) / layer.rows;
    for (const cell of layer.cells) {
      const y = cell.gy * cellH - offsetY;
      if (y + cellH < 0 || y > height) continue;
      ctx.fillStyle = rampColor(palette, cell.t);
      ctx.fillRect(cell.gx * cellW, y, Math.ceil(cellW), Math.ceil(cellH));
    }
  }, [layer, width, height, docHeight, docWidth, offsetY]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="heat-overlay"
      data-cells={layer.cells.length}
      className={`${styles.palette} ${styles.layer}`}
      style={{ width, height }}
      role="img"
      aria-label={t('overlayAria', { count: layer.cells.length })}
    />
  );
}

/** The scale's words: "cold → hot", or "less → more" for a difference. */
export function HeatLegend({ difference = false }: { difference?: boolean }) {
  const t = useTranslations('replay.heat');
  return (
    <span className={`${styles.palette} ${styles.legend}`} role="note" aria-label={difference ? t('legendDiffAria') : t('legendAria')}>
      <span>{difference ? t('legendLess') : t('legendCold')}</span>
      <span aria-hidden="true" className={difference ? `${styles.legendRamp} ${styles.legendRampDiff}` : styles.legendRamp} />
      <span>{difference ? t('legendMore') : t('legendHot')}</span>
    </span>
  );
}
