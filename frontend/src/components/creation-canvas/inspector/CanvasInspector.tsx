import type { CreationFlowNode } from '../CreationNode';
import type { Edge } from '@xyflow/react';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { type CanvasResumeShare, type CreationSessionDetail, creationSessionsApi, type CreationSessionSummary, pmoApi, type PmoScopeKind, runtimeApi, tasksApi } from '@/lib/builderforceApi';
import type { CreationNodeData } from '../types';
import type { IdeProject } from '@/lib/types';
import type { BuiltinAgentSurfaceIntent } from '@/lib/team/builtinAgentSurface';
import type { CanvasExportAction } from '@/lib/canvasExports';
import { useFormat } from '@/i18n/useFormat';
import { useTranslations } from 'next-intl';
import { patchWebsiteHero, websiteHeroFrom, websiteThemeFrom } from '../websiteWysiwyg';
import { useEffect, useRef, useState } from 'react';
import { creationDeliverables } from '@/lib/creationDeliverables';
import { faultText } from '@/lib/apiClient';
import { toFrameBox } from '../useFramedBoard';
import { frameMemberIds } from '@/domains/canvas/domain/canvasFrame';
import { KIND_DETAIL_SECTIONS, type KindSectionProps } from './kindDetailSections';
import { kindSettingsManifest, kindSettingsSellable } from '@/lib/canvasKindSettings';
import styles from '../CreationCanvas.module.css';
import { canvasPersonOrigin, isCanvasPersonKind } from '@/lib/canvasNodeAffordances';
import { KindDetailsFields } from './KindDetailsFields';
import { TimingFields } from '../TimingFields';
import { DiagramConvertPanel } from '../DiagramConvertPanel';
import { KindDetailsActions } from '../KindDetailsActions';
import { isSpecObjectKind } from '@/lib/specObjects';
import { ActivityInspector } from './ActivityInspector';
import { CourseSubjectControl, PracticeAuthoring, ReadingLevelControl } from '../LearningControls';
import { SourceList } from './datasetInspectorParts';
import { SellInMarketplace } from '../SellInMarketplace';
import { CanvasExportActions, canvasExportActionsFor } from '../CanvasExportActions';

export function Inspector({ node, nodes, edges, focus, timeline, brainTrace, sessionId, persistence, role, editable, members, onChange, onWebsiteViewportChange, onRun, onPublishWebsite, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace, onBuildWebsiteWithCode, creatingBuild, onGenerateVideo, onRunCreativeAction, onShipGame, onPublishListing, onOpenReleases, onUnpackWorkflow, onBuildWorkflow, onBuildFlow, onRemoveConnection, onOpenEvermindBuild, onLoadEvermindTemplate, onSaveAgent, onOpenBuiltinAgent, onAddAgentKnowledge, onRunAgentTest, onSaveFramePreset, onExpandProject, onLoadProjectQuality, onCompareProjects, onDeliverMockup, onExpandMockupSet, onImportDataset, onVisualizeDataset, onPlotDataset, onProfileDataset, onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind, onStartStandup, onConvertDiagram, onExportArtifact, onAskBrain, onResumeTailor, onResumeDetach, onResumeShare, onResumeSharesList, onResumeShareRevoke }: { node: CreationFlowNode; nodes: CreationFlowNode[]; edges: Edge[]; focus: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null; timeline: CanvasTimelineMessage[]; brainTrace: BrainTraceEvent[]; sessionId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; editable: boolean; members: CreationSessionDetail['members']; onChange: (patch: Partial<CreationNodeData>) => void; onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => void; onRun: () => void; onPublishWebsite: () => void; onOpenBuild: () => void; onAttachBuild: (ide: IdeProject) => void; onDeleteBuildWorkspace: () => void; onBuildWebsiteWithCode: () => void; creatingBuild: boolean; onGenerateVideo: () => void; onRunCreativeAction: (action: string) => void; onShipGame: () => void; onPublishListing: () => void; onOpenReleases: () => void; onUnpackWorkflow: () => void; onBuildWorkflow: () => void; onBuildFlow: () => void; onRemoveConnection: (edgeId: string) => void; onOpenEvermindBuild: () => void; onLoadEvermindTemplate: (templateId: 'train-llm' | 'teach-code') => void; onSaveAgent: () => void; onOpenBuiltinAgent: (intent: BuiltinAgentSurfaceIntent) => void; onAddAgentKnowledge: (content: string) => void; onRunAgentTest: (testPrompt: string, expected: string) => void | Promise<void>; onSaveFramePreset: () => void; onExpandProject: () => void; onLoadProjectQuality: () => void; onCompareProjects: () => void; onDeliverMockup: () => void; onExpandMockupSet: () => void; onImportDataset: (file: File) => void | Promise<void>; onVisualizeDataset: () => void; onPlotDataset: () => void; onProfileDataset: (nodeId: string) => void; onAttachEvermindProject: () => void; onExpandEvermindPipeline: () => void; onTrainEvermind: () => void; onStartStandup: () => void; onConvertDiagram: (format: string, diagramId?: string) => Promise<string>; onExportArtifact: (action: CanvasExportAction) => Promise<string>;
  /** The ONE route from the inspector back to Brain. Learning controls compose
   *  their own request text (see LearningControls.tsx) rather than each adding a
   *  callback to a panel that already takes forty. */
  onAskBrain: (request: string) => void;
  onResumeTailor: (nodeId: string, request: string) => void;
  onResumeDetach: (nodeId: string, detachedData: Partial<CreationNodeData>) => void;
  onResumeShare: (nodeId: string, kind: 'view' | 'embed') => Promise<void>;
  onResumeSharesList: (nodeId: string) => Promise<CanvasResumeShare[]>;
  onResumeShareRevoke: (nodeId: string, shareId: string) => Promise<void>; }) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas');
  const kind = node.data.kind;
  const onWebsiteChange = (patch: Partial<CreationNodeData>) => onChange(patchWebsiteHero(node.data, patch));
  const websiteHero = websiteHeroFrom(node.data);
  const websiteTheme = websiteThemeFrom(node.data);
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  const [accessStatus, setAccessStatus] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState('');
  /* Only for scrolling a named section into view. The panel around this owns the width
     and the two readings it comes in — see `CanvasNodePanel`. */
  const inspectorRef = useRef<HTMLDivElement>(null);
  // The human half of the unified assignee picker — `tasksApi.assignees()` already
  // existed for this exact purpose (see its own doc comment) and was never called from
  // here, so a task could only ever be assigned to an agent even though `assignedUserId`
  // is a first-class column the read path already renders ("Assigned teammate").
  const [taskAssignees, setTaskAssignees] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (node.data.kind !== 'task' || persistence !== 'server') { setTaskAssignees([]); return; }
    let active = true;
    void tasksApi.assignees().then((result) => { if (active) setTaskAssignees(result); }).catch(() => { if (active) setTaskAssignees([]); });
    return () => { active = false; };
  }, [node.data.kind, persistence]);
  /** What this ticket cost to build. `runtimeApi.taskCost` (`GET
   *  /api/runtime/tasks/:taskId/cost`, read-through cached) already sums
   *  `llm_usage_log` by `task_id` — this was never called from the board, so a task
   *  assigned to an agent could never show what its runs cost. */
  const [taskCost, setTaskCost] = useState<{ estimatedCostUsd: number; totalTokens: number; requests: number } | null>(null);
  useEffect(() => {
    const match = node.data.kind === 'task' ? /^task:(\d+)$/.exec(node.data.resourceId || '') : null;
    if (!match || persistence !== 'server') { setTaskCost(null); return; }
    let active = true;
    void runtimeApi.taskCost(Number(match[1])).then((result) => { if (active) setTaskCost(result); }).catch(() => { if (active) setTaskCost(null); });
    return () => { active = false; };
  }, [node.data.kind, node.data.resourceId, persistence]);
  useEffect(() => {
    if (!focus) return;
    const frame = window.requestAnimationFrame(() => inspectorRef.current?.querySelector<HTMLElement>(`[data-inspector-section="${focus}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focus, node.id]);
  const deliverables = creationDeliverables(node.data);
  const taskId = kind === 'task' && /^task:\d+$/.test(node.data.resourceId || '') ? Number(node.data.resourceId!.slice(5)) : null;
  const taskAgents = nodes.filter((candidate) => candidate.data.kind === 'agent');
  const agentTools = Array.isArray(node.data.tools) ? node.data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const isExistingAgent = kind === 'agent' && typeof node.data.resourceId === 'string' && node.data.resourceId.startsWith('agent:');
  const isBuiltinAgent = kind === 'agent' && typeof node.data.agentDomain === 'string' && typeof node.data.agentSeat === 'string';
  const isBuiltinManager = isBuiltinAgent && node.data.agentDomain === 'delivery' && node.data.agentSeat === 'Manager';
  const connectedAgentKnowledge = kind === 'agent' ? nodes.filter((candidate) => ['knowledge', 'document', 'dataset', 'file', 'url'].includes(candidate.data.kind) && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : [];
  const connectedAgentEvaluation = kind === 'agent' ? nodes.find((candidate) => candidate.data.kind === 'evaluation' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const connectedAgentRelease = kind === 'agent' ? nodes.find((candidate) => candidate.data.kind === 'release' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const deliveryAgent = kind === 'release' ? (nodes.find((candidate) => candidate.data.kind === 'agent' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) || (nodes.filter((candidate) => candidate.data.kind === 'agent').length === 1 ? nodes.find((candidate) => candidate.data.kind === 'agent') : undefined)) : undefined;
  const deliveryKnowledgeCount = deliveryAgent ? nodes.filter((candidate) => ['knowledge', 'document', 'dataset', 'file', 'url'].includes(candidate.data.kind) && edges.some((edge) => (edge.source === deliveryAgent.id && edge.target === candidate.id) || (edge.target === deliveryAgent.id && edge.source === candidate.id))).length : 0;
  const availableAgentTools = ['Audience Analyzer', 'Copy Optimizer', 'Research', 'Browser'];
  const mockupProjects = nodes.filter((candidate) => candidate.data.kind === 'project');
  const mockupAgents = taskAgents;
  const defaultMockupProjectRef = mockupProjects[0]?.data.resourceId || mockupProjects[0]?.id || 'draft:builderforce-launch';
  const mockupProjectValue = typeof node.data.deliveryProjectRef === 'string' ? node.data.deliveryProjectRef : defaultMockupProjectRef;
  const defaultMockupAgentRef = mockupAgents[0]?.data.resourceId || mockupAgents[0]?.id || 'campaign-strategist';
  const mockupAgentValue = typeof node.data.mockupAgentRef === 'string' ? node.data.mockupAgentRef : defaultMockupAgentRef;
  const selectedTaskAgent = taskAgents.find((agent) => agent.data.title === node.data.assignee || agent.data.title === node.data.role);
  const taskAgentValue = typeof node.data.agentRef === 'string' ? node.data.agentRef : selectedTaskAgent ? (selectedTaskAgent.data.resourceId?.replace(/^agent:/, '') || selectedTaskAgent.id) : '';
  const connectedPrd = kind === 'task' ? nodes.find((candidate) => candidate.data.kind === 'prd' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const prdTitle = typeof connectedPrd?.data.title === 'string' ? connectedPrd.data.title : typeof node.data.prdTitle === 'string' ? node.data.prdTitle : '';
  const prdStatus = typeof connectedPrd?.data.status === 'string' ? connectedPrd.data.status : typeof node.data.prdStatus === 'string' ? node.data.prdStatus : '';
  const prdSummary = [connectedPrd?.data.markdown, connectedPrd?.data.content, connectedPrd?.data.subtitle, node.data.prdSummary].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const normalizedTaskStatus = String(node.data.status || 'ready').toLowerCase().replaceAll(' ', '_');
  const statusGuidance: Record<string, string> = {
    backlog: 'Add a clear description and PRD, set priority, and assign an agent to make this ready.',
    todo: 'Confirm the PRD and acceptance criteria, then move the task to Ready.',
    ready: 'The task is actionable. Start work by moving it to In progress or running its assigned agent.',
    assigned: 'The owner is set. Move the task to In progress when execution begins.',
    in_progress: 'Keep the description and acceptance criteria current; move to In review when evidence is ready.',
    in_review: 'Validate the work against the PRD and acceptance criteria, then mark Done or return it to In progress.',
    blocked: 'Record the blocker in the description, resolve its dependency, then return it to Ready or In progress.',
    done: 'This task is complete. Reopen it only when the PRD or acceptance criteria are not satisfied.',
  };
  const persistTaskPatch = async (apiPatch: Parameters<typeof tasksApi.update>[1], canvasPatch: Partial<CreationNodeData>) => {
    setActionStatus(t('savingTask'));
    try {
      if (taskId != null && persistence === 'server') await tasksApi.update(taskId, apiPatch);
      onChange(canvasPatch);
      setActionStatus(taskId != null && persistence === 'server' ? t('taskUpdated') : t('taskUpdatedLocal'));
    } catch (error) {
      setActionStatus(faultText(error, t('taskUpdateFailed')));
    }
  };
  // What this frame holds, through the SAME containment the board draws with — not a
  // second geometry rule that could disagree with the one on screen.
  const frameMembers = kind === 'frame'
    ? (() => {
      const boxes = nodes.map(toFrameBox);
      const memberIds = new Set(frameMemberIds(node.id, boxes));
      return nodes.filter((candidate) => memberIds.has(candidate.id));
    })()
    : [];
  const runArtifactAction = async (action: CanvasExportAction) => {
    setActionStatus(t('preparing'));
    setActionStatus(await onExportArtifact(action));
  };
  // Everything a `custom.component` section might read, computed once per render —
  // see `KindSectionProps` for why this is one bag rather than eleven prop lists.
  const kindSectionProps: KindSectionProps = {
    node, nodes, edges, onRemoveConnection, frameMembers, onOpenEvermindBuild, onLoadEvermindTemplate,
    data: node.data, editable, persistence, onChange,
    isBuiltinAgent, isBuiltinManager, isExistingAgent, connectedAgentKnowledge,
    agentTools, availableAgentTools, knowledgeDraft, setKnowledgeDraft,
    onOpenBuiltinAgent, onAddAgentKnowledge, onRunAgentTest, onSaveAgent,
    deliveryAgent, deliveryKnowledgeCount,
    websiteHero, websiteTheme, onWebsiteChange, onPublishWebsite, onBuildWebsiteWithCode, onWebsiteViewportChange,
    onGenerateVideo,
    onImportDataset, onProfileDataset, onVisualizeDataset, onPlotDataset,
    taskId, taskAgents, taskAgentValue, taskAssignees, taskCost, statusGuidance, normalizedTaskStatus,
    prdStatus, prdTitle, prdSummary, actionStatus, setActionStatus, persistTaskPatch,
    mockupProjects, mockupProjectValue, mockupAgents, mockupAgentValue, onDeliverMockup,
    onRunCreativeAction, onShipGame,
    creatingBuild, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace,
    onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind,
    onResumeTailor, onResumeDetach, onResumeShare, onResumeSharesList, onResumeShareRevoke,
  };
  // The manifest names an action by a stable string (`'refreshDashboard'`); this is the
  // one place that string resolves to the function it actually calls — everywhere else
  // (visibility, order, label) stays declared in the manifest, not here.
  const detailsActionHandlers: Record<string, () => void> = {
    loadProjectQuality: onLoadProjectQuality,
    expandProject: onExpandProject,
    compareProjects: onCompareProjects,
    unpackWorkflow: onUnpackWorkflow,
    buildWorkflow: onBuildWorkflow,
    buildFlow: onBuildFlow,
    run: onRun,
    startStandup: onStartStandup,
    expandMockupSet: onExpandMockupSet,
    deliverMockup: onDeliverMockup,
    saveFramePreset: onSaveFramePreset,
    refreshDashboard: () => onChange({ fetchedAt: new Date().toISOString(), status: 'Live' }),
    // The board half of "one board where the plan and the measurement of the plan are
    // the same artifact": pulls `pmoApi.rollup()` for this object's own `scopeKind`/
    // `scopeId` and flattens it onto the node exactly as `MUTABLE_FIELDS.deliveryRollup`
    // declares, so every stat the manifest locks as read-only has something real behind it.
    refreshDeliveryRollup: () => {
      const scopeKind = (typeof node.data.scopeKind === 'string' ? node.data.scopeKind : 'workspace') as PmoScopeKind;
      const scopeId = typeof node.data.scopeId === 'string' && node.data.scopeId ? node.data.scopeId : undefined;
      setActionStatus(t('preparing'));
      void pmoApi.rollup(scopeKind, scopeId).then((rollup) => {
        onChange({
          title: rollup.scope.name || node.data.title,
          totalTasks: rollup.delivery.totalTasks, completedCount: rollup.delivery.completedCount, openCount: rollup.delivery.openCount,
          avgCycleTimeHours: rollup.delivery.avgCycleTimeHours, throughputPerWeek: rollup.delivery.throughputPerWeek,
          agentLlmCostUsd: rollup.spend.agentLlmCostUsd,
          deploymentFrequencyPerDay: rollup.dora.deploymentFrequencyPerDay, leadTimeHours: rollup.dora.leadTimeHours,
          changeFailureRatePct: rollup.dora.changeFailureRatePct, mttrHours: rollup.dora.mttrHours,
          avgOkrProgress: rollup.okr.avgProgress,
          fetchedAt: new Date().toISOString(), status: 'Live',
        });
        setActionStatus('');
      }).catch((error) => setActionStatus(faultText(error, t('taskUpdateFailed'))));
    },
  };
  /**
   * The kind's custom section, as a COMPONENT TYPE — capitalised because it is
   * mounted as an element below and never called.
   *
   * It used to be invoked as `kindCustomSection(props)`, which is a plain function
   * call: React has no component boundary there, so the section's hooks were
   * appended to `Inspector`'s own hook list. The sections have DIFFERENT hook
   * counts (`ResumeInspectorSection` has none, most call `useTranslations`,
   * `TaskInspectorSection` calls `useFormat` as well), so selecting a résumé and
   * then a task changed the number of hooks `Inspector` rendered between two
   * renders and React threw "Rendered more hooks than during the previous
   * render" — a white-screened inspector from an ordinary click. Mounting it as
   * an element gives each section its own instance and its own hook list, which
   * is the entire reason the registry is a table of components.
   */
  const KindCustomSection = KIND_DETAIL_SECTIONS[kindSettingsManifest(kind)?.custom?.component ?? ''];
  /**
   * The object's whole inspector, drawn INSIDE the panel anchored to its card.
   *
   * It keeps `aria-label="Details panel"` and the `.inspector` class — the class because
   * every field, label and footer rule in the stylesheet is written against it, the label
   * because this is still the details of one object and a screen reader should be told
   * which region it has entered. What it no longer has is a shell of its own: no fixed
   * position, no resize handle, no title bar and no close button, because the panel around
   * it already carries all four for the same object. Two headers naming the same card,
   * with two different closes, is how the old rail read next to the compact panel.
   */
  return <aside ref={inspectorRef} className={styles.inspector} aria-label="Details panel">
    <div className={styles.inspectorTabs}><button className={tab === 'details' ? styles.activeTab : ''} onClick={() => setTab('details')}>{t('details')}</button><button className={tab === 'activity' ? styles.activeTab : ''} onClick={() => setTab('activity')}>{t('activity')}</button></div>
    <div className={styles.inspectorBody}>
      {tab === 'details' ? <fieldset className={styles.inspectorFields} disabled={!editable}>
      {node.data.redacted === true && <><p className={styles.inspectorHint}>{t('redactedObject')}</p><button type="button" className={styles.fullButton} disabled={persistence !== 'server' || !!accessStatus} onClick={() => { setAccessStatus(t('requesting')); void creationSessionsApi.requestObjectAccess(sessionId, node.id).then(() => setAccessStatus(t('accessRequested'))).catch((error) => setAccessStatus(faultText(error, t('requestFailed')))); }}>{accessStatus || t('requestAccess')}</button></>}
      {/* A built-in seat's name is locked here too, not only on the compact Persona
          panel — the object edited at either width must agree on what is actually
          editable, or renaming it from the wide reading would silently undo the lock
          the short one promised. */}
      <label>{t('name')}<input value={node.data.title} disabled={isCanvasPersonKind(kind) && canvasPersonOrigin(kind) === 'builtin'} onChange={(event) => onChange({ title: event.target.value })} /></label>
      {typeof node.data.pipelineStep === 'number' && <section className={styles.pipelineInspectorGuide} aria-label={t('evermindSetupStep', { step: node.data.pipelineStep })}><span>{t('evermindSetupOf5', { step: node.data.pipelineStep })}</span><strong>{node.data.pipelineStart === true ? t('startHere') : node.data.title}</strong><p>{String(node.data.pipelineInstruction || t('pipelineStageHint'))}</p>{node.data.pipelineStep === 1 && node.data.status !== 'Imported' && <small>{t('useFilePicker')}</small>}{node.data.pipelineStep === 1 && node.data.status === 'Imported' && <small>{t('dataReadyNext')}</small>}</section>}
      {/* Every kind below used to be its own `kind === 'x'` branch in this fieldset —
          ~30 of them, one 700-line conditional chain. Now each is a manifest entry
          (`lib/canvasKindSettings.*.ts`): plain fields render generically via
          `KindDetailsFields`, a kind with real cross-node state or file/network side
          effects (agent's workbench, a dataset's import, a task's PRD join…) names a
          `custom.component` looked up in `KIND_DETAIL_SECTIONS` — DATA, not a chain —
          and `KindDetailsActions` renders whatever buttons the manifest declares,
          wired through the ONE handler map built above. A kind in neither registry
          (spec-object kinds edit on their card; `chat` has its own surface) falls
          through to the same "this object lives on the board" hint every kind without
          settings always showed. */}
      <KindDetailsFields kind={kind} data={node.data} editable={editable} onChange={onChange} />
      {/* "Run on its own" belongs to EVERY object — the clock badge on the card says so.
          It is drawn here as well as in the compact panel's Advanced section because the
          wide reading of that panel REPLACES the compact one: without this, widening to
          see everything about an object would be the one action that hides its schedule.
          Same component both ways, so the two cannot drift on what an interval means. */}
      <TimingFields data={node.data} editable={editable} onChange={onChange} />
      {KindCustomSection && <KindCustomSection {...kindSectionProps} />}
      {/* The panel decides for itself whether this object has anything to
          convert, and to which notations — so no kind list is maintained here. */}
      <DiagramConvertPanel node={node} nodes={nodes} onConvert={onConvertDiagram} />
      <KindDetailsActions objectId={node.id} kind={kind} data={node.data} editable={editable} handlers={detailsActionHandlers} />
      {!kindSettingsManifest(kind) && !isSpecObjectKind(kind) && kind !== 'chat' && <p className={styles.inspectorHint}>{t('objectLiveHint')}</p>}
      </fieldset> : <ActivityInspector sessionId={sessionId} objectId={node.id} data={node.data} persistence={persistence} role={role} members={members} />}
      {/* Where the evidence behind THIS object is shown — for every kind that
          carries it, not the two that happened to mount the list. `sources` is an
          authorable field on eighteen kinds (document, report, knowledge, chart,
          slides, roadmap, evaluation, pitch…), and Brain writes it whenever it
          grounds an answer, but only `projectComparison` and `mockupSet` rendered
          it: on everything else the citations were written, persisted, and never
          shown, so a grounded research document was indistinguishable from an
          invented one. The list decides its own visibility (null when empty), so
          one mount covers every kind and cannot drift from the field. */}
      {/* Learning controls. Each decides its own visibility from the object —
          the reading-level rewrite appears on anything whose body is prose (read
          off the registry, not a list here), and the two authoring panels on the
          kind that owns them. */}
      {tab === 'details' && <>
        <ReadingLevelControl data={node.data} editable={editable} onAskBrain={onAskBrain} />
        <CourseSubjectControl data={node.data} editable={editable} onChange={onChange} onAskBrain={onAskBrain} />
        <PracticeAuthoring data={node.data} editable={editable} onChange={onChange} onAskBrain={onAskBrain} />
      </>}
      {tab === 'details' && <SourceList sources={node.data.sources} />}
      {/* The step that used to be missing: an object that runs on this board and
          nowhere else becomes something a stranger can find, buy and play. The
          button decides its own visibility from the KIND — and, separately, whether
          THIS INSTANCE may be sold: a managed seat like a board's CMO is the same
          `agent` kind a hand-authored one is, but `kindSettingsSellable` reads the
          instance's own origin, which is the fix for a built-in collaborator showing
          "Sell this as a Agent" beside a card that says it is managed by BuilderForce. */}
      {tab === 'details' && (
        <SellInMarketplace
          kind={kind}
          disabled={!editable}
          sellable={kindSettingsSellable(kind, node.data)}
          onPublish={onPublishListing}
          onReleases={onOpenReleases}
        />
      )}
      {tab === 'details' && canvasExportActionsFor(node.data).length > 0 && <section aria-label={t('copyAndDownload')} style={{ display: 'grid', gap: 7, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('copyAndDownload')}</strong>
        <CanvasExportActions data={node.data} onExport={(action) => void runArtifactAction(action)} className={styles.panelActions} />
        {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
      </section>}
      {tab === 'details' && deliverables.length > 0 && <section aria-label={t('deliverables')} style={{ display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}><strong style={{ fontSize: 'var(--font-size-small)' }}>{t('deliveredOutputs')}</strong>{deliverables.slice(0, 6).map((deliverable) => <div key={deliverable.id} style={{ display: 'grid', gap: 2, fontSize: 'var(--font-size-small)' }}><span><b>{deliverable.artifactKind}</b> · {deliverable.status}</span><small>{deliverable.provider || 'Builderforce'} · {fmt.dateTime(deliverable.completedAt || deliverable.createdAt)}</small>{deliverable.url && !deliverable.url.startsWith('data:') && <a href={deliverable.url} target="_blank" rel="noreferrer">{t('openDeliverable')}</a>}{deliverable.error && <small style={{ color: 'var(--error-text)' }}>{deliverable.error}</small>}</div>)}</section>}
    </div>
    <footer><span>{t('resourceRole', { role })}</span><code>{node.data.resourceId || `session:${node.id}`}</code><button className={styles.fullButton} disabled={!editable} onClick={() => kind === 'task' ? setActionStatus(t('taskDetailsSaved')) : onChange({ status: 'Saved' })}>{kind === 'task' ? t('saveTaskDetails') : t('saveChanges')}</button></footer>
  </aside>;
}
