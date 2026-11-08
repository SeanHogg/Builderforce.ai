import { useCallback, useEffect, useRef } from 'react';
import { beginStrokePath, endStrokePath, extendStrokePath } from '@/lib/canvasDrawing';
import { decodeFrame } from '@/lib/creation/animation/frameDecode';
import { storeCreationFile } from '@/lib/creation/exportArtifact';
import { recordedFailure } from '@/lib/reportError';
import { useDebouncedPatch } from '../creative/useDebouncedPatch';
import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import type { AnimationState } from '@/lib/creation/animation/animationState';
import { floodFillCanvas, pickColor, stampDab, strokeBetween, type BrushSettings, type PaintPoint, type PaintTool } from '@/lib/creation/animation/rasterPaint';

interface AnimationPaintStageProps {
  state: AnimationState;
  activeId: string;
  tool: PaintTool;
  brush: BrushSettings;
  /** False while the strip plays, or when the board is read-only: the canvas then ignores the pointer. */
  paintable: boolean;
  onCommitPixels: (frameId: string, url: string) => void;
  onPickColor: (color: string) => void;
  /** The frame's pixels could not be kept (upload failed for a signed-in person, or too large to inline). */
  onStoreFailed?: () => void;
}

/** How long after the last stroke the strip is rewritten; a burst of strokes is one write. */
const COMMIT_DELAY_MS = 600;

/**
 * The drawing surface: background, onion skin and the active frame, stacked. Only the
 * top canvas takes the pointer.
 *
 * WHY THIS IS NOT `DrawingSurface`: that surface records vector strokes (a path per mark,
 * kept as data and re-rendered), which is what the board's sketch and image annotation
 * want. Frame art is RASTER: brush dabs, an eraser that clears pixels, a flood fill and an
 * eyedropper all act on the bitmap itself, and the frame is stored as its PNG. A stroke
 * list cannot express a fill or an erase-to-transparent. The pointer tracking is shared
 * (`beginStrokePath`/`extendStrokePath`/`endStrokePath` from `lib/canvasDrawing`).
 *
 * The bitmap is captured when a stroke or fill ends, uploaded, and its URL written to the
 * strip once the person pauses (or switches frame, or leaves) — a burst of strokes is one
 * upload and one write, not one each.
 */
export function AnimationPaintStage({ state, activeId, tool, brush, paintable, onCommitPixels, onPickColor, onStoreFailed }: AnimationPaintStageProps) {
  const t = useTranslations('canvas.kinds.animation');
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const onionRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const path = useRef<PaintPoint[]>([]);
  /** The frame whose bitmap is on the canvas and not yet written to the strip. */
  const dirtyFrame = useRef<string | null>(null);
  /** Frames whose latest bitmap is being uploaded, with the sequence number of that upload. */
  const inFlight = useRef(new Map<string, number>());
  const sequence = useRef(0);
  /** The data URL this stage just wrote, so the redraw effect does not repaint it. */
  const written = useRef<{ id: string; url: string } | null>(null);
  const { width, height, frames, background, onionSkinDepth } = state;
  const activeIndex = Math.max(0, frames.findIndex((frame) => frame.id === activeId));
  const active = frames[activeIndex];

  useEffect(() => {
    const ctx = backgroundRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (background.kind === 'color') { ctx.fillStyle = background.color; ctx.fillRect(0, 0, width, height); }
  }, [background, width, height]);

  useEffect(() => {
    const ctx = onionRef.current?.getContext('2d');
    if (!ctx) return;
    // A decode that finishes after the strip moved on must not paint over the newer redraw.
    let current = true;
    const layers: Array<{ url: string; alpha: number }> = [];
    for (let i = Math.max(0, activeIndex - onionSkinDepth); i < activeIndex; i++) {
      const url = frames[i]!.pixelsDataUrl;
      if (url) layers.push({ url, alpha: Math.max(0.08, 0.5 / (activeIndex - i)) });
    }
    ctx.clearRect(0, 0, width, height);
    void Promise.all(layers.map((layer) => decodeFrame(layer.url).catch(recordedFailure('Decoding an onion-skin frame', null)))).then((images) => {
      if (!current) return;
      ctx.clearRect(0, 0, width, height);
      images.forEach((image, i) => {
        if (!image) return;
        ctx.save();
        ctx.globalAlpha = layers[i]!.alpha;
        ctx.drawImage(image, 0, 0, width, height);
        ctx.restore();
      });
    });
    return () => { current = false; };
  }, [frames, activeIndex, onionSkinDepth, width, height]);

  useEffect(() => {
    const ctx = paintRef.current?.getContext('2d');
    if (!ctx || !active) return;
    // Unwritten strokes are newer than the stored pixels: do not paint the old ones over them.
    if (dirtyFrame.current === active.id || inFlight.current.has(active.id)) return;
    if (written.current?.id === active.id && written.current.url === active.pixelsDataUrl) return;
    written.current = null;
    ctx.clearRect(0, 0, width, height);
    if (!active.pixelsDataUrl) return;
    let current = true;
    void decodeFrame(active.pixelsDataUrl).then((image) => { if (current) ctx.drawImage(image, 0, 0, width, height); }, () => undefined);
    return () => { current = false; };
  }, [active, width, height]);

  const writePixels = useCallback(() => {
    const canvas = paintRef.current;
    const frameId = dirtyFrame.current;
    dirtyFrame.current = null;
    if (!canvas || !frameId) return;
    const mine = ++sequence.current;
    inFlight.current.set(frameId, mine);
    // `toBlob` snapshots the bitmap now, so a stroke that starts while the upload runs is not in it.
    canvas.toBlob((blob) => {
      void (async () => {
        try {
          if (!blob) throw new Error('frame encoding failed');
          const url = await storeCreationFile(new File([blob], `frame-${frameId}.png`, { type: 'image/png' }));
          // A newer commit of this frame supersedes this one.
          if (inFlight.current.get(frameId) !== mine) return;
          written.current = { id: frameId, url };
          onCommitPixels(frameId, url);
        } catch {
          if (inFlight.current.get(frameId) === mine) onStoreFailed?.();
        } finally {
          if (inFlight.current.get(frameId) === mine) inFlight.current.delete(frameId);
        }
      })();
    }, 'image/png');
  }, [onCommitPixels, onStoreFailed]);
  const { schedule, flush } = useDebouncedPatch<Record<string, never>>(writePixels, COMMIT_DELAY_MS);
  // Leaving a frame writes it first, while its bitmap is still on the canvas.
  const activeFrameId = active?.id;
  useEffect(() => flush, [activeFrameId, flush]);

  const commit = useCallback(() => {
    if (!active) return;
    dirtyFrame.current = active.id;
    schedule({});
  }, [active, schedule]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): PaintPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintable || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    event.stopPropagation();
    const point = pointOf(event);
    if (tool === 'eyedropper') {
      const picked = pickColor(ctx, point);
      if (picked) onPickColor(picked);
      return;
    }
    if (tool === 'fill') {
      if (floodFillCanvas(ctx, width, height, point, brush.color)) commit();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    beginStrokePath(path, point);
    stampDab(ctx, brush, point, tool === 'eraser');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const last = path.current[path.current.length - 1];
    const ctx = event.currentTarget.getContext('2d');
    if (!last || !ctx) return;
    const point = pointOf(event);
    strokeBetween(ctx, brush, last, point, tool === 'eraser');
    extendStrokePath(path, point);
  };

  const endStroke = () => {
    if (!path.current.length) return;
    endStrokePath(path);
    commit();
  };

  const size = { '--paint-aspect': width / height } as React.CSSProperties;
  return <div className={`${styles.paintStage} ${background.kind === 'transparent' ? styles.paintChecker : ''}`} style={size}>
    <canvas ref={backgroundRef} width={width} height={height} className={styles.paintLayer} aria-hidden="true" />
    <canvas ref={onionRef} width={width} height={height} className={styles.paintLayer} aria-hidden="true" />
    <canvas
      ref={paintRef}
      width={width}
      height={height}
      className={`${styles.paintLayer} ${styles.paintTop} nodrag nowheel`}
      data-paintable={paintable || undefined}
      role="img"
      aria-label={t('canvasLabel', { index: activeIndex + 1, total: frames.length })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
    />
  </div>;
}
