import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreationNodeData } from '../types';
import { buildModel3dExport, model3dPreviewUrl, type Model3dExportFormat } from '@/lib/creation/model3d/model3dExport';
import {
  addBooleanOp, addBox, addCylinder, addSphere, deleteEntities, model3dStateFrom, updateEntity,
  type BooleanOperation, type Model3dEntity, type Model3dState, type V3,
} from '@/lib/creation/model3d/model3dState';
import { useExportArtifact } from '../creative/useExportArtifact';
import { useExportPalette } from '../creative/useExportPalette';

export type PrimitiveKind = 'box' | 'cylinder' | 'sphere';

const ADDERS: Record<PrimitiveKind, (state: Model3dState) => { state: Model3dState; id: string }> = {
  box: (state) => addBox(state),
  cylinder: (state) => addCylinder(state),
  sphere: (state) => addSphere(state),
};

/**
 * The 3D model editor's state, shared by the card and the full-size surface: the scene on
 * the object (`data.modelState`), what is selected, and the export.
 *
 * The scene is read through `model3dStateFrom`, so a stored value that is malformed still
 * draws. Every edit writes the WHOLE scene back with `onEdit` — the card passes the
 * board's edit action, the surface its own. Selection is the editor's and is not stored.
 */
export function useModel3dEditor(data: CreationNodeData, onEdit?: (patch: Partial<CreationNodeData>) => void) {
  const { material } = useExportPalette();
  const state = useMemo(() => model3dStateFrom(data.modelState, material), [data.modelState, material]);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const latest = useRef({ state, data });
  // Written after render, not during it: a render that React discards must not leave its state behind.
  // Edits made in the same tick advance `latest` themselves (see `change`).
  useEffect(() => { latest.current = { state, data }; }, [state, data]);
  const editable = !!onEdit;

  const commit = useCallback((next: Model3dState) => { onEdit?.({ modelState: next } as Partial<CreationNodeData>); }, [onEdit]);
  /** Apply an edit to the LATEST scene, so two edits in one tick do not overwrite each other. */
  const change = useCallback((edit: (current: Model3dState) => Model3dState) => {
    const next = edit(latest.current.state);
    if (next === latest.current.state) return;
    latest.current = { ...latest.current, state: next };
    commit(next);
  }, [commit]);

  const actions = useMemo(() => ({
    add: (kind: PrimitiveKind) => {
      const added = ADDERS[kind](latest.current.state);
      latest.current = { ...latest.current, state: added.state };
      commit(added.state);
      setSelection([added.id]);
    },
    remove: (ids: readonly string[]) => { change((current) => deleteEntities(current, ids)); setSelection([]); },
    patch: (id: string, patch: Partial<Model3dEntity>) => change((current) => updateEntity(current, id, patch)),
    move: (id: string, translate: V3) => change((current) => updateEntity(current, id, { translate })),
    group: (op: BooleanOperation, ids: readonly string[]) => {
      // Fewer than two existing parts: the control that calls this is disabled, so this is a stale click.
      const existing = new Set(ids.filter((id) => latest.current.state.entities.some((entity) => entity.id === id)));
      if (existing.size < 2) return;
      const grouped = addBooleanOp(latest.current.state, op, ids);
      latest.current = { ...latest.current, state: grouped.state };
      commit(grouped.state);
      setSelection([grouped.id]);
    },
  }), [change, commit]);

  const [approximated, setApproximated] = useState(0);
  const exporter = useExportArtifact<Model3dExportFormat>({
    data,
    artifactKind: 'model3d',
    onEdit,
    render: async (format, object) => {
      const scene = latest.current.state;
      const file = buildModel3dExport(scene, format, String(object.title ?? ''));
      setApproximated(file.approximated);
      return {
        blob: file.blob, fileName: file.fileName, mimeType: file.mimeType, label: file.label,
        detail: `${scene.entities.length} parts · ${file.triangleCount} triangles`,
        asOutput: true,
        thumbnailUrl: model3dPreviewUrl(scene),
        metadata: { parts: scene.entities.length, triangles: file.triangleCount, approximatedBooleans: file.approximated },
        patch: { modelState: scene } as Partial<CreationNodeData>,
      };
    },
  });

  const previewUrl = useMemo(() => model3dPreviewUrl(state), [state]);

  return { state, editable, selection, setSelection, actions, exporter, approximated, previewUrl };
}
