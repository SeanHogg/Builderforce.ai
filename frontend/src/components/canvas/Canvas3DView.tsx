'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  CANVAS_3D_DEFAULT_ORBIT,
  CANVAS_3D_DEPTH_MODES,
  CANVAS_3D_PERSPECTIVE,
  canvas3dLinkTransform,
  canvas3dOrbitAfterDrag,
  canvas3dOrbitAfterZoom,
  canvas3dFitZoom,
  canvas3dScene,
  canvas3dStageTransform,
  canvas3dTranslate,
  canvas3dZoomFactorFromWheel,
  type Canvas3DDepthMode,
  type Canvas3DDescriptor,
  type Canvas3DNode,
  type Canvas3DOrbit,
} from './canvas3d';
import { usePublishCanvas3DControls, type Canvas3DControls } from './canvas3dControls';
import type { CanvasGraphEdge } from './canvasGraph';
import styles from './Canvas3DView.module.css';

export interface Canvas3DViewProps<T extends Canvas3DNode> {
  nodes: readonly T[];
  edges: readonly CanvasGraphEdge[];
  /** How this canvas labels and colours one of its objects. */
  describe: (node: T) => Canvas3DDescriptor;
  /** Canvas-specific footprint, when a canvas knows more than the measured box. */
  measure?: (node: T) => { width: number; height: number };
  selectedIds?: readonly string[];
  onSelect?: (id: string) => void;
  /** Leave 3D. The visible control lives on the canvas rail; this is the Escape key. */
  onExit: () => void;
}

/** Pointer travel, in pixels, past which a gesture is an orbit and not a click. */
const CLICK_SLOP = 3;
const KEYBOARD_STEP = 12;
const ZOOM_STEP = 1.25;

/**
 * The 3D reading of a canvas: the same objects, lifted onto depth planes.
 *
 * Rendered as real DOM under CSS 3D transforms rather than a WebGL scene, which
 * is what keeps every card a focusable button with its own text — the view stays
 * usable from the keyboard and by assistive tech, and it costs no new runtime.
 * Selection is shared with the flat canvas, so opening an object in 3D shows the
 * same inspector the board would.
 *
 * The scene owns no chrome. Depth, zoom and reset are published to the canvas
 * command rail (see `canvas3dControls`), so 3D adds buttons to the bar the board
 * already has rather than stacking a second toolbar over it.
 */
export function Canvas3DView<T extends Canvas3DNode>({
  nodes,
  edges,
  describe,
  measure,
  selectedIds = [],
  onSelect,
  onExit,
}: Canvas3DViewProps<T>) {
  const t = useTranslations('canvasCommands');
  const [orbit, setOrbit] = useState<Canvas3DOrbit>(CANVAS_3D_DEFAULT_ORBIT);
  const [depthMode, setDepthMode] = useState<Canvas3DDepthMode>('flow');
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const scene = useMemo(
    () => canvas3dScene({ nodes, edges, describe, depthMode, ...(measure ? { measure } : {}) }),
    [depthMode, describe, edges, measure, nodes],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const fitZoom = useCallback(
    () => canvas3dFitZoom(scene.plane, viewportRef.current?.getBoundingClientRect() ?? null),
    [scene.plane],
  );
  /** Once the user zooms, the view stops re-framing itself behind their back. */
  const userZoomed = useRef(false);
  const zoomBy = useCallback((factor: number) => {
    userZoomed.current = true;
    setOrbit((current) => canvas3dOrbitAfterZoom(current, factor));
  }, []);
  const resetView = useCallback(() => {
    userZoomed.current = false;
    setOrbit({ ...CANVAS_3D_DEFAULT_ORBIT, zoom: fitZoom() });
  }, [fitZoom]);

  // Frame the board once per shape of the scene — on open, and again when the
  // depth axis restacks it. Re-fitting on every render would fight the user's
  // own orbit, so a key guards it.
  const fittedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = `${depthMode}:${Math.round(scene.plane.width)}x${Math.round(scene.plane.height)}:${scene.layers.length}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    resetView();
  }, [depthMode, resetView, scene.layers.length, scene.plane]);

  // The surface it is framed against moves: a dock opens, a phone rotates, the
  // window resizes. Re-fit while the framing is still ours to choose.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (userZoomed.current) return;
      const zoom = fitZoom();
      setOrbit((current) => current.zoom === zoom ? current : { ...current, zoom });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitZoom]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      dragRef.current = { x: event.clientX, y: event.clientY, moved: drag.moved || Math.abs(dx) + Math.abs(dy) > CLICK_SLOP };
      setOrbit((current) => canvas3dOrbitAfterDrag(current, dx, dy));
    };
    const end = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging]);

  // React attaches wheel passively at the root, so zooming has to come from a
  // non-passive listener — otherwise the page scrolls behind the scene.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(canvas3dZoomFactorFromWheel(event.deltaY));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [zoomBy]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
    setDragging(true);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const drag = ({ ArrowLeft: [-KEYBOARD_STEP, 0], ArrowRight: [KEYBOARD_STEP, 0], ArrowUp: [0, -KEYBOARD_STEP], ArrowDown: [0, KEYBOARD_STEP] } as Record<string, [number, number]>)[event.key];
    if (drag) {
      event.preventDefault();
      setOrbit((current) => canvas3dOrbitAfterDrag(current, drag[0], drag[1]));
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      resetView();
    } else if (event.key === 'Escape') {
      // The canvas rail owns the visible way out, so the scene carries no exit
      // chrome of its own — but a keyboard user inside it still needs one, and
      // Escape is what every other mode on this surface answers to.
      event.preventDefault();
      onExit();
    }
  }, [onExit, resetView, zoomBy]);

  const layerName = useCallback(
    (index: number, label?: string) => label ?? t('threeD.layerName', { index: index + 1 }),
    [t],
  );

  // Everything the rail can drive, in one object so the rail and the phone-sized
  // action stack share the behaviour rather than each re-deriving it.
  const controls = useMemo<Canvas3DControls>(() => ({
    depthMode,
    toggleDepth: () => setDepthMode((current) => CANVAS_3D_DEPTH_MODES[(CANVAS_3D_DEPTH_MODES.indexOf(current) + 1) % CANVAS_3D_DEPTH_MODES.length]!),
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    resetView,
  }), [depthMode, resetView, zoomBy]);
  usePublishCanvas3DControls(controls);

  return (
    <section className={styles.scene} aria-label={t('threeD.title')} data-testid="canvas-3d-view">
      <div
        ref={viewportRef}
        className={styles.viewport}
        style={{ perspective: `${CANVAS_3D_PERSPECTIVE}px` }}
        data-dragging={dragging}
        tabIndex={0}
        aria-label={t('threeD.orbitLabel')}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {scene.cards.length === 0
          ? <p className={styles.empty}>{t('threeD.empty')}</p>
          : <div className={styles.stage} style={{ transform: canvas3dStageTransform(orbit) }}>
            {scene.layers.map((layer) => <div
              key={layer.index}
              className={styles.plane}
              aria-hidden
              style={{ width: scene.plane.width, height: scene.plane.height, transform: canvas3dTranslate({ x: 0, y: 0, z: layer.z }) }}
            >
              <span className={styles.planeTag}>{layerName(layer.index, layer.label)}<i>{t('threeD.layerCount', { count: layer.count })}</i></span>
            </div>)}

            {scene.links.map((link) => {
              const { transform, length } = canvas3dLinkTransform(link.from, link.to);
              return <i
                key={link.id}
                className={styles.link}
                aria-hidden
                data-spans={link.spansLayers}
                style={{ width: Math.max(1, length), transform }}
              />;
            })}

            {scene.cards.map((card) => <button
              key={card.id}
              type="button"
              className={styles.card}
              style={{
                width: card.width,
                minHeight: card.height,
                transform: canvas3dTranslate(card),
                ...(card.accent ? { ['--canvas-3d-accent' as string]: card.accent } : {}),
              }}
              aria-pressed={selected.has(card.id)}
              data-selected={selected.has(card.id)}
              onClick={() => {
                if (dragRef.current?.moved) return;
                onSelect?.(card.id);
              }}
            >
              <span className={styles.cardHead}>
                {card.icon && <i aria-hidden>{card.icon}</i>}
                <b>{card.label}</b>
              </span>
              {card.sublabel && <span className={styles.cardSub}>{card.sublabel}</span>}
              <span className={styles.cardGroup}>{card.group}</span>
            </button>)}
          </div>}
      </div>

      <footer className={styles.hint}>{t('threeD.hint')}</footer>
    </section>
  );
}
