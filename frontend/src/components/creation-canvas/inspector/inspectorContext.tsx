/**
 * What the object inspector reads from the board it is open on — ONE context, provided
 * once by the canvas, instead of the 74 props the inspector used to be handed at its
 * single call site.
 *
 * Board facts (the objects, the session, the viewer's role) are plain values; every
 * action is the canvas's own handler taking the node id, so the context value is built
 * once per board state and `useInspectorBindings` binds it to the node being inspected.
 * The inspector itself then takes only `{ node }`.
 */
import { createContext, useContext, useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasResumeShare, CreationSessionDetail, CreationSessionSummary } from '@/lib/builderforceApi';
import type { CanvasExportAction } from '@/lib/canvasExports';
import type { BuiltinAgentSurfaceIntent } from '@/lib/team/builtinAgentSurface';
import type { IdeProject } from '@/lib/types';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';

export type InspectorFocus = 'knowledge' | 'test' | 'evaluation' | 'delivery' | null;

export interface CanvasInspectorValue {
  nodes: CreationFlowNode[];
  edges: Edge[];
  focus: InspectorFocus;
  timeline: CanvasTimelineMessage[];
  brainTrace: BrainTraceEvent[];
  sessionId: string;
  persistence: 'local' | 'server';
  role: CreationSessionSummary['role'];
  editable: boolean;
  members: CreationSessionDetail['members'];
  creatingBuild: boolean;
  /* ── node-scoped: the canvas's handlers, taking the inspected node's id ── */
  updateNodeData: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  updateWebsiteViewport: (nodeId: string, viewport: 'desktop' | 'tablet' | 'mobile') => void;
  runWorkflow: (nodeId: string) => void;
  publishWebsite: (nodeId: string) => void;
  openBuild: (nodeId: string) => void;
  attachBuild: (nodeId: string, ide: IdeProject) => void;
  deleteBuildWorkspace: (nodeId: string) => void;
  buildWebsiteWithCode: (nodeId: string) => void;
  generateVideo: (nodeId: string) => void;
  runCreativeAction: (nodeId: string, action: string) => void;
  openGamePanel: (nodeId: string) => void;
  openPublishPanel: (nodeId: string) => void;
  openReleasesPanel: (nodeId: string) => void;
  unpackWorkflow: (nodeId: string) => void;
  compileWorkflow: (nodeId: string) => Promise<unknown>;
  buildFlow: (nodeId: string) => Promise<unknown>;
  openEvermindBuild: (nodeId: string) => void;
  loadEvermindTemplate: (nodeId: string, templateId: 'train-llm' | 'teach-code') => void;
  openBuiltinAgent: (nodeId: string, intent: BuiltinAgentSurfaceIntent) => void;
  addAgentKnowledge: (nodeId: string, content: string) => void;
  runAgentTest: (nodeId: string, testPrompt: string, expected: string) => void | Promise<void>;
  convertDiagram: (nodeId: string, format: string, diagramId?: string) => Promise<string>;
  exportArtifact: (nodeId: string, action: CanvasExportAction) => Promise<string>;
  /* ── board-scoped ── */
  removeConnection: (edgeId: string) => void;
  saveAgent: () => void;
  saveFramePreset: () => void;
  expandProject: () => void;
  loadProjectQuality: () => void;
  compareProjects: () => void;
  deliverMockup: () => void;
  expandMockupSet: () => void;
  importDataset: (file: File) => void | Promise<void>;
  visualizeDataset: () => void;
  plotDataset: () => void;
  profileDataset: (nodeId: string) => void;
  attachEvermindProject: () => void;
  expandEvermindPipeline: () => void;
  trainEvermind: () => void;
  startStandup: () => void;
  askBrain: (request: string) => void;
  resumeTailor: (nodeId: string, request: string) => void;
  resumeDetach: (nodeId: string, detachedData: Partial<CreationNodeData>) => void;
  resumeShare: (nodeId: string, kind: 'view' | 'embed') => Promise<void>;
  resumeSharesList: (nodeId: string) => Promise<CanvasResumeShare[]>;
  resumeShareRevoke: (nodeId: string, shareId: string) => Promise<void>;
}

const CanvasInspectorContext = createContext<CanvasInspectorValue | null>(null);
export const CanvasInspectorProvider = CanvasInspectorContext.Provider;

/**
 * The inspector's view of its board, bound to the node it is inspecting — the same
 * names the inspector body has always used, so the body did not change shape.
 */
export function useInspectorBindings(nodeId: string) {
  const value = useContext(CanvasInspectorContext);
  if (!value) throw new Error('useInspectorBindings must be used inside CanvasInspectorProvider');
  return useMemo(() => ({
    nodes: value.nodes,
    edges: value.edges,
    focus: value.focus,
    timeline: value.timeline,
    brainTrace: value.brainTrace,
    sessionId: value.sessionId,
    persistence: value.persistence,
    role: value.role,
    editable: value.editable,
    members: value.members,
    creatingBuild: value.creatingBuild,
    onChange: (patch: Partial<CreationNodeData>) => value.updateNodeData(nodeId, patch),
    onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => value.updateWebsiteViewport(nodeId, viewport),
    onRun: () => value.runWorkflow(nodeId),
    onPublishWebsite: () => value.publishWebsite(nodeId),
    onOpenBuild: () => value.openBuild(nodeId),
    onAttachBuild: (ide: IdeProject) => value.attachBuild(nodeId, ide),
    onDeleteBuildWorkspace: () => value.deleteBuildWorkspace(nodeId),
    onBuildWebsiteWithCode: () => value.buildWebsiteWithCode(nodeId),
    onGenerateVideo: () => value.generateVideo(nodeId),
    onRunCreativeAction: (action: string) => value.runCreativeAction(nodeId, action),
    onShipGame: () => value.openGamePanel(nodeId),
    onPublishListing: () => value.openPublishPanel(nodeId),
    onOpenReleases: () => value.openReleasesPanel(nodeId),
    onUnpackWorkflow: () => value.unpackWorkflow(nodeId),
    onBuildWorkflow: () => { void value.compileWorkflow(nodeId); },
    onBuildFlow: () => { void value.buildFlow(nodeId); },
    onOpenEvermindBuild: () => value.openEvermindBuild(nodeId),
    onLoadEvermindTemplate: (templateId: 'train-llm' | 'teach-code') => value.loadEvermindTemplate(nodeId, templateId),
    onRemoveConnection: value.removeConnection,
    onSaveAgent: value.saveAgent,
    onOpenBuiltinAgent: (intent: BuiltinAgentSurfaceIntent) => value.openBuiltinAgent(nodeId, intent),
    onAddAgentKnowledge: (content: string) => value.addAgentKnowledge(nodeId, content),
    onRunAgentTest: (testPrompt: string, expected: string) => value.runAgentTest(nodeId, testPrompt, expected),
    onSaveFramePreset: value.saveFramePreset,
    onExpandProject: value.expandProject,
    onLoadProjectQuality: value.loadProjectQuality,
    onCompareProjects: value.compareProjects,
    onDeliverMockup: value.deliverMockup,
    onExpandMockupSet: value.expandMockupSet,
    onImportDataset: value.importDataset,
    onVisualizeDataset: value.visualizeDataset,
    onPlotDataset: value.plotDataset,
    onProfileDataset: value.profileDataset,
    onAttachEvermindProject: value.attachEvermindProject,
    onExpandEvermindPipeline: value.expandEvermindPipeline,
    onTrainEvermind: value.trainEvermind,
    onStartStandup: value.startStandup,
    onConvertDiagram: (format: string, diagramId?: string) => value.convertDiagram(nodeId, format, diagramId),
    onExportArtifact: (action: CanvasExportAction) => value.exportArtifact(nodeId, action),
    onAskBrain: value.askBrain,
    onResumeTailor: value.resumeTailor,
    onResumeDetach: value.resumeDetach,
    onResumeShare: value.resumeShare,
    onResumeSharesList: value.resumeSharesList,
    onResumeShareRevoke: value.resumeShareRevoke,
  }), [nodeId, value]);
}
