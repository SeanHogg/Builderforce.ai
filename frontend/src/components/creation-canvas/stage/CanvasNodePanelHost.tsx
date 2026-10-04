import type { Dispatch, SetStateAction } from 'react';
import { canvasNodeMessages, canvasNodeSettingsPanel } from '@/lib/canvasNodeAffordances';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasNodePanel } from '../CanvasNodePanel';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import { emptyShellProblem } from '../creationObjectRegistry';
import { Inspector } from '../inspector/CanvasInspector';
import { CanvasInspectorProvider, type CanvasInspectorValue } from '../inspector/inspectorContext';
import type { useCanvasNodePanels } from '../hooks/useCanvasNodePanels';

type NodePanels = ReturnType<typeof useCanvasNodePanels>;

/**
 * The anchored panel's two widths.
 *
 * They live here because the ANCHOR has to be clamped against whichever one is in play
 * (a card near the right edge must not open a 560px panel off the screen), and the same
 * two numbers are declared in `.anchoredPanel` / `.anchoredPanel[data-expanded='true']`.
 * There is no third width and no drag-resize: the panel used to be a rail you could size
 * yourself, and a remembered rail width is meaningless for a thing that is anchored to a
 * card wherever that card happens to be.
 */
const NODE_PANEL_WIDTH = 300;
const NODE_PANEL_WIDE_WIDTH = 560;

export interface CanvasNodePanelHostProps {
  nodePanel: NodePanels['nodePanel'];
  setNodePanel: NodePanels['setNodePanel'];
  anchorFrom: NodePanels['anchorFrom'];
  /** Presenting hides every editing surface. */
  presentMode: boolean;
  nodes: readonly CreationFlowNode[];
  /** The role allows editing AND this viewer holds the object's lock. */
  editable: boolean;
  updateNodeData: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  setInspectorFocus: Dispatch<SetStateAction<CanvasInspectorValue['focus']>>;
  setSurface: (surface: CanvasSurfaceId, targetId?: string | null) => void;
  inspectorValue: CanvasInspectorValue;
}

/**
 * THE object panel — config, schedule, messages or persona short, or the object's
 * whole inspector wide, from one shell anchored to one card.
 *
 * There is no second surface. The inspector used to be a full-height rail on the
 * far side of the board, and every value, every setting and the activity log lived
 * over there with nothing tying them to the card being edited. The panel widens in
 * place instead, so what you are editing is never in question.
 *
 * The wide body is passed as CHILDREN rather than built inside the panel: its
 * actions (deliver a mockup, import a dataset, publish a site, compare projects)
 * are the board's, and handing the panel forty callbacks to forward would make it
 * a second copy of this component's surface area.
 */
export function CanvasNodePanelHost({ nodePanel, setNodePanel, anchorFrom, presentMode, nodes, editable, updateNodeData, setInspectorFocus, setSurface, inspectorValue }: CanvasNodePanelHostProps) {
  if (!nodePanel || presentMode) return null;
  const target = nodes.find((node) => node.id === nodePanel.nodeId);
  if (!target) return null;
  // `chat` has its own surface and no inspector at all — it must never open wide.
  const expanded = nodePanel.expanded && target.data.kind !== 'chat';
  const panel = nodePanel.panel ?? canvasNodeSettingsPanel(target.data.kind);
  // The anchor is DERIVED, not frozen when the panel opened: the clamp that keeps
  // the panel on screen depends on which of the two widths is showing, and the width
  // changes while it is open. A panel opened without a box (an action that had no
  // event to take a rectangle from) draws at the fallback for one frame, until the
  // layout effect above measures the card.
  const width = expanded ? NODE_PANEL_WIDE_WIDTH : NODE_PANEL_WIDTH;
  const anchor = nodePanel.box
    ? anchorFrom(nodePanel.box, width)
    : { x: Math.max(12, window.innerWidth - width - 24), y: 96 };
  return <CanvasNodePanel
    panel={panel}
    nodeId={nodePanel.nodeId}
    data={target.data}
    anchor={anchor}
    messages={canvasNodeMessages(target.data, { emptyShell: emptyShellProblem(target.data.kind, target.data as Record<string, unknown>) !== null })}
    editable={editable}
    onChange={(patch) => updateNodeData(nodePanel.nodeId, patch)}
    onClose={() => { setNodePanel(null); setInspectorFocus(null); }}
    expanded={expanded}
    onToggleExpanded={() => setNodePanel((current) => (current ? { ...current, expanded: !current.expanded } : current))}
    onOpenSurface={(surface) => setSurface(surface, nodePanel.nodeId)}
  >{expanded ? <CanvasInspectorProvider value={inspectorValue}><Inspector node={target} /></CanvasInspectorProvider> : null}</CanvasNodePanel>;
}
