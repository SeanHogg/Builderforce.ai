'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Background,
  BackgroundVariant,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CanvasCommands, cleanCanvasLayout } from '@/components/canvas/CanvasCommands';
import { Canvas3DView, type Canvas3DMove } from '@/components/canvas/Canvas3DView';
import { Canvas3DControlsProvider, useCanvasThreeD } from '@/components/canvas/canvas3dControls';
import { applyCanvas3DMoves, canvas3dDepthOffset, type Canvas3DDescriptor } from '@/components/canvas/canvas3d';
import styles from './WorkspaceCanvas.module.css';

export interface WorkspaceCanvasPanel {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  /**
   * Which family this panel belongs to. It is the depth axis when the workspace
   * is read in 3D — a dashboard has no connections to stack by, so the grouping
   * IS the structure. Panels that declare none share one plane.
   */
  group?: string;
  content: ReactNode;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  removable?: boolean;
}

type WorkspacePanelData = {
  panelId: string;
  /** How far this panel floats off its depth plane in the 3D reading. */
  depthOffset?: number;
};

type WorkspacePanelNode = Node<WorkspacePanelData, 'workspacePanel'>;

const WorkspacePanelsContext = createContext<{
  panels: WorkspaceCanvasPanel[];
  onRemovePanel?: (id: string) => void;
}>({ panels: [] });

function WorkspacePanel({ data, selected }: NodeProps<WorkspacePanelNode>) {
  const t = useTranslations('workspaceCanvas');
  const { panels, onRemovePanel } = useContext(WorkspacePanelsContext);
  const panel = panels.find((candidate) => candidate.id === data.panelId);
  if (!panel) return null;
  return (
    <section className={`${styles.node} ${selected ? styles.nodeSelected : ''}`} aria-label={t('panelLabel', { title: panel.title })}>
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
            aria-label={t('removePanel', { title: panel.title })}
            onClick={() => onRemovePanel(panel.id)}
          >×</button>
        )}
      </header>
      <div className={`${styles.body} nodrag nowheel`}>{panel.content}</div>
    </section>
  );
}

function MobileWorkspacePanel({ panel, onRemovePanel }: { panel: WorkspaceCanvasPanel; onRemovePanel?: (id: string) => void }) {
  const t = useTranslations('workspaceCanvas');
  return <section className={`${styles.node} ${styles.mobileNode}`} aria-label={t('panelLabel', { title: panel.title })}>
    <header className={styles.header}>
      <span className={styles.icon} aria-hidden>{panel.icon ?? '◇'}</span>
      <strong className={styles.title}>{panel.title}</strong>
      {panel.subtitle && <span className={styles.subtitle}>{panel.subtitle}</span>}
      <span className={styles.spacer} />
      {panel.removable && onRemovePanel && <button type="button" className={styles.close} aria-label={t('removePanel', { title: panel.title })} onClick={() => onRemovePanel(panel.id)}>×</button>}
    </header>
    <div className={`${styles.body} ${styles.mobileBody}`}>{panel.content}</div>
  </section>;
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
  const t = useTranslations('workspaceCanvas');
  const initialNodes = useMemo(() => panels.map(panelNode), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkspacePanelNode>(initialNodes);
  const [mobile, setMobile] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const flowRef = useRef<ReactFlowInstance<WorkspacePanelNode, never> | null>(null);
  const panelIds = panels.map((panel) => panel.id).join('\u0000');
  const threeD = useCanvasThreeD();

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    setNodes((current) => panels.map((panel, index) => {
      const existing = current.find((node) => node.id === panel.id);
      return existing ?? panelNode(panel, index);
    }));
    // Panel content is read from context, so spatial node state only reconciles
    // when the set of reusable panels changes.
  }, [panelIds, setNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanLayout = useCallback(() => {
    setNodes((current) => cleanCanvasLayout(current, []));
    window.setTimeout(() => void flowRef.current?.fitView({ padding: .12, maxZoom: 1, duration: 320 }), 0);
  }, [setNodes]);

  /**
   * How a panel reads in the 3D space.
   *
   * A workspace has no connections, so there is no dependency depth to read — what
   * depth buys here is room: full-size panels that overlap and fight for the same
   * flat area separate onto planes by family, and the camera travels between them
   * instead of the reader hunting under one panel for another.
   */
  const panelById = useMemo(() => new Map(panels.map((panel) => [panel.id, panel])), [panels]);
  const describeThreeD = useCallback((node: WorkspacePanelNode): Canvas3DDescriptor => {
    const panel = panelById.get(node.data.panelId);
    return {
      label: panel?.title ?? node.id,
      sublabel: panel?.subtitle,
      group: panel?.group ?? t('defaultGroup'),
      icon: panel?.icon ?? '◇',
      depthOffset: canvas3dDepthOffset(node),
    };
  }, [panelById, t]);
  const moveThreeD = useCallback(
    (moves: readonly Canvas3DMove[]) => setNodes((current) => applyCanvas3DMoves(current, moves)),
    [setNodes],
  );

  if (mobile) return <div className={`${styles.canvas} ${styles.mobileCanvas}${className ? ` ${className}` : ''}`} data-testid="workspace-canvas" data-layout="widgets">
    {toolbar && <div className={styles.mobileToolbar}>{toolbar}</div>}
    <div className={styles.mobileStack}>{panels.map((panel) => <MobileWorkspacePanel key={panel.id} panel={panel} onRemovePanel={onRemovePanel} />)}</div>
  </div>;

  return (
    <div className={`${styles.canvas}${className ? ` ${className}` : ''}`} data-testid="workspace-canvas" data-layout="spatial">
      <WorkspacePanelsContext.Provider value={{ panels, onRemovePanel }}>
        <ReactFlowProvider>
          <Canvas3DControlsProvider>
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onInit={(instance) => { flowRef.current = instance; }}
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
            <CanvasCommands
              minimapOpen={minimapOpen}
              setMinimapOpen={setMinimapOpen}
              onCleanLayout={cleanLayout}
              minimapNodeColor="var(--coral-bright)"
              minimapMaskColor="rgba(5, 10, 20, .72)"
              {...threeD.commandProps}
            />
          </ReactFlow>
          {threeD.active && <Canvas3DView
            nodes={nodes}
            edges={[]}
            describe={describeThreeD}
            onMove={moveThreeD}
            onExit={threeD.exit}
          />}
          </Canvas3DControlsProvider>
        </ReactFlowProvider>
      </WorkspacePanelsContext.Provider>
      {toolbar && <div className={`${styles.toolbar} nodrag nowheel`}>{toolbar}</div>}
    </div>
  );
}
