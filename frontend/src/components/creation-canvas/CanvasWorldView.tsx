/*
 * No `'use client'` here on purpose — same reason `CanvasPlaySurface.tsx` states
 * it: this is imported only by `CreationCanvas.tsx` (via a `dynamic(..., { ssr:
 * false })` import, since WebGL has no server-side render), which already
 * declares the boundary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import { addProp, canvasWorldSceneFrom, type CanvasWorldPropKind, type CanvasWorldScene } from '@builderforce/creation-canvas-contract';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import Scene3D from './world3d/Scene3D';
import DropPlacer, { type DropPlacerHandler } from './world3d/DropPlacer';
import PropPalette, { PROP_DRAG_MIME } from './world3d/PropPalette';
import WorldPropertiesPanel from './world3d/WorldPropertiesPanel';
import { DEFAULT_WALKER_COLOR } from './world3d/PlayerController';
import type { CreationNodeData } from './types';

/**
 * CanvasWorldView — the `world` surface: a true 3D authoring space. Build
 * mode places props with a palette drag, moves the camera on an orbit, and
 * edits the selected prop from the right rail; Walk mode drops a first- or
 * third-person walker into the scene with real Rapier collision against
 * every collider prop. Closes the roadmap gap `scene3d` never did — that
 * surface reads the flat board's own objects from outside; this one is an
 * independently authored place with its own camera and props.
 *
 * Adapted from hired.video's `GameStage3D.tsx`, which is the proven,
 * shipped version of this runtime — ported rather than hand-rolled. Trimmed
 * to authoring: no multiplayer room, no IndexedDB offline mirror, no AI
 * agent side panel (Brain already edits `world` through this canvas's own
 * generic `MUTABLE_FIELDS` mechanism), no challenge/invite chrome. See
 * `lib/canvasWorld` (via `@builderforce/creation-canvas-contract`)'s header
 * for the full list of what didn't come with it and why.
 */

export interface CanvasWorldViewProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a read-only view (no edit rights) — Walk mode still works,
   *  Build mode's palette and properties rail are hidden. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

export function CanvasWorldView({ data, onExit, onEdit }: CanvasWorldViewProps) {
  const t = useTranslations('creationCanvas.surface.world');
  const scene = useMemo(() => canvasWorldSceneFrom(data.world), [data.world]);
  const editable = Boolean(onEdit);

  const [mode, setMode] = useState<'edit' | 'walk'>('edit');
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [respawnNonce, setRespawnNonce] = useState(0);
  const [cameraView, setCameraView] = useState<'first' | 'third'>('first');
  const dropHandlerRef = useRef<DropPlacerHandler | null>(null);

  // A read-only viewer has no palette or properties rail to select from — a
  // stale selection from a previous editable session would otherwise show
  // chrome that can no longer act on it.
  useEffect(() => { if (!editable) setSelectedPropId(null); }, [editable]);

  const changeScene = useCallback((next: CanvasWorldScene) => onEdit?.({ world: next }), [onEdit]);

  const placeProp = useCallback((kind: CanvasWorldPropKind, position: [number, number, number]) => {
    const result = addProp(scene, { kind, position: [position[0], position[1] + 0.5, position[2]] });
    changeScene(result.scene);
    setSelectedPropId(result.prop.id);
  }, [scene, changeScene]);

  // Delete-key shortcut for the selected prop, mirroring the board's own
  // node-deletion shortcut.
  useEffect(() => {
    if (mode !== 'edit' || !editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (!selectedPropId) return;
      if (event.code !== 'Delete' && event.code !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      changeScene({ ...scene, props: scene.props.filter((prop) => prop.id !== selectedPropId) });
      setSelectedPropId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, editable, selectedPropId, scene, changeScene]);

  // `V` flips first/third person while walking, same as the on-canvas button.
  useEffect(() => {
    if (mode !== 'walk') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyV') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      setCameraView((view) => (view === 'first' ? 'third' : 'first'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const actions = (
    <>
      {editable && (
        <button type="button" className={styles.objectSurfaceAction} onClick={() => setMode((current) => (current === 'edit' ? 'walk' : 'edit'))}>
          {mode === 'edit' ? t('mode.walk') : t('mode.edit')}
        </button>
      )}
    </>
  );

  return (
    <CanvasObjectSurface surface="world" data={data} onExit={onExit} actions={actions}>
      <div className={styles.worldStage}>
        {editable && mode === 'edit' && <PropPalette />}
        <div
          className={styles.worldViewport}
          onDragOver={(event) => {
            if (mode !== 'edit' || !editable) return;
            if (!event.dataTransfer.types.includes(PROP_DRAG_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => {
            if (mode !== 'edit' || !editable) return;
            const position = dropHandlerRef.current?.(event.clientX, event.clientY);
            if (!position) return;
            const kind = event.dataTransfer.getData(PROP_DRAG_MIME) as CanvasWorldPropKind | '';
            if (!kind) return;
            event.preventDefault();
            placeProp(kind, position);
          }}
        >
          <Canvas shadows camera={{ position: [12, 10, 12], fov: 60, near: 0.1, far: 500 }} tabIndex={mode === 'walk' ? 0 : -1}>
            <Scene3D
              scene={scene}
              mode={mode}
              selectedPropId={selectedPropId}
              onSelectProp={setSelectedPropId}
              respawnNonce={respawnNonce}
              cameraView={cameraView}
              walkerColor={DEFAULT_WALKER_COLOR}
            />
            {mode === 'edit' && editable && <DropPlacer handlerRef={dropHandlerRef} />}
          </Canvas>

          {mode === 'edit' && (
            <div className={styles.worldBanner}>{t(editable ? 'editHint' : 'viewOnlyHint')}</div>
          )}

          {mode === 'walk' && (
            <>
              <div className={styles.worldBannerTop}>{t('walkHint')}</div>
              <button type="button" className={styles.worldRespawnAction} onClick={() => setRespawnNonce((n) => n + 1)} title={t('respawn')}>
                {t('respawn')}
              </button>
              <button
                type="button"
                className={styles.worldCameraAction}
                onClick={() => setCameraView((view) => (view === 'first' ? 'third' : 'first'))}
                title={cameraView === 'first' ? t('switchToThird') : t('switchToFirst')}
              >
                {cameraView === 'first' ? t('cameraThird') : t('cameraFirst')}
              </button>
            </>
          )}
        </div>
        {editable && mode === 'edit' && (
          <WorldPropertiesPanel scene={scene} onChange={changeScene} selectedPropId={selectedPropId} onSelectProp={setSelectedPropId} />
        )}
      </div>
    </CanvasObjectSurface>
  );
}
