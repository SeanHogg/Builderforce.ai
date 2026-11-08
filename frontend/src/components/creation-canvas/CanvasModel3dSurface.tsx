/*
 * No `'use client'` here on purpose — same reason `CanvasWorldView.tsx` states it: this is
 * imported only through `canvasLazyPanels.ts` as a `dynamic(..., { ssr: false })` import
 * (WebGL has no server-side render), under `CreationCanvas.tsx`, which declares the boundary.
 */
import { useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import styles from './styles/creativeEditors.module.css';
import { CanvasFullscreenAction } from './CanvasFullscreenAction';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { useThemeColors } from './creative/useThemeColors';
import { Model3dExportRow } from './model3d/Model3dExportRow';
import { Model3dParts } from './model3d/Model3dParts';
import { Model3dViewport } from './model3d/Model3dViewport';
import { useModel3dEditor } from './model3d/useModel3dEditor';
import editor from './model3d/model3dEditor.module.css';
import type { CreationNodeData } from './types';

export interface CanvasModel3dSurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a read-only view: the model orbits and parts can be looked at, nothing is changed. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

const THEME_TOKENS = {
  // A plain colour: the board's own background token is a gradient, which three.js cannot parse.
  background: '--canvas-board',
  grid: '--canvas-line',
  gridSection: '--canvas-muted',
  envelope: '--canvas-muted',
  accent: '--canvas-accent',
} as const;

/**
 * CanvasModel3dSurface — the `model3d` surface: a model at full size, in 3D.
 *
 * A card can preview a solid but not turn it, so this gives it the axis the card lacks: an
 * orbit camera (one finger orbits, two pan and pinch), tap-to-select parts, and the part
 * list and fields beside it (below it at phone width). It writes the same `modelState`
 * the card does, through the `onEdit` the host hands every object surface.
 */
export function CanvasModel3dSurface({ data, onExit, onEdit }: CanvasModel3dSurfaceProps) {
  const t = useTranslations('canvas.kinds.model3d');
  const stageRef = useRef<HTMLDivElement>(null);
  const colors = useThemeColors(THEME_TOKENS, stageRef);
  const model = useModel3dEditor(data, onEdit);
  const { state, editable, selection, setSelection, actions } = model;
  const selected = useMemo(() => new Set(selection), [selection]);

  const pick = useCallback((id: string, additive: boolean) => {
    setSelection((current) => (additive
      ? (current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id])
      : (current.length === 1 && current[0] === id ? [] : [id])));
  }, [setSelection]);
  const clear = useCallback(() => setSelection([]), [setSelection]);

  return <CanvasObjectSurface surface="model3d" data={data} onExit={onExit} actions={<CanvasFullscreenAction target={stageRef} />}>
    <div className={editor.stage} ref={stageRef}>
      <Model3dViewport
        state={state}
        selection={selected}
        colors={colors}
        label={t('viewportLabel', { title: String(data.title ?? '') })}
        onSelect={pick}
        onClearSelection={clear}
      />
      <div className={editor.panel}>
        <p className={editor.panelHint}>{t(editable ? 'hint' : 'viewOnlyHint')}</p>
        <Model3dParts
          state={state}
          selection={selection}
          editable={editable}
          onSelect={setSelection}
          onAdd={actions.add}
          onRemove={actions.remove}
          onPatch={actions.patch}
          onMove={actions.move}
          onGroup={actions.group}
        />
        <div className={styles.editor}>
          <Model3dExportRow status={model.exporter.status} hasParts={state.entities.length > 0} approximated={model.approximated} onExport={model.exporter.run} />
        </div>
      </div>
    </div>
  </CanvasObjectSurface>;
}
