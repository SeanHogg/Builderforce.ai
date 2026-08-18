/*
 * No `'use client'` here on purpose — same reason `CanvasPlaySurface.tsx` states
 * it: this is imported only by `CreationCanvas.tsx` (via a `dynamic(..., { ssr:
 * false })` import, since WebGL has no server-side render), which already
 * declares the boundary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { addProp, canvasWorldSceneFrom, deleteProp, type CanvasWorldPropKind, type CanvasWorldScene } from '@builderforce/creation-canvas-contract';
import { isTypingTarget } from '@/lib/keyboardTarget';
import styles from './CreationCanvas.module.css';
import { CanvasFullscreenAction } from './CanvasFullscreenAction';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import DropPlacer, { type DropPlacerHandler } from './world3d/DropPlacer';
import PropPalette, { PROP_DRAG_MIME } from './world3d/PropPalette';
import WorldPropertiesPanel from './world3d/WorldPropertiesPanel';
import { WorldViewport } from './world3d/WorldViewport';
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
  const dropHandlerRef = useRef<DropPlacerHandler | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

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
      if (isTypingTarget(event.target)) return;
      changeScene(deleteProp(scene, selectedPropId));
      setSelectedPropId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, editable, selectedPropId, scene, changeScene]);

  const actions = (
    <>
      {editable && (
        <button type="button" className={styles.objectSurfaceAction} onClick={() => setMode((current) => (current === 'edit' ? 'walk' : 'edit'))}>
          {mode === 'edit' ? t('mode.walk') : t('mode.edit')}
        </button>
      )}
      {/* The whole stage, palette included — see `CanvasFullscreenAction`. */}
      <CanvasFullscreenAction target={stageRef} />
    </>
  );

  return (
    <CanvasObjectSurface surface="world" data={data} onExit={onExit} actions={actions}>
      <div className={styles.worldStage} ref={stageRef}>
        {editable && mode === 'edit' && <PropPalette />}
        {/* The runtime is `WorldViewport`, shared with the play surface. What is
            genuinely this surface's own — placing a prop by drag, and the
            builder's banner — is contributed to it rather than reimplemented
            around a second `<Canvas>`. */}
        <WorldViewport
          scene={scene}
          mode={mode}
          selectedPropId={selectedPropId}
          onSelectProp={setSelectedPropId}
          banner={t(editable ? 'editHint' : 'viewOnlyHint')}
          sceneExtras={editable ? <DropPlacer handlerRef={dropHandlerRef} /> : null}
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
        />
        {editable && mode === 'edit' && (
          <WorldPropertiesPanel scene={scene} onChange={changeScene} selectedPropId={selectedPropId} onSelectProp={setSelectedPropId} />
        )}
      </div>
    </CanvasObjectSurface>
  );
}
