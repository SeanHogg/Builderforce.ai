'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  CANVAS_3D_DEFAULT_ORBIT,
  CANVAS_3D_DEPTH_MODES,
  CANVAS_3D_PERSPECTIVE,
  canvas3dCameraTransform,
  canvas3dDepthFromDrag,
  canvas3dLinkTransform,
  canvas3dOrbitAfterDrag,
  canvas3dOrbitAfterZoom,
  canvas3dFitZoom,
  canvas3dPanAfterDrag,
  canvas3dPanToCentre,
  canvas3dScene,
  canvas3dStageTransform,
  canvas3dTranslate,
  canvas3dUnprojectToPlane,
  canvas3dZoomFactorFromWheel,
  type Canvas3DCard,
  type Canvas3DDepthMode,
  type Canvas3DDescriptor,
  type Canvas3DDragAxis,
  type Canvas3DNode,
  type Canvas3DOrbit,
} from './canvas3d';
import { usePublishCanvas3DControls, type Canvas3DControls } from './canvas3dControls';
import type { CanvasGraphEdge } from './canvasGraph';
import { loadMeshTriangles, meshProjectionUrl } from '@/lib/meshPreviewCache';
import styles from './Canvas3DView.module.css';

/** One object's movement through the space, in board pixels. */
export interface Canvas3DMove {
  id: string;
  dx: number;
  dy: number;
  /** Change in how far the object floats off its depth plane. */
  dz: number;
}

export interface Canvas3DViewProps<T extends Canvas3DNode> {
  nodes: readonly T[];
  edges: readonly CanvasGraphEdge[];
  /** How this canvas labels and colours one of its objects. */
  describe: (node: T) => Canvas3DDescriptor;
  /** Canvas-specific footprint, when a canvas knows more than the measured box. */
  measure?: (node: T) => { width: number; height: number };
  selectedIds?: readonly string[];
  onSelect?: (id: string) => void;
  /**
   * Put objects where the user drags them. Omit it and the space becomes a
   * read-only reading of the board — which is what a viewer without edit rights
   * gets, without the caller having to disable anything.
   */
  onMove?: (moves: readonly Canvas3DMove[]) => void;
  /** Leave 3D. The visible control lives on the canvas rail; this is the Escape key. */
  onExit: () => void;
}

/** Pointer travel, in pixels, past which a gesture is a drag and not a click. */
const CLICK_SLOP = 3;
const KEYBOARD_STEP = 12;
/** Depth is coarser than the board, so a keyed depth step covers more ground. */
const KEYBOARD_DEPTH_STEP = 40;
const ZOOM_STEP = 1.25;
/** Quiet time after the camera stops before a mesh is re-drawn from its triangles. */
const SETTLE_DELAY = 160;

/** Where the pointer was last seen, which every gesture measures itself from. */
type PointerAt = { x: number; y: number };

/** What the pointer is currently doing to the scene. */
type Gesture =
  | ({ kind: 'orbit' } & PointerAt)
  | ({ kind: 'pan' } & PointerAt)
  /** Two fingers on the space: `x`/`y` are their midpoint, `spread` their distance apart. */
  | ({ kind: 'pinch'; spread: number } & PointerAt)
  | ({
    kind: 'move';
    /** Only the finger that picked the object up may move it. */
    pointerId: number;
    axis: Canvas3DDragAxis;
    /** Everything travelling with this drag, and where each started. */
    from: ReadonlyMap<string, { x: number; y: number; z: number }>;
    /** The plane the drag is solved on, and the point the cursor grabbed on it. */
    planeZ: number;
    grab: { x: number; y: number };
    /** Board travel already handed to the canvas, so each step sends only the difference. */
    sent: { x: number; y: number; z: number };
  } & PointerAt);

/**
 * The step an arrow key asks for, or null for any other key.
 *
 * The space and a focused object read the same four keys — the space turns, the
 * object moves — so they read them the same way rather than each spelling the
 * map out.
 */
function arrowStep(key: string): [number, number] | null {
  if (key === 'ArrowLeft') return [-KEYBOARD_STEP, 0];
  if (key === 'ArrowRight') return [KEYBOARD_STEP, 0];
  if (key === 'ArrowUp') return [0, -KEYBOARD_STEP];
  if (key === 'ArrowDown') return [0, KEYBOARD_STEP];
  return null;
}

/** The midpoint and separation of the first two pointers, or null if there aren't two. */
function twoFingerGrip(pointers: ReadonlyMap<number, PointerAt>): { x: number; y: number; spread: number } | null {
  const [first, second] = [...pointers.values()];
  if (!first || !second) return null;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    spread: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

/**
 * The 3D canvas: the board as a space to turn, travel and rearrange.
 *
 * Rendered as real DOM under CSS 3D transforms rather than a WebGL scene, which
 * is what keeps every card a focusable button with its own text — the view stays
 * usable from the keyboard and by assistive tech, and it costs no new runtime.
 * Selection is shared with the flat canvas, so opening an object in 3D shows the
 * same inspector the board would, and moving one here moves it there.
 *
 * The scene owns no chrome. Depth, layers, zoom and reset are published to the
 * canvas command rail (see `canvas3dControls`), so 3D adds buttons to the bar the
 * board already has rather than stacking a second toolbar over it.
 */
export function Canvas3DView<T extends Canvas3DNode>({
  nodes,
  edges,
  describe,
  measure,
  selectedIds = [],
  onSelect,
  onMove,
  onExit,
}: Canvas3DViewProps<T>) {
  const t = useTranslations('canvasCommands');
  const [orbit, setOrbit] = useState<Canvas3DOrbit>(CANVAS_3D_DEFAULT_ORBIT);
  const [depthMode, setDepthMode] = useState<Canvas3DDepthMode>('flow');
  const [layersVisible, setLayersVisible] = useState(true);
  const [gestureKind, setGestureKind] = useState<Gesture['kind'] | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** Pointers currently down on the space itself, so a second finger can be noticed. */
  const touching = useRef(new Map<number, PointerAt>());
  /** True once the current gesture has travelled far enough to not be a click. */
  const movedRef = useRef(false);

  const scene = useMemo(
    () => canvas3dScene({ nodes, edges, describe, depthMode, ...(measure ? { measure } : {}) }),
    [depthMode, describe, edges, measure, nodes],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Gestures read the live orbit and scene from refs: a pointer listener that
  // re-subscribed on every frame of its own drag would drop events mid-move.
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const fitZoom = useCallback(
    () => canvas3dFitZoom(scene.plane, viewportRef.current?.getBoundingClientRect() ?? null),
    [scene.plane],
  );
  const fitZoomRef = useRef(fitZoom);
  fitZoomRef.current = fitZoom;
  /**
   * Once the user frames the space themselves — zooming, panning, or moving an
   * object — the view stops re-framing itself behind their back.
   */
  const userFramed = useRef(false);
  const zoomBy = useCallback((factor: number) => {
    userFramed.current = true;
    setOrbit((current) => canvas3dOrbitAfterZoom(current, factor));
  }, []);
  const resetView = useCallback(() => {
    userFramed.current = false;
    setOrbit({ ...CANVAS_3D_DEFAULT_ORBIT, zoom: fitZoomRef.current() });
  }, []);

  // Frame the space on open, and again when the depth axis restacks it into a
  // different shape. Anything finer would fight the user's own camera.
  useLayoutEffect(() => { resetView(); }, [depthMode, resetView]);

  // The scene grows as objects are added and moved, and the surface it is framed
  // against moves too — a dock opens, a phone rotates. Re-fit the zoom only, and
  // only while the framing is still ours to choose: resetting the whole camera
  // here would throw away the angle the user turned to.
  useEffect(() => {
    if (userFramed.current) return;
    const zoom = fitZoom();
    setOrbit((current) => current.zoom === zoom ? current : { ...current, zoom });
  }, [fitZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (userFramed.current) return;
      const zoom = fitZoomRef.current();
      setOrbit((current) => current.zoom === zoom ? current : { ...current, zoom });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  /** Pointer position measured from the middle of the viewport, where the scene is centred. */
  const fromCentre = useCallback((event: { clientX: number; clientY: number }) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: event.clientX - (box.left + box.width / 2), y: event.clientY - (box.top + box.height / 2) };
  }, []);

  useEffect(() => {
    if (!gestureKind) return;
    const move = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (touching.current.has(event.pointerId)) touching.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // Two fingers travel and zoom together, which is the only way to reach the
      // far side of the space on a touch screen: there is no middle button to
      // hold and no Shift to press, and one finger is already turning the space.
      if (gesture.kind === 'pinch') {
        const grip = twoFingerGrip(touching.current);
        if (!grip) return;
        movedRef.current = true;
        userFramed.current = true;
        const factor = gesture.spread > 0 ? grip.spread / gesture.spread : 1;
        const travelX = grip.x - gesture.x;
        const travelY = grip.y - gesture.y;
        gestureRef.current = { kind: 'pinch', ...grip };
        setOrbit((current) => canvas3dPanAfterDrag(canvas3dOrbitAfterZoom(current, factor), travelX, travelY));
        return;
      }

      // A second finger landing mid-drag must not jerk the object with it.
      if (gesture.kind === 'move' && gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) movedRef.current = true;

      if (gesture.kind === 'orbit') {
        gestureRef.current = { ...gesture, x: event.clientX, y: event.clientY };
        setOrbit((current) => canvas3dOrbitAfterDrag(current, dx, dy));
        return;
      }
      if (gesture.kind === 'pan') {
        userFramed.current = true;
        gestureRef.current = { ...gesture, x: event.clientX, y: event.clientY };
        setOrbit((current) => canvas3dPanAfterDrag(current, dx, dy));
        return;
      }

      // Moving objects. Depth is measured step by step along the one screen
      // direction depth runs in; across the plane the pointer is read straight
      // back into the space, so the object stays exactly under the cursor
      // however long the drag runs.
      const travelled = gesture.axis === 'depth'
        ? { x: 0, y: 0, z: gesture.sent.z + canvas3dDepthFromDrag(orbitRef.current, { dx, dy }, { x: gesture.grab.x, y: gesture.grab.y, z: gesture.planeZ }) }
        : (() => {
          const at = canvas3dUnprojectToPlane(orbitRef.current, fromCentre(event), gesture.planeZ);
          return at ? { x: at.x - gesture.grab.x, y: at.y - gesture.grab.y, z: 0 } : gesture.sent;
        })();

      const step = { x: travelled.x - gesture.sent.x, y: travelled.y - gesture.sent.y, z: travelled.z - gesture.sent.z };
      gestureRef.current = { ...gesture, x: event.clientX, y: event.clientY, sent: travelled };
      if (!step.x && !step.y && !step.z) return;
      onMoveRef.current?.([...gesture.from.keys()].map((id) => ({ id, dx: step.x, dy: step.y, dz: step.z })));
    };
    const end = (event: PointerEvent) => {
      touching.current.delete(event.pointerId);
      const gesture = gestureRef.current;
      // A drag ends when the finger that started it lifts — not when some other
      // pointer that was never part of it happens to come up.
      if (gesture?.kind === 'move') {
        if (gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        setGestureKind(null);
        return;
      }
      // Lifting one finger of a pinch hands the space back to the other one,
      // rather than ending the gesture halfway through and stranding the user.
      const remaining = [...touching.current.values()];
      if (gesture?.kind === 'pinch' && remaining.length === 1) {
        gestureRef.current = { kind: 'orbit', ...remaining[0]! };
        setGestureKind('orbit');
        return;
      }
      if (touching.current.size) return;
      gestureRef.current = null;
      setGestureKind(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [fromCentre, gestureKind]);

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

  /**
   * Turning the space, or travelling across it.
   *
   * One pointer turns it. A second one — or the middle button, or Shift — travels
   * and zooms instead, so every input has a way to reach the far side of a space
   * the user has zoomed into.
   */
  const onViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
    touching.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const grip = twoFingerGrip(touching.current);
    if (grip) {
      movedRef.current = true;
      gestureRef.current = { kind: 'pinch', ...grip };
      setGestureKind('pinch');
      return;
    }
    movedRef.current = false;
    const kind: 'orbit' | 'pan' = event.button === 1 || event.shiftKey ? 'pan' : 'orbit';
    gestureRef.current = kind === 'pan'
      ? { kind: 'pan', x: event.clientX, y: event.clientY }
      : { kind: 'orbit', x: event.clientX, y: event.clientY };
    setGestureKind(kind);
  }, []);

  /**
   * Everything this drag carries. Dragging a selected object moves the whole
   * selection, which is how the flat board behaves and the only way to keep a
   * group of objects together while rearranging the space.
   */
  const dragParty = useCallback((card: Canvas3DCard): Map<string, { x: number; y: number; z: number }> => {
    const travelling = selected.has(card.id)
      ? sceneRef.current.cards.filter((entry) => selected.has(entry.id) && !entry.locked)
      : [card];
    return new Map(travelling.map((entry) => [entry.id, { x: entry.x, y: entry.y, z: entry.z }]));
  }, [selected]);

  const onCardPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, card: Canvas3DCard) => {
    // A locked or read-only card is not a handle: the drag falls through to the
    // viewport underneath and turns the space instead, which is more useful than
    // a gesture that silently does nothing.
    if (!onMoveRef.current || card.locked) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Shift pans the space, so on an object it lifts instead — the same modifier
    // meaning "the other axis" in both places.
    const axis: Canvas3DDragAxis = event.shiftKey ? 'depth' : 'plane';
    const grab = axis === 'depth'
      ? { x: card.x, y: card.y }
      : canvas3dUnprojectToPlane(orbitRef.current, fromCentre(event), card.z);
    if (!grab) return;

    event.stopPropagation();
    movedRef.current = false;
    userFramed.current = true;
    gestureRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      axis,
      from: dragParty(card),
      planeZ: card.z,
      grab,
      x: event.clientX,
      y: event.clientY,
      sent: { x: 0, y: 0, z: 0 },
    };
    setGestureKind('move');
  }, [dragParty, fromCentre]);

  /** Nudge whatever this card is carrying, in board units, from the keyboard. */
  const nudge = useCallback((card: Canvas3DCard, dx: number, dy: number, dz: number) => {
    if (!onMoveRef.current || card.locked) return;
    userFramed.current = true;
    onMoveRef.current([...dragParty(card).keys()].map((id) => ({ id, dx, dy, dz })));
  }, [dragParty]);

  const onCardKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, card: Canvas3DCard) => {
    const step = arrowStep(event.key);
    if (!step || !onMoveRef.current || card.locked) return;
    // The card owns its arrow keys while it is focused; the viewport keeps them
    // for orbiting, so the gesture must not reach it as well.
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) nudge(card, 0, 0, -step[1] * (KEYBOARD_DEPTH_STEP / KEYBOARD_STEP));
    else nudge(card, step[0], step[1], 0);
  }, [nudge]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event.key);
    if (step) {
      event.preventDefault();
      if (event.shiftKey) {
        userFramed.current = true;
        setOrbit((current) => canvas3dPanAfterDrag(current, -step[0], -step[1]));
      } else {
        setOrbit((current) => canvas3dOrbitAfterDrag(current, step[0], step[1]));
      }
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

  /**
   * The camera angle a mesh preview is drawn from.
   *
   * It trails the live orbit on purpose. Re-projecting thousands of facets on
   * every pointer move would spend the whole frame budget redrawing a thumbnail,
   * so the mesh is redrawn once the camera has come to rest — and mid-gesture the
   * card simply keeps the last angle it was drawn at, which is exactly what the
   * rest of the scene is doing anyway.
   */
  const [settled, setSettled] = useState({ yaw: CANVAS_3D_DEFAULT_ORBIT.yaw, pitch: CANVAS_3D_DEFAULT_ORBIT.pitch });
  useEffect(() => {
    if (gestureKind) return;
    const timer = window.setTimeout(
      () => setSettled({ yaw: Math.round(orbit.yaw), pitch: Math.round(orbit.pitch) }),
      SETTLE_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [gestureKind, orbit.pitch, orbit.yaw]);

  /**
   * Generated meshes, drawn from where the camera actually is.
   *
   * Without this a model3d object shows a picture taken at one fixed angle: the
   * scene turns and the object in it does not, which is a photograph on a card
   * rather than a thing in a space. The triangles are read once per exported file
   * and cached (see `meshPreviewCache`); only the projection is redone.
   */
  const [meshPreviews, setMeshPreviews] = useState<Record<string, string>>({});
  const geometryKey = scene.cards.map((card) => card.geometry?.url ?? '').join('\u0000');
  useEffect(() => {
    const withGeometry = sceneRef.current.cards.filter((card) => card.geometry?.url);
    if (!withGeometry.length) {
      setMeshPreviews((current) => Object.keys(current).length ? {} : current);
      return;
    }
    let live = true;
    void Promise.all(withGeometry.map(async (card) => {
      const geometry = card.geometry!;
      const triangles = await loadMeshTriangles(geometry.url, geometry.format);
      // The card lies flat in the space, so the mesh is drawn from the camera's
      // own direction written in the board's frame: the same turntable angle, and
      // the opposite elevation, because the board measures Y down the screen.
      return [card.id, meshProjectionUrl(geometry.url, triangles, settled.yaw, -settled.pitch)] as const;
    })).then((drawn) => {
      if (!live) return;
      const next = Object.fromEntries(drawn.filter((entry): entry is readonly [string, string] => entry[1] !== null));
      setMeshPreviews((current) => {
        const unchanged = Object.keys(next).length === Object.keys(current).length
          && Object.entries(next).every(([id, url]) => current[id] === url);
        return unchanged ? current : next;
      });
    });
    return () => { live = false; };
    // Keyed on WHICH files are in the scene rather than on the card objects, so
    // dragging an object does not re-read every mesh on the board.
  }, [geometryKey, settled.pitch, settled.yaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const layerName = useCallback(
    (index: number, label?: string) => label ?? t('threeD.layerName', { index: index + 1 }),
    [t],
  );

  /** Objects the user has lifted off their plane, and by how much. */
  const lifted = useMemo(
    () => scene.cards.filter((card) => card.z !== card.layerZ),
    [scene.cards],
  );
  const dropToLayers = useCallback(() => {
    if (!onMoveRef.current || !lifted.length) return;
    onMoveRef.current(lifted.filter((card) => !card.locked).map((card) => ({ id: card.id, dx: 0, dy: 0, dz: card.layerZ - card.z })));
  }, [lifted]);

  /**
   * Travel to a chosen object. Only the camera moves — focusing on something is
   * a question about where the user is looking from, never about where the
   * object sits.
   */
  const focusObjects = useCallback((ids: readonly string[]) => {
    const wanted = new Set(ids);
    const chosen = sceneRef.current.cards.filter((card) => wanted.has(card.id));
    if (!chosen.length) return;
    userFramed.current = true;
    setOrbit((current) => canvas3dPanToCentre(current, {
      x: chosen.reduce((total, card) => total + card.x, 0) / chosen.length,
      y: chosen.reduce((total, card) => total + card.y, 0) / chosen.length,
      z: chosen.reduce((total, card) => total + card.z, 0) / chosen.length,
    }));
  }, []);

  // Everything the rail can drive, in one object so the rail and the phone-sized
  // action stack share the behaviour rather than each re-deriving it.
  const controls = useMemo<Canvas3DControls>(() => ({
    depthMode,
    toggleDepth: () => setDepthMode((current) => CANVAS_3D_DEPTH_MODES[(CANVAS_3D_DEPTH_MODES.indexOf(current) + 1) % CANVAS_3D_DEPTH_MODES.length]!),
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    resetView,
    focusObjects,
    layersVisible,
    toggleLayers: () => setLayersVisible((visible) => !visible),
    ...(onMove && lifted.some((card) => !card.locked) ? { dropToLayers } : {}),
  }), [depthMode, dropToLayers, focusObjects, layersVisible, lifted, onMove, resetView, zoomBy]);
  usePublishCanvas3DControls(controls);

  return (
    <section className={styles.scene} aria-label={t('threeD.title')} data-testid="canvas-3d-view">
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-gesture={gestureKind ?? 'idle'}
        tabIndex={0}
        aria-label={t(onMove ? 'threeD.spaceLabel' : 'threeD.orbitLabel')}
        onPointerDown={onViewportPointerDown}
        onKeyDown={onKeyDown}
      >
        {scene.cards.length === 0
          ? <p className={styles.empty}>{t('threeD.empty')}</p>
          : <div className={styles.camera} style={{ perspective: `${CANVAS_3D_PERSPECTIVE}px`, transform: canvas3dCameraTransform(orbit) }}>
            <div className={styles.stage} style={{ transform: canvas3dStageTransform(orbit) }}>
              {layersVisible && scene.layers.map((layer) => <div
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

              {/* A lifted object keeps a line back to the plane it belongs to, so
                  depth stays readable once the stack is no longer flat. */}
              {layersVisible && lifted.map((card) => {
                const { transform, length } = canvas3dLinkTransform({ x: card.x, y: card.y, z: card.layerZ }, card);
                return <i
                  key={`tether:${card.id}`}
                  className={styles.tether}
                  aria-hidden
                  style={{ width: Math.max(1, length), transform }}
                />;
              })}

              {scene.cards.map((card) => {
                const solid = meshPreviews[card.id];
                return <button
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
                data-movable={!!onMove && !card.locked}
                onPointerDown={(event) => onCardPointerDown(event, card)}
                onKeyDown={(event) => onCardKeyDown(event, card)}
                onClick={(event) => {
                  // A drag is not a click — but Enter and Space on a focused card
                  // are (`detail` is 0), and those must still open the object even
                  // when the last thing the pointer did was move something.
                  if (event.detail !== 0 && movedRef.current) return;
                  onSelect?.(card.id);
                }}
              >
                <span className={styles.cardHead}>
                  {card.icon && <i aria-hidden>{card.icon}</i>}
                  <b>{card.label}</b>
                </span>
                {(solid ?? card.preview) && <img
                  className={styles.cardPreview}
                  // A mesh is drawn from the camera, so it has to face the camera:
                  // the card lies flat in the space, and undoing the stage rotation
                  // here stands the object up on it instead of painting a picture
                  // of it onto the floor.
                  data-solid={!!solid}
                  {...(solid ? { style: { transform: `rotateY(${-orbit.yaw}deg) rotateX(${-orbit.pitch}deg)` } } : {})}
                  src={solid ?? card.preview}
                  alt={t('threeD.previewAlt', { label: card.label })}
                  loading="lazy"
                  draggable={false}
                />}
                {card.sublabel && <span className={styles.cardSub}>{card.sublabel}</span>}
                <span className={styles.cardGroup}>{card.group}</span>
              </button>;
              })}
            </div>
          </div>}
      </div>

      <footer className={styles.hint}>{t(onMove ? 'threeD.spaceHint' : 'threeD.hint')}</footer>
    </section>
  );
}
