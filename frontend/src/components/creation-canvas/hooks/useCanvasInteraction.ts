/** Pointer, connection, selection and viewport interaction on the board. */
import { useCoarsePointer } from '@/lib/useCoarsePointer';
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useMemo } from 'react';
import { type CanvasGesture, canvasInteractionProps } from '../canvasPointerMode';
import { flowConnectionProps } from '@/lib/flowConnection';
import { addEdge, type Connection, type Edge, type NodeMouseHandler, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react';
import { outletForHandle } from '@/domains/workflow/domain/stepOutlets';
import { stepConfigOf, stepKindOf } from '@/domains/workflow/domain/flowStepObject';
import { type ConnectionStyle, edgeVisuals } from '@/lib/canvasConnectionStyle';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { type BrainDockPreferences, writeBrainDockPreferences } from '../brainDockPreferences';
import type { CreationFlowNode } from '../CreationNode';
import { type CanvasStroke, canvasStrokes, drawingPatch, eraseStrokes } from '@/lib/canvasDrawing';
import { newNode, topmostNodeAt } from '../canvasNodeHelpers';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { GuestLimitRefusal } from '@/lib/guestLimit';
import type { CanvasNodePanelId } from '@/lib/canvasNodeAffordances';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import type { DrawingPreferences } from '../drawingPreferences';
import type { useTranslations } from 'next-intl';
import type { LocalCreationSnapshot } from '@/domains/canvas/infrastructure/localCanvasStore';

export interface UseCanvasInteractionDeps {
  canEdit: boolean;
  canvasGesture: CanvasGesture;
  connectionKind: 'delivery' | 'presentation' | 'data' | 'control' | 'reference' | 'membership' | 'blocks' | 'verifies';
  connectionStyle: ConnectionStyle;
  currentSnapshot: (viewport?: { x: number; y: number; zoom: number; }) => LocalCreationSnapshot;
  cursorRef: RefObject<{ x: number; y: number; } | null>;
  drawing: DrawingPreferences | null;
  drawingPointsRef: RefObject<{ x: number; y: number; }[]>;
  edges: Edge[];
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  framedBoardRef: RefObject<{ memberIdsOf: (frameId: string) => string[]; }>;
  guestLimit: GuestLimitRefusal | null;
  hydratedRef: RefObject<boolean>;
  nodes: CanvasObject[];
  onNodesChange: OnNodesChange<CanvasObject>;
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  openNodePanel: (nodeId: string, panel: CanvasNodePanelId, rect: DOMRect) => void;
  persistSnapshot: (snapshot: LocalCreationSnapshot) => void;
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  presenceLive: boolean;
  sendPresence: (state: CanvasPresenceState) => void;
  sessionId: string;
  setBrainDock: Dispatch<SetStateAction<BrainDockPreferences>>;
  setConnectionStyleState: Dispatch<SetStateAction<ConnectionStyle>>;
  setDiagnosticsOpen: Dispatch<SetStateAction<boolean>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setInspectorFocus: Dispatch<SetStateAction<'knowledge' | 'test' | 'evaluation' | 'delivery' | null>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setOutcomeMetricsOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  title: string;
  viewportRef: RefObject<{ x: number; y: number; zoom: number; }>;
}

export function useCanvasInteraction({ canEdit, canvasGesture, connectionKind, connectionStyle, currentSnapshot, cursorRef, drawing, drawingPointsRef, edges, flowRef, framedBoardRef, guestLimit, hydratedRef, nodes, onNodesChange, openNodeInspector, openNodePanel, persistSnapshot, persistence, placeAppendedRef, presenceLive, sendPresence, sessionId, setBrainDock, setConnectionStyleState, setDiagnosticsOpen, setEdges, setHistoryOpen, setInspectorFocus, setNodes, setNotice, setOutcomeMetricsOpen, setSelectedId, setSelectedIds, t, title, viewportRef }: UseCanvasInteractionDeps) {
  // Derived here rather than passed in, so `drawingMode` narrows `drawing` the way it did in the component.
  const drawingMode = drawing !== null;
  // What a primary drag on empty board does, and how forgiving the board is about a
  // pointer that wanders. `panAndSelectConflict` is the invariant `canvasInteractionProps`
  // guarantees, not a React Flow prop, so it is dropped before the rest is spread.
  const coarsePointer = useCoarsePointer();
  const { panAndSelectConflict: _panAndSelectConflict, ...interactionProps } = useMemo(
    () => canvasInteractionProps({ gesture: canvasGesture, pointer: coarsePointer ? 'coarse' : 'fine', drawing: drawingMode }),
    [canvasGesture, coarsePointer, drawingMode],
  );

  // How a drawn connection is accepted. Shared with the workflow builder, because
  // "released on the wrong side of the card and nothing happened" is one bug, not two.
  const connectionProps = useMemo(() => flowConnectionProps(coarsePointer ? 'coarse' : 'fine'), [coarsePointer]);

  const onConnect = useCallback((connection: Connection) => {
    // An arm drawn out of a step that DECIDES is labeled with the outlet it left, not
    // with the board's connection kind: that label is what the executor prunes on
    // (`WorkflowDefEdge.label`), and it is what the arrow has to READ as, because
    // "reference" on the arm out of a switch case tells nobody which case it is.
    const from = nodes.find((node) => node.id === connection.source);
    const outlet = from?.data.kind === 'flowStep'
      ? outletForHandle(stepKindOf(from.data), stepConfigOf(from.data), connection.sourceHandle)
      : null;
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), ...edgeVisuals(connectionStyle), data: { connectionKind, connectionStyle }, label: outlet?.name || connectionKind }, current));
    trackActivity('creation_connection_added', { sessionId, metadata: { clientSurface: canvasSurface(), connectionKind } });
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (persistence === 'server' && source && target && source.data.kind !== 'chat' && target.data.kind !== 'chat') {
      const correlationId = crypto.randomUUID();
      const metadata = { sourceKind: source.data.kind, targetKind: target.data.kind, connectionKind };
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'started', artifactId: source.id, metadata }).catch(() => undefined);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'reused', artifactId: source.id, metricKey: 'outputs_reused', metricValue: 1, unit: 'count', metadata }).catch(() => undefined);
    }
  }, [connectionKind, connectionStyle, nodes, persistence, sessionId, setEdges]);

  /**
   * Choose the connector style — and RESTYLE what is selected.
   *
   * A style control that only armed the next draw would be unusable on a diagram that
   * already exists: the way a person restyles an arrow is to select it and pick, which
   * is what every drawing tool has taught them. So one press does both, and the same
   * `edgeVisuals` translation runs for the new edge and the existing ones — three call
   * sites computing that themselves would be three edges that look different while
   * claiming one style.
   */
  const setConnectionStyle = useCallback((patch: Partial<ConnectionStyle>) => {
    setConnectionStyleState((current) => {
      const next = { ...current, ...patch };
      setEdges((edges) => {
        if (!edges.some((edge) => edge.selected)) return edges;
        return edges.map((edge) => (edge.selected
          ? { ...edge, ...edgeVisuals(next), data: { ...(edge.data ?? {}), connectionStyle: next } }
          : edge));
      });
      return next;
    });
  }, [setConnectionStyleState, setEdges]);

  /** Selecting the Brain Object reveals the dock instead of a second transcript. */
  const openBrainDock = useCallback(() => setBrainDock((current) => {
    if (current.open) return current;
    const next = { ...current, open: true };
    writeBrainDockPreferences(next);
    return next;
  }), [setBrainDock]);

  /**
   * A guest wall is the answer to something they just asked, and the answer — the
   * refusal and the account that clears it — lives on the Brain surface. Reveal it,
   * or a visitor with Brain closed gets a one-line notice and no way forward.
   */
  useEffect(() => { if (guestLimit) openBrainDock(); }, [guestLimit, openBrainDock]);

  const onNodeClick: NodeMouseHandler<CreationFlowNode> = useCallback((event, node) => {
    setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
    setInspectorFocus(null); setSelectedId(node.id); if (!node.selected) setSelectedIds([node.id]);
    if (node.data.kind === 'chat') openBrainDock();
    // Selecting a card opens the panel ANCHORED to it, SHORT. Everything else about the
    // object is one press away in the same panel, which is the whole reason the short
    // reading can afford to be short.
    //
    // `resume` opens it WIDE instead. The card now shows only the rendered document (no
    // fields left to put in a compact panel at all — see `ResumeInspectorSection`), so
    // the short reading would open on every click with nothing in it but the control
    // that widens it.
    if (node.data.kind === 'resume') { openNodeInspector(node.id, null, event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : undefined); return; }
    if (node.data.kind !== 'chat' && event.currentTarget instanceof Element) {
      openNodePanel(node.id, 'config', event.currentTarget.getBoundingClientRect());
    }
  }, [openBrainDock, openNodeInspector, openNodePanel, setDiagnosticsOpen, setHistoryOpen, setInspectorFocus, setOutcomeMetricsOpen, setSelectedId, setSelectedIds]);
  // XYFlow subscribes to this callback through its Zustand store. An inline
  // callback is a new subscription every render; immediately writing a fresh
  // `[]` back to React from that subscription can create an update-depth loop
  // on a newly hydrated local Session. Keep the subscriber stable and preserve
  // state identity when the semantic selection did not change.
  /**
   * Node changes, plus the annotations that have to come along.
   *
   * A mark drawn ON a card is a separate node (only `data` survives the graph
   * round trip, so React Flow's own parenting cannot be used — see the note
   * where `annotatesId` is written). Without this, dragging a document left its
   * highlighting behind on the board, which is worse than not being able to
   * highlight it at all. The delta is taken from the position change itself, so
   * one drag moves the pair by exactly the same amount.
   */
  const onCanvasNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    const moves = changes.flatMap((change) => change.type === 'position' && change.position ? [{ id: change.id, position: change.position }] : []);
    if (!moves.length) { onNodesChange(changes); return; }
    // Anything React Flow is ALREADY moving. A selected card inside a frame that is
    // being dragged gets its own position change from the library, and adding a
    // follower for it would apply the delta twice — the card would drift out of the
    // section at double speed, which is worse than not carrying it at all.
    const alreadyMoving = new Set(moves.map((move) => move.id));
    const followers = moves.flatMap((move) => {
      const source = nodes.find((node) => node.id === move.id);
      if (!source) return [];
      const dx = move.position.x - source.position.x;
      const dy = move.position.y - source.position.y;
      if (!dx && !dy) return [];
      // An annotation follows the object it marks up; a FRAME carries everything
      // inside it. Both are "this moved, so did that", which is why they are resolved
      // in one pass — a frame full of annotated cards must not move its members and
      // leave their marks behind.
      const carried = source.data.kind === 'frame' ? new Set(framedBoardRef.current.memberIdsOf(move.id)) : null;
      return nodes
        .filter((node) => !alreadyMoving.has(node.id)
          && ((node.data.kind === 'drawing' && node.data.annotatesId === move.id) || carried?.has(node.id)))
        .map((node) => ({ id: node.id, type: 'position' as const, position: { x: node.position.x + dx, y: node.position.y + dy } }));
    });
    onNodesChange(followers.length ? [...changes, ...followers] : changes);
  }, [framedBoardRef, nodes, onNodesChange]);
  const onSelectionChange = useCallback(({ nodes: chosen }: { nodes: CreationFlowNode[] }) => {
    const ids = chosen.map((node) => node.id);
    setSelectedIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
    const nextId = ids.length === 1 ? ids[0]! : null;
    setSelectedId((current) => current === nextId ? current : nextId);
  }, [setSelectedId, setSelectedIds]);
  const clearSelection = useCallback(() => {
    setSelectedId((current) => current == null ? current : null);
    setSelectedIds((current) => current.length ? [] : current);
  }, [setSelectedId, setSelectedIds]);
  const onCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!flowRef.current) return;
    const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (presenceLive) { cursorRef.current = point; sendPresence({ cursor: point }); }
    if (drawingMode && drawingPointsRef.current.length) drawingPointsRef.current.push(point);
  }, [cursorRef, drawingMode, drawingPointsRef, flowRef, presenceLive, sendPresence]);
  const onCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // A stroke may START ANYWHERE, including on top of a card — that is what
    // makes annotation possible. While a tool is held the canvas is a drawing
    // surface, and the cards under it are things to mark up rather than things
    // to drag. (Dragging and connecting are disabled for the same reason.)
    if (!drawingMode || !canEdit || !flowRef.current) return;
    drawingPointsRef.current = [flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })];
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [canEdit, drawingMode, drawingPointsRef, flowRef]);
  /**
   * Commit the stroke.
   *
   * Where it LANDS is the whole difference between a drawing tool and a sketch
   * pad: a stroke over an existing drawing joins that drawing, a stroke over any
   * other object becomes an annotation that rides on it, and a stroke over empty
   * board starts a new sketch. All three go through `drawingPatch`, so the marks,
   * the card's size and its position stay in step however the drawing grew.
   */
  const onCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Narrowed on `drawing` itself: the pen is what the stroke is drawn with.
    if (!drawing) return;
    const path = drawingPointsRef.current.splice(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const start = path[0];
    if (!start) return;
    const tool = drawing.tool;
    // Freehand and shapes need a drag; text and the eraser act on a tap.
    if (tool !== 'text' && tool !== 'eraser' && path.length < 2) return;

    if (tool === 'eraser') {
      const radius = Math.max(8, drawing.width * 3);
      let erased = 0;
      setNodes((current) => current.flatMap((node) => {
        if (node.data.kind !== 'drawing') return [node];
        const absolute = canvasStrokes(node.data).map((stroke) => ({ ...stroke, points: stroke.points.map((item) => ({ x: item.x + node.position.x, y: item.y + node.position.y })) }));
        const kept = eraseStrokes(absolute, path, radius);
        if (kept.length === absolute.length) return [node];
        erased += absolute.length - kept.length;
        // A drawing with nothing left on it is not an empty card, it is gone.
        if (!kept.length) return [];
        const patch = drawingPatch(kept);
        return [{ ...node, position: { x: Number(patch.drawingOriginX ?? node.position.x), y: Number(patch.drawingOriginY ?? node.position.y) }, style: { width: Number(patch.drawingWidth), height: Number(patch.drawingHeight) + 44 }, data: { ...node.data, ...patch } }];
      }));
      if (erased) setNotice(t('noticeStrokesErased', { count: erased }));
      return;
    }

    const stroke: CanvasStroke = {
      tool,
      points: tool === 'text' ? [start] : tool === 'pen' || tool === 'highlighter' ? path : [start, path[path.length - 1]!],
      stroke: drawing.color,
      strokeWidth: drawing.width,
      ...(tool === 'text' ? { text: '' } : {}),
    };

    // The object under the first point decides where the stroke goes.
    const target = topmostNodeAt(nodes, start);
    if (target?.data.kind === 'drawing') {
      setNodes((current) => current.map((node) => {
        if (node.id !== target.id) return node;
        const absolute = canvasStrokes(node.data).map((item) => ({ ...item, points: item.points.map((position) => ({ x: position.x + node.position.x, y: position.y + node.position.y })) }));
        const patch = drawingPatch([...absolute, stroke]);
        return { ...node, position: { x: Number(patch.drawingOriginX), y: Number(patch.drawingOriginY) }, style: { width: Number(patch.drawingWidth), height: Number(patch.drawingHeight) + 44 }, data: { ...node.data, ...patch } };
      }));
      setSelectedId(target.id);
      return;
    }

    const patch = drawingPatch([stroke]);
    const node = newNode('drawing', { x: Number(patch.drawingOriginX), y: Number(patch.drawingOriginY) });
    node.style = { width: Number(patch.drawingWidth), height: Number(patch.drawingHeight) + (target ? 8 : 44) };
    node.data = {
      ...node.data,
      title: target ? t('annotationTitle', { title: target.data.title }) : t('sketchTitle'),
      ...patch,
      // An annotation names what it is ON. `annotatesId` is node DATA rather
      // than React Flow's `parentId` because only `data` survives the graph
      // round trip (see `persistedGraphFromBoard`) — a parent id would be
      // silently dropped on save and the mark would come back detached.
      ...(target ? { annotatesId: target.id, status: '' } : {}),
    };
    if (target) node.zIndex = 6;
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setSelectedId(node.id);
    setNotice(target ? t('noticeAnnotationAdded', { title: target.data.title }) : t('noticeSketchAdded'));
  }, [drawing, drawingPointsRef, nodes, placeAppendedRef, setNodes, setNotice, setSelectedId, t]);
  const onViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    viewportRef.current = viewport;
    // A follower is watching this pan happen, not reading about it eight seconds later.
    if (presenceLive) sendPresence({ viewport });
    if (persistence !== 'local' || !hydratedRef.current) return;
    const snapshot = currentSnapshot(viewport);
    persistSnapshot(snapshot);
  }, [currentSnapshot, hydratedRef, persistSnapshot, persistence, presenceLive, sendPresence, viewportRef]);
  return { openBrainDock, setConnectionStyle, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp, onCanvasNodesChange, onConnect, connectionProps, onNodeClick, onSelectionChange, clearSelection, onViewportChange, interactionProps };
}
