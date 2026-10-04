/** Presenting the board — the step sequence and moving through it. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useMemo } from 'react';
import { presentationSequence, presentationStepAt, presentationViewport, stepPresentation } from '@/lib/canvasPresentation';
import { canvasNodeDimensions, canvasPlacementUnlocked } from '../creationCanvasLayout';
import { isTypingTarget } from '@/lib/keyboardTarget';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { Canvas3DControls } from '@/components/canvas/canvas3dControls';

export interface UseCanvasPresentationDeps {
  canEdit: boolean;
  copySelection: () => void;
  deleteObjects: (ids: readonly string[]) => void;
  duplicateSelection: () => void;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  flowWrapRef: RefObject<HTMLDivElement | null>;
  nodes: CanvasObject[];
  pasteSelection: () => void;
  presentMode: boolean;
  presentModeRef: RefObject<boolean>;
  presentStep: number;
  redo: () => void;
  selectionIds: () => string[];
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setPresentMode: (value: boolean | ((current: boolean) => boolean)) => void;
  setPresentStep: Dispatch<SetStateAction<number>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  threeDControls: Canvas3DControls | null;
  undo: () => void;
}

export function useCanvasPresentation({ canEdit, copySelection, deleteObjects, duplicateSelection, flowRef, flowWrapRef, nodes, pasteSelection, presentMode, presentModeRef, presentStep, redo, selectionIds, setNodes, setPresentMode, setPresentStep, setSelectedId, setSelectedIds, threeDControls, undo }: UseCanvasPresentationDeps) {
  /**
   * The ordered walk through this board's frames.
   *
   * Derived from the nodes rather than stored — see `canvasPresentation.ts` for why a
   * stored list is the wrong shape for a board several people are editing. Memoised on
   * the nodes, so adding a frame mid-presentation extends the sequence with no
   * bookkeeping anywhere.
   */
  const presentationSteps = useMemo(() => presentationSequence(nodes.map((node) => {
    const dimensions = canvasNodeDimensions(node);
    return {
      id: node.id,
      position: node.position,
      width: dimensions.width,
      height: dimensions.height,
      data: { kind: node.data.kind, title: node.data.title, presentationOrder: node.data.presentationOrder, hidden: node.data.placementHidden },
      hidden: node.hidden === true,
    };
  })), [nodes]);

  /**
   * Move the presentation, and everyone following, to one step.
   *
   * The follower half is FREE and is the reason this writes a viewport rather than
   * calling `fitView`: the presence channel already carries `viewport` on every pan and
   * zoom, and `followedViewport` already applies it. So moving the presenter's camera
   * moves every follower's, and the sequence needed no new transport at all — which is
   * exactly why these three were the Miro items worth chasing.
   */
  const goToPresentationStep = useCallback((index: number) => {
    const step = presentationStepAt(presentationSteps, index);
    if (!step) return;
    setPresentStep(step.index - 1);
    const wrapper = flowWrapRef.current;
    const screen = wrapper
      ? { width: wrapper.clientWidth, height: wrapper.clientHeight }
      : { width: typeof window === 'undefined' ? 1_280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight };
    void flowRef.current?.setViewport(presentationViewport(step.bounds, screen), { duration: 420 });
  }, [flowRef, flowWrapRef, presentationSteps, setPresentStep]);

  /**
   * Step relative, clamped. Wrapping past the last frame in front of a room reads as a
   * crash, which is the whole argument in `stepPresentation`.
   */
  const movePresentation = useCallback((delta: number) => {
    const next = stepPresentation(presentStep, delta, presentationSteps.length);
    if (next === null) return;
    goToPresentationStep(next);
  }, [goToPresentationStep, presentStep, presentationSteps.length]);

  /**
   * Opening present mode opens ON the sequence.
   *
   * Without this, entering present mode leaves the camera wherever the presenter
   * happened to be — which is the behaviour that made the mode feel unfinished: the
   * chrome vanishes and nothing else happens.
   */
  useEffect(() => {
    if (!presentMode || !presentationSteps.length) return;
    goToPresentationStep(presentStep);
    // Deliberately NOT depending on `presentStep`: this fires on ENTERING the mode, and
    // re-running it on every step would fight the step handler that just moved the
    // camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentMode, presentationSteps.length]);

  const focusSelection = useCallback(() => {
    const ids = selectionIds(); if (!ids.length) return;
    if (threeDControls) { threeDControls.focusObjects(ids); return; }
    void flowRef.current?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.28, duration: 350 });
  }, [flowRef, selectionIds, threeDControls]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      const ids = new Set(selectionIds());
      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.size && canEdit) {
        event.preventDefault(); deleteObjects([...ids]);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return; }
      // PRESENTING TAKES THE ARROW KEYS. Nudging a selected object one pixel is the
      // right binding on a board being edited and the wrong one in front of a room,
      // where → means "next". Escape leaves the mode rather than clearing a selection,
      // for the same reason: it is what every presentation tool does.
      if (presentModeRef.current && presentationSteps.length > 0) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); movePresentation(1); return; }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); movePresentation(-1); return; }
        if (event.key === 'Home') { event.preventDefault(); goToPresentationStep(0); return; }
        if (event.key === 'End') { event.preventDefault(); goToPresentationStep(presentationSteps.length - 1); return; }
        if (event.key === 'Escape') { event.preventDefault(); setPresentMode(false); return; }
      }
      if (event.key === 'Escape') { setSelectedId(null); setSelectedIds([]); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && ids.size && canEdit) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1; const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        setNodes((current) => current.map((node) => ids.has(node.id) && canvasPlacementUnlocked(node) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node));
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [canEdit, copySelection, deleteObjects, duplicateSelection, goToPresentationStep, movePresentation, pasteSelection, presentModeRef, presentationSteps.length, redo, selectionIds, setNodes, setPresentMode, setSelectedId, setSelectedIds, undo]);
  return { presentationSteps, movePresentation, focusSelection };
}
