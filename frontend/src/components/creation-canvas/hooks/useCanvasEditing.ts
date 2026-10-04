/** Editing the board — undo/redo, selection operations, frames, locks and visibility. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import type { CreationFlowNode } from '../CreationNode';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import { useExpandFramesOnPlacement } from '@/domains/canvas/presentation/useExpandFramesOnPlacement';
import { toFrameBox } from '../useFramedBoard';
import { alignCanvasNodesLeft, canvasNodeDimensions, canvasPlacementUnlocked } from '../creationCanvasLayout';
import { CANVAS_FIT_MIN_ZOOM } from '@/components/canvas/CanvasCommands';
import { newNode } from '../canvasNodeHelpers';
import { type CanvasObject, canvasPlacementFlags } from '@/domains/canvas/domain/canvasObject';
import type { CanvasJournal } from '@/lib/canvasActionJournal';
import type { useTranslations } from 'next-intl';
import type { CanvasNodePanelId } from '@/lib/canvasNodeAffordances';

export interface UseCanvasEditingDeps {
  canEdit: boolean;
  canvasClipboard: RefObject<{ nodes: CreationFlowNode[]; edges: Edge[]; } | null>;
  cardsEditable: boolean;
  edges: Edge[];
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  historyApplying: RefObject<boolean>;
  historyBaseline: RefObject<string | null>;
  journal: RefObject<CanvasJournal>;
  nodes: CanvasObject[];
  nodesRef: RefObject<CanvasObject[]>;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  redoStack: RefObject<string[]>;
  selectedId: string | null;
  selectedIds: string[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setFrameFocus: Dispatch<SetStateAction<string | null>>;
  setNodePanel: Dispatch<SetStateAction<{ nodeId: string; panel: CanvasNodePanelId | null; box: { top: number; right: number; } | null; expanded: boolean; } | null>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setScopeMode: Dispatch<SetStateAction<'auto' | 'canvas' | 'selection' | 'connected' | 'frame'>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  undoStack: RefObject<string[]>;
}

export function useCanvasEditing({ canEdit, canvasClipboard, cardsEditable, edges, flowRef, historyApplying, historyBaseline, journal, nodes, nodesRef, placeAppendedRef, redoStack, selectedId, selectedIds, setEdges, setFrameFocus, setNodePanel, setNodes, setNotice, setScopeMode, setSelectedId, setSelectedIds, t, undoStack }: UseCanvasEditingDeps) {
  const restoreGraphState = useCallback((serialized: string) => {
    const graph = JSON.parse(serialized) as { nodes: CreationFlowNode[]; edges: Edge[] };
    historyApplying.current = true;
    historyBaseline.current = serialized;
    setNodes(graph.nodes); setEdges(graph.edges);
    window.setTimeout(() => { historyApplying.current = false; }, 0);
  }, [setEdges, setNodes]);

  const undo = useCallback(() => {
    const prior = undoStack.current.pop(); if (!prior) { journal.current.record({ kind: 'user', label: 'undo', ok: false, detail: 'nothing to undo' }); setNotice(t('noticeNothingToUndo')); return; }
    journal.current.record({ kind: 'user', label: 'undo' });
    redoStack.current.push(JSON.stringify({ nodes, edges })); restoreGraphState(prior); setNotice(t('noticeChangeUndone'));
  }, [edges, nodes, restoreGraphState]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop(); if (!next) { journal.current.record({ kind: 'user', label: 'redo', ok: false, detail: 'nothing to redo' }); setNotice(t('noticeNothingToRedo')); return; }
    journal.current.record({ kind: 'user', label: 'redo' });
    undoStack.current.push(JSON.stringify({ nodes, edges })); restoreGraphState(next); setNotice(t('noticeChangeRedone'));
  }, [edges, nodes, restoreGraphState]);

  // Operator decision 2026-09-12: anything placed into a COLLAPSED frame — dropped,
  // dragged, pasted, imported, applied from Brain, adopted from a collaborator — opens
  // it. Diffed off the board state because that is the one path every placement shares.
  useExpandFramesOnPlacement(nodes, setNodes, { toBox: toFrameBox, enabled: cardsEditable, suspended: historyApplying });

  const selectionIds = useCallback(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);

  /**
   * REMOVE OBJECTS — and every connection into or out of them.
   *
   * ONE path for all three ways of asking: the Delete key, the trash on a card's own
   * header (`CanvasNodeDeleteButton`), and Delete in the selection toolbar. Written
   * three times it would have been three answers to "what happens to the edges", "does
   * a locked object go too" and "what is the selection afterwards" — and the keyboard
   * path already answered the second one differently from `arrange`, `align` and the
   * nudge keys, all of which skip a locked object.
   *
   * It reads `nodesRef` rather than `nodes` deliberately: this callback is handed to
   * every card through `canvasNodeTypes`, and a dependency on the board itself would
   * give React Flow a new `nodeTypes` object on every edit and remount the whole board.
   */
  const deleteObjects = useCallback((ids: readonly string[]) => {
    if (!canEdit) return;
    const requested = new Set(ids);
    // A locked object is locked against being moved, resized AND removed — the lock is
    // the one thing standing between a finished board and an accidental drag, and a
    // delete that ignored it would make that promise worth nothing.
    const removable = new Set(nodesRef.current.filter((node) => requested.has(node.id) && canvasPlacementUnlocked(node)).map((node) => node.id));
    if (!removable.size) {
      setNotice(requested.size ? t('noticeDeleteLocked') : t('noticeSelectToDelete'));
      return;
    }
    setNodes((current) => current.filter((node) => !removable.has(node.id)));
    setEdges((current) => current.filter((edge) => !removable.has(edge.source) && !removable.has(edge.target)));
    // Only what actually went. Clearing the whole selection would drop the other cards a
    // person had gathered, which is a second, unasked-for edit.
    setSelectedIds((current) => current.filter((id) => !removable.has(id)));
    setSelectedId((current) => (current && removable.has(current) ? null : current));
    setNotice(t('noticeObjectsDeleted', { count: removable.size }));
  }, [canEdit, setEdges, setNodes, setNotice, t]);
  /** Stable across renders so `canvasNodeTypes` keeps its identity — see above. */
  const deleteNodeFromCard = useCallback((nodeId: string) => deleteObjects([nodeId]), [deleteObjects]);
  const deleteSelection = useCallback(() => deleteObjects(selectionIds()), [deleteObjects, selectionIds]);

  const duplicateSelection = useCallback(() => {
    if (!canEdit) return;
    const ids = new Set(selectionIds());
    if (!ids.size) { setNotice(t('noticeSelectToDuplicate')); return; }
    const idMap = new Map<string, string>();
    const copies = nodes.filter((node) => ids.has(node.id)).map((node) => {
      const id = crypto.randomUUID(); idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 36, y: node.position.y + 36 }, selected: true, data: { ...node.data, title: `${node.data.title} copy`, resourceId: undefined } };
    });
    const copiedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    setNodes((current) => { const base = current.map((node) => ({ ...node, selected: false })); return [...base, ...placeAppendedRef.current(base, copies)]; });
    setEdges((current) => [...current, ...copiedEdges]);
    const nextIds = copies.map((node) => node.id); setSelectedIds(nextIds); setSelectedId(nextIds.length === 1 ? nextIds[0] : null);
    setNotice(t('noticeObjectsDuplicated', { count: copies.length }));
  }, [canEdit, edges, nodes, selectionIds, setEdges, setNodes]);

  const copySelection = useCallback(() => {
    const ids = new Set(selectionIds());
    if (!ids.size) { setNotice(t('noticeSelectToCopy')); return; }
    canvasClipboard.current = {
      nodes: nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node, data: { ...node.data } })),
      edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge })),
    };
    setNotice(t('noticeObjectsCopied', { count: ids.size }));
  }, [edges, nodes, selectionIds]);

  const pasteSelection = useCallback(() => {
    if (!canEdit || !canvasClipboard.current) return;
    const idMap = new Map<string, string>();
    const pasted = canvasClipboard.current.nodes.map((node) => {
      const id = crypto.randomUUID(); idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 48, y: node.position.y + 48 }, selected: true, data: { ...node.data, resourceId: undefined } };
    });
    const pastedEdges = canvasClipboard.current.edges.map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    setNodes((current) => { const base = current.map((node) => ({ ...node, selected: false })); return [...base, ...placeAppendedRef.current(base, pasted)]; }); setEdges((current) => [...current, ...pastedEdges]);
    const ids = pasted.map((node) => node.id); setSelectedIds(ids); setSelectedId(ids.length === 1 ? ids[0] : null); setNotice(t('noticeObjectsPasted', { count: ids.length }));
  }, [canEdit, setEdges, setNodes]);

  const alignSelection = useCallback(() => {
    const ids = new Set(selectionIds());
    if (!canEdit || ids.size < 2) { setNotice(t('alignNeedsTwo')); return; }
    // Left-aligning ALONE piles a selected row of objects onto one another, which
    // is what "align" used to do here; the shared primitive spaces the column too.
    const placements = alignCanvasNodesLeft(nodes, ids);
    if (!placements.size) { setNotice(t('alignNeedsTwo')); return; }
    setNodes((current) => current.map((node) => {
      const placement = placements.get(node.id);
      return placement ? { ...node, position: placement } : node;
    }));
    setNotice(t('objectsAligned', { count: placements.size }));
  }, [canEdit, nodes, selectionIds, setNodes, t]);

  /**
   * Work on one section alone — a canvas within a canvas.
   *
   * Everything outside the frame is hidden (not removed — see `useFramedBoard`), the
   * viewport fits what is left, and the board is otherwise exactly the board: same
   * palette, same Brain, same undo, same presence. That is the whole difference from
   * the modal editor this replaced, which had its own of each.
   */
  const openFrame = useCallback((frameId: string) => {
    setFrameFocus(frameId);
    setNodePanel(null);
    // After the hidden flags land, or the fit measures the whole board.
    window.setTimeout(() => { void flowRef.current?.fitView({ padding: 0.14, minZoom: CANVAS_FIT_MIN_ZOOM }); }, 0);
  }, []);
  const exitFrame = useCallback(() => {
    setFrameFocus(null);
    window.setTimeout(() => { void flowRef.current?.fitView({ padding: 0.12, minZoom: CANVAS_FIT_MIN_ZOOM }); }, 0);
  }, []);

  const frameSelection = useCallback(() => {
    const ids = new Set(selectionIds());
    const chosen = nodes.filter((node) => ids.has(node.id));
    if (!canEdit || chosen.length < 2) { setNotice(t('noticeSelectTwoForFrame')); return; }
    const left = Math.min(...chosen.map((node) => node.position.x)) - 40;
    const top = Math.min(...chosen.map((node) => node.position.y)) - 70;
    const right = Math.max(...chosen.map((node) => node.position.x + canvasNodeDimensions(node).width)) + 40;
    const bottom = Math.max(...chosen.map((node) => node.position.y + canvasNodeDimensions(node).height)) + 40;
    const frame = newNode('frame', { x: left, y: top }); frame.style = { width: right - left, height: bottom - top }; frame.zIndex = -1;
    frame.data = { ...frame.data, title: 'Grouped objects', framePurpose: 'Organize this related work' };
    setNodes((current) => [frame, ...current.map((node) => ({ ...node, selected: false }))]); setSelectedIds([frame.id]); setSelectedId(frame.id); setScopeMode('frame'); setNotice(t('noticeObjectsFramed', { count: chosen.length }));
  }, [canEdit, nodes, selectionIds, setNodes]);

  const togglePlacementLock = useCallback(() => {
    const ids = new Set(selectionIds()); if (!canEdit || !ids.size) return;
    const shouldLock = nodes.some((node) => ids.has(node.id) && canvasPlacementUnlocked(node));
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, ...canvasPlacementFlags(shouldLock), data: { ...node.data, placementLocked: shouldLock } } : node));
    setNotice(t(shouldLock ? 'noticePlacementLocked' : 'noticePlacementUnlocked'));
  }, [canEdit, nodes, selectionIds, setNodes]);

  const toggleHidden = useCallback(() => {
    const ids = new Set(selectionIds()); if (!canEdit || !ids.size) return;
    const shouldHide = nodes.some((node) => ids.has(node.id) && node.data.placementHidden !== true);
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, hidden: shouldHide, data: { ...node.data, placementHidden: shouldHide } } : node));
    if (shouldHide) { setSelectedId(null); setSelectedIds([]); }
    setNotice(t(shouldHide ? 'noticeObjectsHidden' : 'noticeObjectsShown'));
  }, [canEdit, nodes, selectionIds, setNodes]);
  return { selectionIds, redo, undo, deleteObjects, duplicateSelection, copySelection, pasteSelection, openFrame, deleteNodeFromCard, alignSelection, frameSelection, togglePlacementLock, toggleHidden, deleteSelection, exitFrame };
}
