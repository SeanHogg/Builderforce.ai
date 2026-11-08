import { useCallback, useMemo, useRef, useState } from 'react';
import type { CreationNodeData } from '../types';
import { useCreationNodeActions } from '../bodies/nodeActions';
import { buildCadExport, type CadExportFormat } from '@/lib/creation/cad/cadExport';
import { renderCadSvg } from '@/lib/creation/cad/cadSvg';
import {
  addLayer, addShape, cadStateFrom, layerOf, nextLayerName, removeLayer, removeShapes, setActiveLayer, updateGrid, updateLayer,
  type CadGrid, type CadLayer, type CadShape, type CadState,
} from '@/lib/creation/cad/cadState';
import { seedCadFromTemplate } from '@/lib/creation/cad/cadTemplates';
import { svgDataUrl } from '@/lib/creativeGeometry';
import { useExportArtifact } from '../creative/useExportArtifact';
import { useExportPalette } from '../creative/useExportPalette';

/** A thumbnail larger than this is not worth carrying in the object's data. */
const MAX_THUMBNAIL_CHARS = 200_000;

/**
 * The CAD editor's state: the drawing on the object, what is selected, and the export.
 *
 * The drawing is `data.cadState`, read through `cadStateFrom` so a stored value that is
 * malformed (Brain wrote it, an older save) still draws. A fresh object has none and
 * shows the sheet its template asks for. Every edit writes the WHOLE drawing back with
 * `onEdit`, which is how every other body persists. Selection is held here, not in the
 * drawing — clicking a shape must not write the object.
 */
export function useCadEditor(data: CreationNodeData) {
  const { edit: onEdit } = useCreationNodeActions();
  const palette = useExportPalette();
  const state = useMemo(
    () => (data.cadState ? cadStateFrom(data.cadState, palette.layerInk) : seedCadFromTemplate(data.templateId, palette.layerInk)),
    [data.cadState, data.templateId, palette.layerInk],
  );
  const [selection, setSelection] = useState<readonly string[]>([]);
  const latest = useRef({ state, data });
  latest.current = { state, data };
  const editable = !!onEdit;

  const commit = useCallback((next: CadState) => { onEdit?.({ cadState: next } as Partial<CreationNodeData>); }, [onEdit]);
  /** Apply an edit to the LATEST drawing, so two edits in one tick do not overwrite each other. */
  const change = useCallback((edit: (current: CadState) => CadState) => {
    const next = edit(latest.current.state);
    if (next === latest.current.state) return;
    latest.current = { ...latest.current, state: next };
    commit(next);
  }, [commit]);

  const draw = useCallback((shape: CadShape) => {
    if (layerOf(latest.current.state, shape.layer)?.locked) return;
    change((current) => addShape(current, shape));
    setSelection([shape.id]);
  }, [change]);

  const deleteSelected = useCallback(() => {
    const doomed = selection;
    if (!doomed.length) return;
    change((current) => removeShapes(current, doomed));
    setSelection([]);
  }, [change, selection]);

  const layers = useMemo(() => ({
    add: (prefix: string) => change((current) => {
      const name = nextLayerName(current, prefix);
      return setActiveLayer(addLayer(current, { name, visible: true, locked: false, color: palette.layerInk }), name);
    }),
    remove: (name: string) => { change((current) => removeLayer(current, name)); setSelection([]); },
    update: (name: string, patch: Partial<Omit<CadLayer, 'name'>>) => change((current) => updateLayer(current, name, patch)),
    activate: (name: string) => change((current) => setActiveLayer(current, name)),
  }), [change, palette.layerInk]);

  const setGrid = useCallback((patch: Partial<CadGrid>) => change((current) => updateGrid(current, patch)), [change]);

  const exporter = useExportArtifact<CadExportFormat>({
    data,
    artifactKind: 'cad',
    onEdit,
    render: async (format, object) => {
      const drawing = latest.current.state;
      const file = buildCadExport(drawing, format, String(object.title ?? ''), palette.paper);
      const svg = renderCadSvg(drawing, palette.paper);
      return {
        ...file,
        detail: `${drawing.widthMm} × ${drawing.heightMm} ${drawing.unit} · ${drawing.shapes.length} shapes`,
        asOutput: true,
        thumbnailUrl: svg.length <= MAX_THUMBNAIL_CHARS ? svgDataUrl(svg) : null,
        metadata: { shapes: drawing.shapes.length },
        // The drawing is written with the export so the file and the object cannot disagree.
        patch: { cadState: drawing } as Partial<CreationNodeData>,
      };
    },
  });

  return { state, editable, selection, setSelection, draw, deleteSelected, layers, setGrid, exporter, palette };
}
