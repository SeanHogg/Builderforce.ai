import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef, useState } from 'react';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import { teammateFromDrag } from '@/lib/team/teammate';
import { normalizeWebPageUrl, webPageHost } from '@/lib/canvasWebPage';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import { newNode } from '../canvasNodeHelpers';
import { dragCarriesFiles } from '../canvasFileDrop';
import type { useCanvasObjectPlacement } from './useCanvasObjectPlacement';
import type { useCanvasTeammates } from './useCanvasTeammates';
import type { useCanvasFileIntake } from './useCanvasFileIntake';
import type { useCanvasNodePanels } from './useCanvasNodePanels';

/** The drag payload a palette row or picker row carries: a palette CHOICE, not a bare kind. */
export const CANVAS_DND_MIME = 'application/x-builderforce-creation-object';

export interface UseCanvasBoardDropDeps {
  canEdit: boolean;
  flowRef: RefObject<ReactFlowInstance<CreationFlowNode, Edge> | null>;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  addFilesToCanvas: ReturnType<typeof useCanvasFileIntake>['addFilesToCanvas'];
  seatTeammate: ReturnType<typeof useCanvasTeammates>['seatTeammate'];
  choiceSeed: ReturnType<typeof useCanvasObjectPlacement>['choiceSeed'];
  localizedTourDefaults: () => Partial<CreationNodeData>;
  openNodeInspector: ReturnType<typeof useCanvasNodePanels>['openNodeInspector'];
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

/** Everything that can be dropped on the board — files, a teammate, a palette row, a link. */
export function useCanvasBoardDrop({ canEdit, flowRef, placeAppendedRef, addFilesToCanvas, seatTeammate, choiceSeed, localizedTourDefaults, openNodeInspector, setNodes, setSelectedId, setSelectedIds, setNotice, t }: UseCanvasBoardDropDeps) {
  /** A file is being dragged over the board from outside the browser. */
  const [fileDragging, setFileDragging] = useState(false);
  const fileDragDepth = useRef(0);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    fileDragDepth.current = 0;
    setFileDragging(false);
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const point = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // A file dragged in from the desktop lands where it was dropped and becomes
    // a real object; a palette drag still carries only an object kind.
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) { void addFilesToCanvas(files, point); return; }
    // A teammate dragged off the footer roster joins the session HERE (PRD 21
    // §3.3). Same payload the keyboard route carries, same seating helper — a
    // drag is one way in, never the only one.
    const teammate = teammateFromDrag(event.dataTransfer);
    if (teammate) { seatTeammate(teammate, point); return; }
    // The palette rail and the picker both drag a palette CHOICE, not a bare kind:
    // a step and a stencil are as droppable as an object, and decoding them here
    // through the same `choiceSeed` the click path uses is what stops "dropped" and
    // "clicked" producing different objects from the same row.
    const choice = event.dataTransfer.getData(CANVAS_DND_MIME);
    // A link dragged from a browser tab or another app carries no object kind —
    // it lands as a live Web page panel, which is what a dropped URL means.
    if (!choice && point) {
      const dropped = normalizeWebPageUrl(event.dataTransfer.getData('text/uri-list').split('\n')[0] || event.dataTransfer.getData('text/plain'));
      if (dropped) {
        const page = newNode('browser', point);
        page.data = { ...page.data, title: webPageHost(dropped), url: dropped, status: '' };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [page])]);
        setSelectedId(page.id); setSelectedIds([page.id]); openNodeInspector(page.id);
        return;
      }
    }
    if (!choice || !point) return;
    const { kind, seed, size } = choiceSeed(choice);
    const node = newNode(kind, point);
    if (kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
    if (seed) node.data = { ...node.data, ...seed };
    if (size) node.style = { ...node.style, ...size };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setSelectedId(node.id); setSelectedIds([node.id]); openNodeInspector(node.id);
  }, [addFilesToCanvas, canEdit, choiceSeed, flowRef, localizedTourDefaults, openNodeInspector, placeAppendedRef, seatTeammate, setNodes, setNotice, setSelectedId, setSelectedIds, t]);

  /** Drag events fire again for every child element the pointer crosses, so the
   * overlay is held by a depth count rather than by the last event seen. */
  const onCanvasDragEnter = useCallback((event: React.DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    fileDragDepth.current += 1;
    setFileDragging(true);
  }, []);
  const onCanvasDragLeave = useCallback((event: React.DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (!fileDragDepth.current) setFileDragging(false);
  }, []);

  return { fileDragging, onDrop, onCanvasDragEnter, onCanvasDragLeave };
}
