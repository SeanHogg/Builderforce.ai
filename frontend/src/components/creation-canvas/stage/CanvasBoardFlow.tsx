import { memo, useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Background, BackgroundVariant, MarkerType, ReactFlow, type DefaultEdgeOptions, type Edge, type FitViewOptions, type Node, type NodeTypes, type OnEdgesChange, type ReactFlowInstance } from '@xyflow/react';
import { CANVAS_FIT_MIN_ZOOM, CanvasCommands } from '@/components/canvas/CanvasCommands';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationObjectKind } from '../types';
import { RemoteCursors } from '../RemoteCursors';
import { BrainSurfaceProvider } from '../brainSurfaceContext';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import type { useCanvasBrainSurface } from '../hooks/useCanvasBrainSurface';
import type { useCanvasPresence } from '../hooks/useCanvasPresence';

type Interaction = ReturnType<typeof useCanvasInteraction>;
type Presence = ReturnType<typeof useCanvasPresence>;

/* Module constants rather than literals in the JSX: React Flow compares these by
   identity, and a fresh object per render is a fresh option set per keystroke. */
const FIT_VIEW_OPTIONS: FitViewOptions<CreationFlowNode> = { padding: 0.12, minZoom: CANVAS_FIT_MIN_ZOOM };
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = { type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--canvas-edge)', strokeWidth: 1.5 } };
const PRO_OPTIONS = { hideAttribution: true };
const DELETE_KEYS = ['Backspace', 'Delete'];

// The board's own identity hues, declared beside the rest of its palette in
// CreationCanvas.module.css — see PRD 21 §2.6 rule 9. Four pitch kinds share
// one hue because they are four faces of one object.
const MINIMAP_COLORS: Partial<Record<CreationObjectKind, string>> = { workflow: 'var(--canvas-obj-workflow)', website: 'var(--canvas-obj-website)', dashboard: 'var(--canvas-obj-dashboard)', agent: 'var(--canvas-obj-agent)', staff: 'var(--canvas-obj-staff)', evaluation: 'var(--canvas-obj-evaluation)', evermind: 'var(--canvas-obj-evermind)', projectComparison: 'var(--canvas-obj-comparison)', pitch: 'var(--canvas-obj-pitch)', pitchScorecard: 'var(--canvas-obj-pitch)', pitchQa: 'var(--canvas-obj-pitch)', pitchApplication: 'var(--canvas-obj-pitch)' };

/** A card's colour on the mini map. Pure, so it is a module function rather than a
 *  callback the host has to keep stable. */
export function canvasMinimapColor(node: CreationFlowNode): string {
  return MINIMAP_COLORS[node.data.kind] ?? 'var(--canvas-obj-unknown)';
}

export interface CanvasBoardFlowProps {
  brainSurface: ReturnType<typeof useCanvasBrainSurface>['brainSurface'];
  nodes: CreationFlowNode[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodesChange: Interaction['onCanvasNodesChange'];
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: Interaction['onConnect'];
  connectionProps: Interaction['connectionProps'];
  onNodeClick: Interaction['onNodeClick'];
  onSelectionChange: Interaction['onSelectionChange'];
  onPaneClick: Interaction['clearSelection'];
  onMoveEnd: Interaction['onViewportChange'];
  interactionProps: Interaction['interactionProps'];
  flowRef: RefObject<ReactFlowInstance<CreationFlowNode, Edge> | null>;
  /** A viewport restored before React Flow was ready, applied the moment it is. */
  pendingViewport: RefObject<{ x: number; y: number; zoom: number } | null>;
  drawingMode: boolean;
  liveMembers: Presence['liveMembers'];
  presenceSelfId: Presence['presenceSelfId'];
  minimapOpen: boolean;
  setMinimapOpen: Dispatch<SetStateAction<boolean>>;
  onCleanLayout: () => void;
  /** The flat board is not what is being drawn, so its mini map stands down. */
  threeDActive: boolean;
}

/** `interactionProps` is a rest-spread, so its identity is new every render while its
 *  members are memoized — compare it by member, and everything else by identity. */
function sameFlowProps(previous: CanvasBoardFlowProps, next: CanvasBoardFlowProps): boolean {
  for (const key of Object.keys(next) as Array<keyof CanvasBoardFlowProps>) {
    if (key === 'interactionProps') {
      const a = previous.interactionProps as Record<string, unknown>;
      const b = next.interactionProps as Record<string, unknown>;
      const keys = Object.keys(b);
      if (keys.length !== Object.keys(a).length || keys.some((member) => a[member] !== b[member])) return false;
    } else if (previous[key] !== next[key]) return false;
  }
  return true;
}

/**
 * The board itself — React Flow, its dots, everyone's pointer and the mini map.
 *
 * Rendered unconditionally whatever surface is up, so the viewport, the selection and
 * every node's state survive a trip through another surface and back. Memoized: a
 * keystroke in the composer re-renders the host, and must not reconcile the board.
 */
export const CanvasBoardFlow = memo(function CanvasBoardFlow({
  brainSurface, nodes, edges, nodeTypes, onNodesChange, onEdgesChange, onConnect, connectionProps, onNodeClick, onSelectionChange,
  onPaneClick, onMoveEnd, interactionProps, flowRef, pendingViewport, drawingMode, liveMembers, presenceSelfId, minimapOpen,
  setMinimapOpen, onCleanLayout, threeDActive,
}: CanvasBoardFlowProps) {
  const { canEdit } = useCanvasSessionFacts();
  const onInit = useCallback((instance: ReactFlowInstance<CreationFlowNode, Edge>) => {
    flowRef.current = instance;
    if (pendingViewport.current) void instance.setViewport(pendingViewport.current);
  }, [flowRef, pendingViewport]);
  return <BrainSurfaceProvider value={brainSurface}>
        <ReactFlow<CreationFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          {...connectionProps}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          onPaneClick={onPaneClick}
          onMoveEnd={onMoveEnd}
          onInit={onInit}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={CANVAS_FIT_MIN_ZOOM}
          maxZoom={1.6}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          nodesDraggable={canEdit && !drawingMode}
          nodesConnectable={canEdit && !drawingMode}
          elementsSelectable
          deleteKeyCode={canEdit ? DELETE_KEYS : null}
          // Pan/marquee, drag threshold and pinch behaviour come from ONE pure decision
          // (`canvasPointerMode.ts`) rather than being spelled out here, so they can be
          // asserted without mounting the board.
          {...interactionProps}
          proOptions={PRO_OPTIONS}
          onlyRenderVisibleElements
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--creation-dot)" />
          {/* Inside the flow, so the pane's own transform moves them: a cursor
              layer that lives outside the viewport is only ever correct until the
              first pan. */}
          <RemoteCursors members={liveMembers} currentUserId={presenceSelfId} />
          <CanvasCommands
            minimapOpen={minimapOpen}
            setMinimapOpen={setMinimapOpen}
            onCleanLayout={onCleanLayout}
            minimapNodeColor={canvasMinimapColor as (node: Node) => string}
            minimapMaskColor="var(--creation-minimap-mask, rgba(244,248,253,.72))"
            // All this gates now is the mini map, which is a map OF the flat board: it
            // stands down wherever that board is not what is being drawn, because the 3D
            // scene is its own map and a conversation has nothing to map. That is why it
            // reads the board flag rather than the 3D id.
            threeDActive={threeDActive}
            // `onToggleThreeD` is deliberately NOT passed: it would draw a second control
            // for the decision the surface switcher already owns.
            // NO RAIL, on any surface. Zoom, fit, arrange, the mini map toggle,
            // pan/marquee, Files, the outline and the scene's own depth/layer commands are
            // all contributed to the ONE command bar below (`view`). The rail used to stand
            // down on the flat board ONLY, which meant this canvas showed one bar on the
            // board and two toolbars on every other surface — the bottom-left corner panel
            // this removes. The other two canvases that share this component keep their
            // rail: they have no bar of their own for it to move into.
            hideRail
          />
        </ReactFlow>
        </BrainSurfaceProvider>;
}, sameFlowProps);
