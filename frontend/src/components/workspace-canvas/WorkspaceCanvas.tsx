'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import styles from './WorkspaceCanvas.module.css';

export interface WorkspaceCanvasPanel {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  content: ReactNode;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  removable?: boolean;
}

type WorkspacePanelData = {
  panelId: string;
};

type WorkspacePanelNode = Node<WorkspacePanelData, 'workspacePanel'>;

const WorkspacePanelsContext = createContext<{
  panels: WorkspaceCanvasPanel[];
  onRemovePanel?: (id: string) => void;
}>({ panels: [] });

function WorkspacePanel({ data, selected }: NodeProps<WorkspacePanelNode>) {
  const { panels, onRemovePanel } = useContext(WorkspacePanelsContext);
  const panel = panels.find((candidate) => candidate.id === data.panelId);
  if (!panel) return null;
  return (
    <section className={`${styles.node} ${selected ? styles.nodeSelected : ''}`} aria-label={`${panel.title} canvas panel`}>
      <NodeResizer isVisible={selected} minWidth={360} minHeight={260} />
      <header className={`${styles.header} workspace-panel-drag-handle`}>
        <span className={styles.icon} aria-hidden>{panel.icon ?? '◇'}</span>
        <strong className={styles.title}>{panel.title}</strong>
        {panel.subtitle && <span className={styles.subtitle}>{panel.subtitle}</span>}
        <span className={styles.spacer} />
        {panel.removable && onRemovePanel && (
          <button
            type="button"
            className={`${styles.close} nodrag`}
            aria-label={`Remove ${panel.title} from canvas`}
            onClick={() => onRemovePanel(panel.id)}
          >×</button>
        )}
      </header>
      <div className={`${styles.body} nodrag nowheel`}>{panel.content}</div>
    </section>
  );
}

const NODE_TYPES: NodeTypes = { workspacePanel: WorkspacePanel };

function panelNode(panel: WorkspaceCanvasPanel, index: number): WorkspacePanelNode {
  return {
    id: panel.id,
    type: 'workspacePanel',
    position: panel.position ?? { x: 56 + index * 64, y: 54 + index * 52 },
    data: { panelId: panel.id },
    dragHandle: '.workspace-panel-drag-handle',
    style: { width: panel.width ?? 1180, height: panel.height ?? 720 },
  };
}

export function WorkspaceCanvas({
  panels,
  toolbar,
  onRemovePanel,
  className,
}: {
  panels: WorkspaceCanvasPanel[];
  toolbar?: ReactNode;
  onRemovePanel?: (id: string) => void;
  className?: string;
}) {
  const initialNodes = useMemo(() => panels.map(panelNode), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkspacePanelNode>(initialNodes);
  const panelIds = panels.map((panel) => panel.id).join('\u0000');

  useEffect(() => {
    setNodes((current) => panels.map((panel, index) => {
      const existing = current.find((node) => node.id === panel.id);
      return existing ?? panelNode(panel, index);
    }));
    // Panel content is read from context, so spatial node state only reconciles
    // when the set of reusable panels changes.
  }, [panelIds, setNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${styles.canvas}${className ? ` ${className}` : ''}`} data-testid="workspace-canvas">
      <WorkspacePanelsContext.Provider value={{ panels, onRemovePanel }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            fitView
            fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.5}
            snapToGrid
            snapGrid={[16, 16]}
            selectionOnDrag
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="var(--border-subtle)" />
            <Controls position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor="var(--coral-bright)" maskColor="rgba(5, 10, 20, .72)" />
          </ReactFlow>
        </ReactFlowProvider>
      </WorkspacePanelsContext.Provider>
      {toolbar && <div className={`${styles.toolbar} nodrag nowheel`}>{toolbar}</div>}
    </div>
  );
}
