/** Materialising dataset views — visualise, plot, profile. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from 'react';
import { type MaterializeResult, plotDataset as plotDatasetUseCase, profileDataset as profileDatasetUseCase, visualizeDataset as visualizeDatasetUseCase } from '@/domains/canvas/application/MaterializeDataset';
import type { CreationObjectKind } from '../types';
import { newNode } from '../canvasNodeHelpers';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CreationFlowNode } from '../CreationNode';
import type { Edge } from '@xyflow/react';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { Formatter } from '@/i18n/format';

export interface UseCanvasDatasetViewsDeps {
  canvasText: CanvasTextTranslator;
  fmt: Formatter;
  nodes: CanvasObject[];
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  selectedNode: CanvasObject | null;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}

export function useCanvasDatasetViews({ canvasText, fmt, nodes, openNodeInspector, placeAppendedRef, selectedNode, setEdges, setNodes, setNotice, setSelectedId }: UseCanvasDatasetViewsDeps) {
  /**
   * Apply what a materialisation use case decided.
   *
   * ONE place that turns a `MaterializeResult` into board state, because "add the
   * object, connect it to its source, select it, open its inspector, say so" is
   * the same five steps for a chart and for a map — and they were written twice,
   * so the map already differed from the chart in ways nobody had chosen.
   */
  const applyMaterialization = useCallback((result: MaterializeResult) => {
    if (!result.ok) { setNotice(result.notice); return; }
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [result.object])]);
    setEdges((current) => [...current, result.edge]);
    setSelectedId(result.object.id);
    openNodeInspector(result.object.id);
    setNotice(result.notice);
  }, [openNodeInspector, setEdges, setNodes, setNotice]);

  /** The dependencies every materialisation takes: how to speak to the person, and
   *  how to build an object of a kind (the factory reads the object registry, which
   *  the application layer must not import). */
  const materializeDeps = useMemo(
    () => ({ t: canvasText, createObject: (kind: CreationObjectKind, position: { x: number; y: number }) => newNode(kind, position, canvasText) }),
    [canvasText],
  );

  const visualizeDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    applyMaterialization(visualizeDatasetUseCase(selectedNode, materializeDeps, fmt.number));
  }, [applyMaterialization, fmt, materializeDeps, selectedNode]);

  /**
   * "Plot on a map" — the direct counterpart to {@link visualizeDataset}.
   *
   * A dataset whose rows ALREADY carry coordinates (an uploaded geocoded CSV, or one the
   * Brain has written lat/lng back onto) needed a Brain turn to become a map, because the
   * only path to `materializeAs: 'map'` was `canvas_query_dataset`. The detection was
   * already here — `detectGeoColumns` runs over the imported rows — so the UI was
   * withholding something it could see. This spends no tokens and makes no network call.
   */
  const plotDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    applyMaterialization(plotDatasetUseCase(selectedNode, materializeDeps));
  }, [applyMaterialization, materializeDeps, selectedNode]);

  const profileDataset = useCallback((nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const result = profileDatasetUseCase(target, materializeDeps.t, fmt.number);
    if (!result.ok) { setNotice(result.notice); return; }
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...result.patch } } : node));
    setNotice(result.notice);
  }, [fmt, materializeDeps, nodes, setNodes, setNotice]);
  return { visualizeDataset, plotDataset, profileDataset };
}
