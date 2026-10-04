/** The board as it is DRAWN — critical-path styling, framing, the 3D projection and zoom controls. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from 'react';
import { analyzeDependencies, type DependencyAnalysis } from '@builderforce/creation-canvas-contract';
import { useFramedBoard } from '../useFramedBoard';
import type { CreationFlowNode } from '../CreationNode';
import { applyCanvas3DMoves, canvas3dDepthOffset, type Canvas3DDescriptor, type Canvas3DSceneInput } from '@/lib/canvas/canvas3d';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { creativeMeshGeometry, creativePreviewImageUrl } from '@/lib/creationDeliverables';
import { canvasNodeDimensions, canvasPlacementUnlocked } from '../creationCanvasLayout';
import { roomCreationsOf } from '../roomCreationsOf';
import type { RoomCreation } from '@/lib/canvas/roomCreations';
import type { Canvas3DMove } from '@/components/canvas/Canvas3DView';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CreationNodeData } from '../types';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { CanvasDockPanel } from '../CanvasBoardMenuBody';
import type { useTranslations } from 'next-intl';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { Canvas3DControls } from '@/components/canvas/canvas3dControls';

export interface UseCanvasRenderedBoardDeps {
  activeAgentIds: Set<string>;
  canEdit: boolean;
  comparisonModelIds: string[];
  dockPanel: CanvasDockPanel | null;
  edges: Edge[];
  evermindLiveByNodeId: Record<string, Partial<CreationNodeData>>;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  frameFocus: string | null;
  framedBoardRef: RefObject<{ memberIdsOf: (frameId: string) => string[]; }>;
  minimapColor: (node: CreationFlowNode) => string;
  nodes: CanvasObject[];
  outlineHighlightIds: ReadonlySet<string> | null;
  setInspectorFocus: Dispatch<SetStateAction<'knowledge' | 'test' | 'evaluation' | 'delivery' | null>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setSurface: (next: CanvasSurfaceId, targetId?: string | null, origin?: CanvasSurfaceId | null) => void;
  showHidden: boolean;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  threeDControls: Canvas3DControls | null;
  timeline: CanvasTimelineMessage[];
}

export function useCanvasRenderedBoard({ activeAgentIds, canEdit, comparisonModelIds, dockPanel, edges, evermindLiveByNodeId, flowRef, frameFocus, framedBoardRef, minimapColor, nodes, outlineHighlightIds, setInspectorFocus, setNodes, setSelectedId, setSelectedIds, setSurface, showHidden, t, threeDControls, timeline }: UseCanvasRenderedBoardDeps) {
  /**
   * The board-level half of the `blocks` edge (see its doc comment in
   * `CREATION_CONNECTION_KINDS`): the same `analyzeDependencies` primitive the PMO
   * initiative layer runs (`portfolioRollup.ts#computeDependencyAnalysis`), applied to
   * this board's own `task` nodes joined by `blocks` edges. `done` is the only closed
   * status in the task vocabulary (`TaskInspectorSection`'s own status list) — nothing
   * else in that list is ever treated as terminal elsewhere in the product. Weight is
   * `storyPoints` when a task carries one, so the critical path ranks by estimated
   * effort rather than by card count, same reasoning the PMO layer's own weight has.
   */
  const taskDependencyAnalysis = useMemo<DependencyAnalysis>(() => analyzeDependencies(
    nodes.filter((node) => node.data.kind === 'task').map((node) => ({
      id: node.id, status: typeof node.data.status === 'string' ? node.data.status : null,
      weight: typeof node.data.storyPoints === 'number' && node.data.storyPoints > 0 ? node.data.storyPoints : 1,
    })),
    edges.filter((edge) => edge.data?.connectionKind === 'blocks').map((edge) => ({ fromId: edge.source, toId: edge.target })),
    (status) => status !== 'done',
  ), [nodes, edges]);
  const criticalPathTaskIds = useMemo(() => new Set(taskDependencyAnalysis.criticalPath), [taskDependencyAnalysis]);
  const renderedNodes = useMemo(() => nodes.map((node) => {
    const attachedEvermind = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string' && /^evermind:\d+$/.test(node.data.resourceId);
    const live = evermindLiveByNodeId[node.id];
    const liveNode = attachedEvermind ? { ...node, data: { ...node.data, ...(live ?? { evermindLoading: true, status: 'Syncing project…' }) } } : node;
    const agentRef = liveNode.data.kind === 'agent' ? liveNode.data.resourceId?.match(/^agent:(.+)$/)?.[1] : undefined;
    const latestAgentReply = liveNode.data.kind === 'agent' ? [...timeline].reverse().find((message) => {
      const author = message.metadata?.authoredBy;
      return author?.kind === 'agent' && (author.ref === agentRef || author.ref === liveNode.id || author.name === liveNode.data.title);
    }) : undefined;
    const withCollaboration = liveNode.data.kind === 'agent' && (activeAgentIds.has(liveNode.id) || latestAgentReply)
      ? { ...liveNode, data: { ...liveNode.data, ...(activeAgentIds.has(liveNode.id) ? { collaborationState: 'thinking' } : {}), ...(latestAgentReply ? { collaborationReply: latestAgentReply.body, collaborationReplyAt: latestAgentReply.createdAt } : {}) } }
      : liveNode;
    const hasDatasetConnection = ['chart', 'dashboard', 'report'].includes(withCollaboration.data.kind) && edges.some((edge) => {
      const otherId = edge.source === withCollaboration.id ? edge.target : edge.target === withCollaboration.id ? edge.source : null;
      return otherId != null && nodes.some((candidate) => candidate.id === otherId && ['dataset', 'table', 'spreadsheet'].includes(candidate.data.kind));
    });
    const withLiveData = hasDatasetConnection && /connect a dataset/i.test(String(withCollaboration.data.status || ''))
      ? { ...withCollaboration, data: { ...withCollaboration.data, status: 'Dataset connected' } }
      : withCollaboration;
    // `taskDependencyAnalysis`'s board-wide read, folded onto the one task it is
    // about — the card's own render never recomputes the graph, it just reads the
    // verdict already computed once above, same as `activeAgentIds`/`hasDatasetConnection`.
    const withBlockedFlag = withLiveData.data.kind === 'task' && taskDependencyAnalysis.isBlocked[withLiveData.id]
      ? { ...withLiveData, data: { ...withLiveData.data, isBlocked: true } }
      : withLiveData;
    const withPlacement = withBlockedFlag.data.placementHidden === true ? { ...withBlockedFlag, hidden: !showHidden, style: showHidden ? { ...withBlockedFlag.style, opacity: .42 } : withBlockedFlag.style } : withBlockedFlag;
    // The outline search's board half — see `outlineHighlightIds`'s own comment.
    return dockPanel === 'outline' && outlineHighlightIds && !outlineHighlightIds.has(withPlacement.id)
      ? { ...withPlacement, style: { ...withPlacement.style, opacity: .18 } }
      : withPlacement;
  }), [activeAgentIds, dockPanel, edges, evermindLiveByNodeId, nodes, outlineHighlightIds, showHidden, taskDependencyAnalysis, timeline]);
  /**
   * The 3D view reads the SAME nodes the board renders, minus the ones the board
   * is currently hiding — a mode that quietly resurrects hidden objects would
   * report a different canvas than the one the user is working on.
   */
  /** Paints `taskDependencyAnalysis`'s critical path onto the board: the `blocks`
   *  edges connecting two critical-path tasks get a heavier, accented stroke instead
   *  of the shared default — the first per-edge styling this board does, so it is
   *  additive over `defaultEdgeOptions` rather than replacing it. */
  const renderedEdges = useMemo(() => edges.map((edge) => edge.data?.connectionKind === 'blocks' && criticalPathTaskIds.has(edge.source) && criticalPathTaskIds.has(edge.target)
    ? { ...edge, animated: true, style: { ...edge.style, stroke: 'var(--error-text)', strokeWidth: 3 } }
    : edge), [edges, criticalPathTaskIds]);
  /**
   * Frames, applied. Collapsed sections hide what they hold (and their connections
   * re-point at the chip), and a focused frame shows only its own section — the
   * canvas within a canvas. See `useFramedBoard`.
   */
  const framedBoard = useFramedBoard(renderedNodes, renderedEdges, frameFocus);
  // eslint-disable-next-line react-hooks/refs
  framedBoardRef.current = framedBoard;
  const threeDNodes = useMemo(() => framedBoard.nodes.filter((node) => node.hidden !== true), [framedBoard]);
  const describeThreeD = useCallback((node: CreationFlowNode): Canvas3DDescriptor => {
    const definition = creationObjectDefinition(node.data.kind);
    const comparisonModel = typeof node.data.comparisonModel === 'string' ? node.data.comparisonModel : '';
    const comparisonPrompt = typeof node.data.comparisonPrompt === 'string' && !comparisonModel;
    return {
      label: node.data.title || t(`object.${node.data.kind}`),
      sublabel: node.data.status || node.data.subtitle,
      group: comparisonModel
        ? t('comparison.modelLayer', { model: comparisonModel })
        : comparisonPrompt ? t('comparison.promptLayer') : t(`group.${definition.group}`),
      icon: definition.icon,
      accent: typeof node.data.accent === 'string' ? node.data.accent : minimapColor(node),
      // A generated object carries a picture of what it produced — a rendered
      // mesh, a drawn profile, an image. In 3D that is the point of the card.
      preview: creativePreviewImageUrl(node.data) ?? undefined,
      // A model is handed over as geometry, not as a picture of geometry: the 3D
      // view redraws it from wherever the camera ends up, so turning the scene
      // turns the object instead of sliding a photograph of it around.
      geometry: creativeMeshGeometry(node.data) ?? undefined,
      // Where the user has put this object through depth, if they have. It rides
      // in the object's own content, so it survives a reload and a share exactly
      // like its position on the flat board does.
      depthOffset: canvas3dDepthOffset(node),
      locked: !canvasPlacementUnlocked(node),
    };
  }, [minimapColor, t]);
  /**
   * WHAT STANDS IN THE ROOM besides the session: every 3D creation on the board —
   * games, worlds, AI scenes and models (see `lib/canvas/roomCreations.ts`). Opening
   * one records the room as its origin, so its way back lands in the room.
   */
  const roomCreations = useMemo(() => roomCreationsOf(nodes), [nodes]);
  const openRoomCreation = useCallback((creation: RoomCreation) => {
    if (creation.surface) setSurface(creation.surface, creation.id, 'room');
  }, [setSurface]);
  const selectThreeDObject = useCallback((id: string) => {
    setInspectorFocus(null);
    setSelectedId(id);
    setSelectedIds([id]);
  }, []);
  /**
   * WHAT THE ROOM'S SESSION IS MADE FROM.
   *
   * The same four things `Canvas3DView` is handed, as one memoised input: a card is
   * the same card whether it is a miniature on the table or full size in the
   * projection, so its label, its colour and the picture of what it produced are
   * answered once by `describeThreeD`. The room lays it out itself, and only while
   * the diorama is drawn — this memo is an object, not a layout.
   */
  const roomSceneInput = useMemo<Canvas3DSceneInput<CreationFlowNode>>(() => ({
    nodes: threeDNodes,
    edges,
    describe: describeThreeD,
    measure: canvasNodeDimensions,
    depthMode: comparisonModelIds.length >= 2 ? 'group' : 'flow',
  }), [comparisonModelIds.length, describeThreeD, edges, threeDNodes]);
  /**
   * Objects moved in the 3D space, written straight back to the board.
   *
   * There is one set of positions, not a 3D copy of them: across the plane the
   * move IS the board position, and through depth it is how far the object
   * floats off the layer its dependencies put it on. So an object dragged in the
   * space is where the user left it on the flat canvas too, and is saved by the
   * same autosave that persists any other placement.
   */
  const moveThreeDObjects = useCallback((moves: readonly Canvas3DMove[]) => {
    if (!canEdit) return;
    setNodes((current) => applyCanvas3DMoves(current, moves, canvasPlacementUnlocked));
  }, [canEdit, setNodes]);
  /**
   * Zoom and fit mean the scene while it is up, and the flat board otherwise —
   * the phone-sized action stack keeps the same buttons in both views instead of
   * leaving three dead controls behind whenever 3D opens.
   */
  const zoomInAction = useCallback(() => {
    if (threeDControls) threeDControls.zoomIn(); else void flowRef.current?.zoomIn({ duration: 180 });
  }, [threeDControls]);
  const zoomOutAction = useCallback(() => {
    if (threeDControls) threeDControls.zoomOut(); else void flowRef.current?.zoomOut({ duration: 180 });
  }, [threeDControls]);
  const fitViewAction = useCallback(() => {
    if (threeDControls) threeDControls.resetView(); else void flowRef.current?.fitView({ padding: .18, maxZoom: .9, duration: 260 });
  }, [threeDControls]);
  return { zoomInAction, zoomOutAction, fitViewAction, framedBoard, roomSceneInput, threeDNodes, describeThreeD, selectThreeDObject, moveThreeDObjects, roomCreations, openRoomCreation };
}
