import type { CreationFlowNode } from '../CreationNode';
import type { Edge } from '@xyflow/react';
import type { CreationNodeData } from '../types';
import type { BuiltinAgentSurfaceIntent } from '@/lib/team/builtinAgentSurface';
import { type CanvasResumeShare, tasksApi } from '@/lib/builderforceApi';
import type { IdeProject } from '@/lib/types';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { AUTHORED_DRAWING_STROKE, AUTHORED_WEBSITE_ACCENT } from '@/domains/canvas/domain/authoredColors';
import { DatasetPlotAction, DatasetProfileSummary } from './datasetInspectorParts';
import { CanvasResumeEditor } from '../CanvasResumeEditor';
import { canvasWebPageUrl, normalizeWebPageUrl } from '@/lib/canvasWebPage';
import { canvasViewport } from '@builderforce/creation-canvas-contract';
import { useFormat } from '@/i18n/useFormat';
import { canvasStrokes } from '@/lib/canvasDrawing';
import { CREATIVE_OUTPUTS, restyleDrawing } from '../canvasNodeHelpers';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { FrameFlowSection } from '../FrameFlowSection';
import { FlowStepInspector } from '../FlowStepInspector';
import { GuidedTourInspector } from './GuidedTourInspector';
import { BuildInspectorSection } from './BuildInspectorSection';
import { CanvasVoiceInspector } from './CanvasVoiceInspector';
import { CanvasEmailComposer } from '../CanvasEmailComposer';
import { EvermindInspector } from './EvermindInspector';
import { PitchInspector } from './PitchInspector';

/**
 * Everything a kind's wide-panel `custom.component` section might need. One shape
 * for all eleven, because the alternative — eleven different call signatures — is what
 * the dispatch table in `KIND_DETAIL_SECTIONS` exists to avoid: `Inspector` already
 * computes every one of these once, so handing the whole bag to whichever section is
 * about to mount costs nothing a per-kind prop list would have saved.
 */
export interface KindSectionProps {
  node: CreationFlowNode;
  nodes: CreationFlowNode[];
  /** The board's connections. A step is defined as much by what it is wired to as by
   *  its own config, which is the first time a section has needed them. */
  edges: Edge[];
  /** What a frame holds, at any depth. Empty for every other kind. Resolved through
   *  the SAME containment the board draws with (`toFrameBox` + `frameMemberIds`), so
   *  the section cannot count something the board does not consider inside. */
  frameMembers: CreationFlowNode[];
  /** Run this section's Evermind BUILD steps in the browser. */
  onOpenEvermindBuild: () => void;
  /** Lay a starting Evermind pipeline out inside this section. */
  onLoadEvermindTemplate: (templateId: 'train-llm' | 'teach-code') => void;
  /** Cut one connection. Same channel the board uses, so a connection removed in
   *  words and one removed by selecting the arrow are the same operation. */
  onRemoveConnection: (edgeId: string) => void;
  data: CreationNodeData;
  editable: boolean;
  persistence: 'local' | 'server';
  onChange: (patch: Partial<CreationNodeData>) => void;
  isBuiltinAgent: boolean;
  isBuiltinManager: boolean;
  isExistingAgent: boolean;
  connectedAgentKnowledge: CreationFlowNode[];
  agentTools: string[];
  availableAgentTools: string[];
  knowledgeDraft: string;
  setKnowledgeDraft: (value: string) => void;
  onOpenBuiltinAgent: (intent: BuiltinAgentSurfaceIntent) => void;
  onAddAgentKnowledge: (content: string) => void;
  onRunAgentTest: (testPrompt: string, expected: string) => void | Promise<void>;
  onSaveAgent: () => void;
  deliveryAgent: CreationFlowNode | undefined;
  deliveryKnowledgeCount: number;
  websiteHero: { heading: string; body: string; cta: string };
  websiteTheme: { accent?: string };
  onWebsiteChange: (patch: Partial<CreationNodeData>) => void;
  onPublishWebsite: () => void;
  onBuildWebsiteWithCode: () => void;
  onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => void;
  onGenerateVideo: () => void;
  onImportDataset: (file: File) => void | Promise<void>;
  onProfileDataset: (nodeId: string) => void;
  onVisualizeDataset: () => void;
  onPlotDataset: () => void;
  taskId: number | null;
  taskAgents: CreationFlowNode[];
  taskAgentValue: string;
  taskAssignees: { id: string; name: string }[];
  taskCost: { estimatedCostUsd: number; totalTokens: number; requests: number } | null;
  statusGuidance: Record<string, string>;
  normalizedTaskStatus: string;
  prdStatus: string | undefined;
  prdTitle: string;
  prdSummary: string | undefined;
  actionStatus: string;
  setActionStatus: (value: string) => void;
  persistTaskPatch: (apiPatch: Parameters<typeof tasksApi.update>[1], canvasPatch: Partial<CreationNodeData>) => Promise<void>;
  mockupProjects: CreationFlowNode[];
  mockupProjectValue: string;
  mockupAgents: CreationFlowNode[];
  mockupAgentValue: string;
  onDeliverMockup: () => void;
  onRunCreativeAction: (action: string) => void;
  onShipGame: () => void;
  // `build` and `evermind` dispatch straight to their existing components, which take
  // a few props no other section needs — carried here rather than given their own
  // narrower call shape, per this interface's own rationale above.
  creatingBuild: boolean;
  onOpenBuild: () => void;
  onAttachBuild: (ide: IdeProject) => void;
  onDeleteBuildWorkspace: () => void;
  onAttachEvermindProject: () => void;
  onExpandEvermindPipeline: () => void;
  onTrainEvermind: () => void;
  onResumeTailor: (nodeId: string, request: string) => void;
  onResumeDetach: (nodeId: string, detachedData: Partial<CreationNodeData>) => void;
  onResumeShare: (nodeId: string, kind: 'view' | 'embed') => Promise<void>;
  onResumeSharesList: (nodeId: string) => Promise<CanvasResumeShare[]>;
  onResumeShareRevoke: (nodeId: string, shareId: string) => Promise<void>;
}

/** The custom-authoring workbench for `agent` — extracted verbatim from the old
 *  `kind === 'agent'` branch. A built-in seat gets Execute (+ diagnostics for the
 *  delivery Manager); everything else gets the personality/tools/knowledge/test-bench
 *  authoring flow. Nothing about either branch changed — only that reaching this is now
 *  a manifest lookup instead of one link in a 700-line conditional chain. */
export function AgentInspectorSection({
  data, onChange, isBuiltinAgent, isBuiltinManager, isExistingAgent, connectedAgentKnowledge,
  agentTools, availableAgentTools, knowledgeDraft, setKnowledgeDraft, onOpenBuiltinAgent,
  onAddAgentKnowledge, onRunAgentTest, onSaveAgent,
}: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  if (isBuiltinAgent) {
    return <>
      <section className={styles.agentSetupGuide} data-existing="true" aria-label={t('agentSetupProgress')}>
        <strong>{t('agentBuiltin')}</strong>
        <p>{t('agentBuiltinHint', { seat: String(data.agentSeat) })}</p>
      </section>
      <div className={styles.agentWorkbench}>
        <button type="button" className={styles.fullButton} onClick={() => onOpenBuiltinAgent('execute')}>{t('node.executeBuiltin')}</button>
        {isBuiltinManager && <button type="button" className={styles.secondaryFullButton} onClick={() => onOpenBuiltinAgent('diagnostics')}>{t('node.builtinDiagnostics')}</button>}
      </div>
    </>;
  }
  return <>
    <section className={styles.agentSetupGuide} data-existing={isExistingAgent} aria-label={t('agentSetupProgress')}>
      <strong>{isExistingAgent ? t('agentExisting') : t('agentPrepareNew')}</strong>
      <p>{isExistingAgent ? t('agentExistingHint') : t('agentPrepareHint')}</p>
      {!isExistingAgent && <div className={styles.agentSetupSteps}><span data-done={!!String(data.personality || '').trim()}>{t('agentStepPersonality')}</span><span data-done={connectedAgentKnowledge.length > 0}>{connectedAgentKnowledge.length ? t('agentStepTrainingAdded') : t('agentStepTrainingNeeded')}</span><span data-done={!!String(data.instructions || '').trim()}>{t('agentStepDirection')}</span><span data-done={!!data.testResponse}>{data.testResponse ? t('agentStepTestRun') : t('agentStepTestNeeded')}</span></div>}
    </section>
    {!isExistingAgent && <label>{t('personality')}<textarea aria-label={t('personality')} value={typeof data.personality === 'string' ? data.personality : ''} onChange={(event) => onChange({ personality: event.target.value })} rows={3} placeholder={t('personalityPlaceholder')} /></label>}
    <label>{t('agentModel')}<select value={String(data.model || 'auto')} onChange={(event) => onChange({ model: event.target.value })}><option value="auto">{t('modelAuto')}</option><option value="gpt-4o">gpt-4o</option><option value="claude-3.5-sonnet">claude-3.5-sonnet</option><option value="Evermind">Evermind</option></select></label>
    <label>{isExistingAgent ? t('instructions') : t('agentDirection')}<textarea aria-label={t('instructions')} value={typeof data.instructions === 'string' ? data.instructions : String(data.subtitle || '')} onChange={(event) => onChange({ instructions: event.target.value, subtitle: event.target.value })} rows={5} placeholder={isExistingAgent ? undefined : t('agentDirectionPlaceholder')} /></label>
    <label>{t('tools')}<div className={styles.inspectorPills}>{agentTools.map((tool) => <button type="button" key={tool} aria-label={t('removeTool', { tool })} onClick={() => onChange({ tools: agentTools.filter((candidate) => candidate !== tool) })}>{tool} ×</button>)}<button type="button" disabled={availableAgentTools.every((tool) => agentTools.includes(tool))} onClick={() => { const next = availableAgentTools.find((tool) => !agentTools.includes(tool)); if (next) onChange({ tools: [...agentTools, next] }); }}>{t('addTool')}</button></div></label>
    <label>{t('autonomy')}<select value={typeof data.autonomy === 'string' ? data.autonomy : 'medium'} onChange={(event) => onChange({ autonomy: event.target.value })}><option value="medium">{t('autonomyMedium')}</option><option value="low">{t('autonomyLow')}</option><option value="high">{t('autonomyHigh')}</option></select></label>
    <section className={styles.agentWorkbench} aria-label={t('agentKnowledge')} data-inspector-section="knowledge">
      <div className={styles.workbenchHeading}><strong>{t('knowledge')}</strong><span>{t('connectedCount', { count: connectedAgentKnowledge.length })}</span></div>
      {connectedAgentKnowledge.length > 0 && <div className={styles.knowledgeList}>{connectedAgentKnowledge.map((item) => <span key={item.id}>{item.data.kind} · {item.data.title}</span>)}</div>}
      <label>{t('addKnowledge')}<textarea rows={4} value={knowledgeDraft} onChange={(event) => setKnowledgeDraft(event.target.value)} placeholder={t('addKnowledgePlaceholder')} /></label>
      <button type="button" className={styles.fullButton} disabled={!knowledgeDraft.trim()} onClick={() => { onAddAgentKnowledge(knowledgeDraft); setKnowledgeDraft(''); }}>{t('addAndConnectKnowledge')}</button>
    </section>
    <section className={styles.agentWorkbench} aria-label={t('agentTestBench')} data-inspector-section="test">
      <div className={styles.workbenchHeading}><strong>{t('testBench')}</strong><span>{String(data.testStatus || t('notRun'))}</span></div>
      <label>{t('customerMessage')}<textarea rows={3} value={typeof data.testPrompt === 'string' ? data.testPrompt : ''} onChange={(event) => onChange({ testPrompt: event.target.value })} placeholder={t('customerMessagePlaceholder')} /></label>
      <label>{t('expectedSignals')}<textarea rows={2} value={typeof data.testExpected === 'string' ? data.testExpected : ''} onChange={(event) => onChange({ testExpected: event.target.value })} placeholder={t('expectedSignalsPlaceholder')} /></label>
      <button type="button" className={styles.fullButton} disabled={!String(data.testPrompt || '').trim() || data.testStatus === 'Running'} onClick={() => void onRunAgentTest(String(data.testPrompt || ''), String(data.testExpected || ''))}>{data.testStatus === 'Running' ? t('runningTest') : t('runAgentTest')}</button>
      {typeof data.testResponse === 'string' && data.testResponse && <div className={styles.testResponse}><strong>{t('agentResponse')}</strong><p>{data.testResponse}</p></div>}
    </section>
    <button type="button" className={styles.fullButton} onClick={onSaveAgent}>{isExistingAgent ? t('saveAgentEverywhere') : t('createInviteAgent')}</button>
  </>;
}

export function EvaluationInspectorSection({ data, onChange }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <section data-inspector-section="evaluation">
    <div className={styles.evaluationSummary}><strong>{String(data.verdict || t('notRun'))}</strong><span>{typeof data.passRate === 'number' ? t('passRate', { rate: data.passRate }) : t('runTestForResult')}</span></div>
    <label>{t('evaluationCriteria')}<textarea rows={5} value={typeof data.criteria === 'string' ? data.criteria : typeof data.content === 'string' ? data.content : ''} onChange={(event) => onChange({ criteria: event.target.value })} placeholder={t('evaluationCriteriaPlaceholder')} /></label>
    <p className={styles.inspectorHint}>{t('evaluationHint')}</p>
    {Array.isArray(data.testResults) && data.testResults.length > 0 && <div className={styles.testResults}>{data.testResults.slice(0, 10).map((value, index) => { const result = value as Record<string, unknown>; return <div key={String(result.id || index)}><b>{String(result.status || t('completed'))}</b><span>{String(result.prompt || t('testCase'))}</span><small>{String(result.runAt || '')}</small></div>; })}</div>}
  </section>;
}

export function ReleaseInspectorSection({ deliveryAgent, deliveryKnowledgeCount }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <section className={styles.deliveryChecklist} data-inspector-section="delivery" aria-label={t('agentDeliveryChecklist')}>
    <strong>{t('deliveryChecklist')}</strong>
    <span>{`${deliveryAgent ? '✓' : '○'} ${t('agentSelected')} ${deliveryAgent ? `· ${deliveryAgent.data.title}` : `· ${t('connectAgentCard')}`}`}</span>
    <span>{`${deliveryKnowledgeCount > 0 ? '✓' : '○'} ${t('knowledgeConnected')} ${deliveryKnowledgeCount ? `· ${t('sourceCount', { count: deliveryKnowledgeCount })}` : ''}`}</span>
    <span>{`${deliveryAgent?.data.testResponse ? '✓' : '○'} ${t('testResponseRecorded')}`}</span>
    <span>{`${deliveryAgent?.data.resourceId ? '✓' : '○'} ${t('workforceAgentSaved')}`}</span>
    <p className={styles.inspectorHint}>{deliveryAgent?.data.resourceId ? t('deliveryConnectedHint') : t('deliveryPendingHint')}</p>
  </section>;
}

export function WebsiteInspectorSection({
  data, onChange, websiteHero, websiteTheme, onWebsiteChange, onPublishWebsite, onBuildWebsiteWithCode, onWebsiteViewportChange,
}: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  const kind = data.kind;
  return <>
    <label>{t('headline')}<input value={websiteHero.heading} onChange={(event) => onWebsiteChange({ websiteHeadline: event.target.value })} /></label>
    <label>{t('supportingCopy')}<textarea rows={3} value={websiteHero.body} onChange={(event) => onWebsiteChange({ websiteBody: event.target.value })} /></label>
    <label>{t('callToAction')}<input value={websiteHero.cta} onChange={(event) => onWebsiteChange({ websiteCta: event.target.value })} /></label>
    <label>{t('accentColor')}<input type="color" value={websiteTheme.accent && /^#[0-9a-f]{6}$/i.test(websiteTheme.accent) ? websiteTheme.accent : AUTHORED_WEBSITE_ACCENT} onChange={(event) => onChange({ websiteAccent: event.target.value, websiteTheme: { ...(typeof data.websiteTheme === 'object' && data.websiteTheme ? data.websiteTheme as Record<string, unknown> : {}), accent: event.target.value } })} /></label>
    <label>{t('viewport')}<select value={typeof data.viewport === 'string' ? data.viewport : 'desktop'} onChange={(event) => onWebsiteViewportChange(event.target.value as 'desktop' | 'tablet' | 'mobile')}><option value="desktop">{t('viewportDesktop')}</option><option value="tablet">{t('viewportTablet')}</option><option value="mobile">{t('viewportMobile')}</option></select></label>
    {kind === 'website' && <>
      <label>{t('subdomain')}<input value={typeof data.subdomain === 'string' ? data.subdomain : ''} placeholder={t('subdomainPlaceholder')} onChange={(event) => onChange({ subdomain: event.target.value })} /></label>
      <button type="button" className={styles.fullButton} onClick={onPublishWebsite}>{t('publishWebsite')}</button>
      {typeof data.siteUrl === 'string' && <a href={data.siteUrl} target="_blank" rel="noreferrer">{t('openPublishedSite')}</a>}
      <button type="button" className={styles.secondaryFullButton} onClick={onBuildWebsiteWithCode}>{t('build.websiteWithCode')}</button>
      <p className={styles.inspectorHint}>{t('build.websiteWithCodeHint')}</p>
    </>}
    <p className={styles.inspectorHint}>{t('websiteLiveHint')}</p>
  </>;
}

export function VideoInspectorSection({ data, onChange, onGenerateVideo }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('prompt')}<textarea rows={5} value={typeof data.prompt === 'string' ? data.prompt : ''} onChange={(event) => onChange({ prompt: event.target.value })} placeholder={t('videoPromptPlaceholder')} /></label>
    <label>{t('publishedEvermindModel')}<input value={typeof data.modelSlug === 'string' ? data.modelSlug : ''} onChange={(event) => onChange({ modelSlug: event.target.value })} placeholder={t('mediaModelPlaceholder')} /></label>
    <label>{t('frames')}<input type="number" min="1" max="64" value={typeof data.maxFrames === 'number' ? data.maxFrames : 16} onChange={(event) => onChange({ maxFrames: Math.max(1, Math.min(64, Number(event.target.value) || 16)) })} /></label>
    <button type="button" className={styles.fullButton} onClick={onGenerateVideo}>{t('generateVideo')}</button>
    {typeof data.videoUrl === 'string' && <img src={data.videoUrl} alt={t('videoFirstFrame')} width={1280} height={720} style={{ width: '100%', height: 'auto', borderRadius: 'var(--radius-lg)' }} />}
  </>;
}

export function DatasetInspectorSection({ node, data, onImportDataset, onProfileDataset, onVisualizeDataset, onPlotDataset }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('datasetImportLabel')}<input type="file" accept=".csv,.tsv,.tab,.json,.jsonl,.xlsx,.xlsm,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportDataset(file); }} /></label>
    <p className={styles.inspectorHint}>{t('datasetImportHint')}</p>
    <DatasetProfileSummary data={data} />
    <button type="button" className={styles.fullButton} onClick={() => onProfileDataset(node.id)}>{t('datasetProfileAction')}</button>
    <button type="button" className={styles.fullButton} onClick={onVisualizeDataset}>{t('datasetVisualizeAction')}</button>
    <DatasetPlotAction data={data} onPlot={onPlotDataset} />
  </>;
}

/**
 * The résumé's Details + Tools, mounted beside the card rather than on top of it. The
 * card itself now shows only the rendered document (see `CanvasResumeEditor`'s `variant`
 * prop) — everything that used to sit above that document in its own header (version,
 * privacy, template, page setup) and below it (the three AI accordions) lives here
 * instead, reached the same way every other rich kind's settings are: click the card,
 * open the inspector. `variant="inspector"` is what drops this instance's own copy of
 * the rendered document — the card behind this panel is already showing it. */
export function ResumeInspectorSection({ node, onChange, onResumeTailor, onResumeDetach, onResumeShare, onResumeSharesList, onResumeShareRevoke }: KindSectionProps) {
  return <CanvasResumeEditor
    variant="inspector"
    data={node.data}
    onEdit={onChange}
    onTailor={(prompt) => onResumeTailor(node.id, prompt)}
    onDetach={(patch) => onResumeDetach(node.id, patch)}
    shareActions={{
      create: (kind) => onResumeShare(node.id, kind),
      list: () => onResumeSharesList(node.id),
      revoke: (shareId) => onResumeShareRevoke(node.id, shareId),
    }}
  />;
}

export function WebPageInspectorSection({ data, onChange }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('webPage.addressLabel')}<input
      type="url"
      inputMode="url"
      spellCheck={false}
      value={typeof data.url === 'string' ? data.url : ''}
      placeholder={t('webPage.addressPlaceholder')}
      onChange={(event) => onChange({ url: event.target.value })}
      onBlur={(event) => { const next = normalizeWebPageUrl(event.target.value); if (next) onChange({ url: next, frameCheckedUrl: '', frameable: true, frameBlockedBy: null }); }}
    /></label>
    <label>{t('viewport')}<select value={canvasViewport(data.viewport)} onChange={(event) => onChange({ viewport: event.target.value })}>
      <option value="desktop">{t('viewportDesktop')}</option>
      <option value="tablet">{t('viewportTablet')}</option>
      <option value="mobile">{t('viewportMobile')}</option>
    </select></label>
    <button type="button" className={styles.fullButton} disabled={!canvasWebPageUrl(data)} onClick={() => onChange({ frameCheckedUrl: '' })}>{t('webPage.reread')}</button>
    <p className={styles.inspectorHint}>{t('webPage.inspectorHint')}</p>
    {data.frameable === false && <p className={styles.inspectorHint}>{t('webPage.blockedHint')}</p>}
  </>;
}

export function TaskInspectorSection({
  data, onChange, taskId, taskAgents, taskAgentValue, taskAssignees, taskCost, statusGuidance, normalizedTaskStatus,
  prdStatus, prdTitle, prdSummary, actionStatus, setActionStatus, persistTaskPatch, persistence,
}: KindSectionProps) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas');
  return <>
    <div className={styles.taskInspectorGrid}>
      <label>{t('status')}<select value={String(data.status || 'ready')} onChange={(event) => void persistTaskPatch({ status: event.target.value }, { status: event.target.value })}>
        {!['backlog', 'todo', 'ready', 'assigned', 'in_progress', 'in_review', 'blocked', 'done'].includes(String(data.status || 'ready')) && <option value={String(data.status)}>{String(data.status)}</option>}
        <option value="backlog">{t('statusBacklog')}</option><option value="todo">{t('statusTodo')}</option><option value="ready">{t('statusReady')}</option><option value="assigned">{t('statusAssigned')}</option><option value="in_progress">{t('statusInProgress')}</option><option value="in_review">{t('statusInReview')}</option><option value="blocked">{t('statusBlocked')}</option><option value="done">{t('statusDone')}</option>
      </select></label>
      <label>{t('priority')}<select value={typeof data.priority === 'string' ? data.priority : 'medium'} onChange={(event) => void persistTaskPatch({ priority: event.target.value as 'low' | 'medium' | 'high' | 'urgent' }, { priority: event.target.value })}><option value="low">{t('priorityLow')}</option><option value="medium">{t('priorityMedium')}</option><option value="high">{t('priorityHigh')}</option><option value="urgent">{t('priorityUrgent')}</option></select></label>
      {/* The scheduling triple `tasksApi.update` has always accepted — see its own note —
          plus sprint assignment. Writable through the board sync and Brain since the
          fields were added to `MUTABLE_FIELDS.task`; this is the first surface that lets
          a person set them directly. */}
      <label>{t('storyPoints')}<input type="number" min={0} step={1} value={typeof data.storyPoints === 'number' ? data.storyPoints : ''} onChange={(event) => { const value = event.target.value === '' ? null : Number(event.target.value); void persistTaskPatch({ storyPoints: value }, { storyPoints: value ?? undefined }); }} /></label>
      <label>{t('startDate')}<input type="date" value={typeof data.startDate === 'string' ? data.startDate.slice(0, 10) : ''} onChange={(event) => { const value = event.target.value || null; void persistTaskPatch({ startDate: value }, { startDate: value ?? undefined }); }} /></label>
      <label>{t('dueDate')}<input type="date" value={typeof data.dueDate === 'string' ? data.dueDate.slice(0, 10) : ''} onChange={(event) => { const value = event.target.value || null; void persistTaskPatch({ dueDate: value }, { dueDate: value ?? undefined }); }} /></label>
      <label>{t('sprintId')}<input value={typeof data.sprintId === 'string' ? data.sprintId : ''} onChange={(event) => onChange({ sprintId: event.target.value || undefined })} onBlur={(event) => void persistTaskPatch({ sprintId: event.target.value || null }, { sprintId: event.target.value || undefined })} /></label>
    </div>
    <div className={styles.statusGuidance}><b>{t('howToMoveForward')}</b><p>{statusGuidance[normalizedTaskStatus] || t('taskGuidanceFallback')}</p></div>
    <label>{t('assignedAgent')}<select
      value={typeof data.assignedUserId === 'string' && data.assignedUserId ? `user:${data.assignedUserId}` : taskAgentValue}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw.startsWith('user:')) {
          const userId = raw.slice(5);
          const human = taskAssignees.find((member) => member.id === userId);
          void persistTaskPatch(
            { assignedUserId: userId, assignedAgentRef: null, assignedAgentHostId: null },
            { agentRef: undefined, assignee: human?.name, role: undefined },
          );
          return;
        }
        const selected = taskAgents.find((agent) => (agent.data.resourceId?.replace(/^agent:/, '') || agent.id) === raw);
        const agentRef = selected?.data.resourceId?.startsWith('agent:') ? selected.data.resourceId.slice(6) : null;
        if (taskId != null && persistence === 'server' && selected && !agentRef) { setActionStatus(t('saveAgentBeforeAssign')); return; }
        void persistTaskPatch({ assignedAgentRef: agentRef, assignedAgentHostId: null, assignedUserId: null }, { agentRef: raw || undefined, assignee: selected?.data.title || undefined, role: selected?.data.title || undefined });
      }}
    >
      <option value="">{t('unassigned')}</option>
      {taskAgents.length > 0 && <optgroup label={t('assigneeGroupAgents')}>{taskAgents.map((agent) => { const value = agent.data.resourceId?.replace(/^agent:/, '') || agent.id; return <option key={agent.id} value={value}>{agent.data.title}{agent.data.model ? ` · ${String(agent.data.model)}` : ''}</option>; })}</optgroup>}
      {taskAssignees.length > 0 && <optgroup label={t('assigneeGroupPeople')}>{taskAssignees.map((member) => <option key={member.id} value={`user:${member.id}`}>{member.name}</option>)}</optgroup>}
    </select></label>
    <label>{t('description')}<textarea rows={5} value={typeof data.content === 'string' ? data.content : typeof data.subtitle === 'string' ? data.subtitle : ''} onChange={(event) => onChange({ content: event.target.value })} onBlur={(event) => { if (taskId != null && persistence === 'server') void persistTaskPatch({ description: event.target.value || null }, { content: event.target.value }); }} /></label>
    <label>{t('acceptanceCriteria')}<textarea rows={4} value={typeof data.acceptanceCriteria === 'string' ? data.acceptanceCriteria : ''} placeholder={t('acceptanceCriteriaPlaceholder')} onChange={(event) => onChange({ acceptanceCriteria: event.target.value })} /></label>
    <section className={styles.taskPrdSummary} aria-label={t('taskPrd')}>
      <div><span>{t('prd')}</span>{prdStatus && <small>{prdStatus}</small>}</div>
      {prdTitle ? <><strong>{prdTitle}</strong>{prdSummary && <p>{prdSummary.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 360)}</p>}</> : <><strong>{t('noPrdLinked')}</strong><p>{t('noPrdLinkedHint')}</p></>}
    </section>
    {taskCost && taskCost.requests > 0 && <section className={styles.taskPrdSummary} aria-label={t('costToBuild')}>
      <div><span>{t('costToBuild')}</span></div>
      <strong>{taskCost.estimatedCostUsd < 0.01 ? t('costUnderOneCent') : `$${taskCost.estimatedCostUsd.toFixed(2)}`}</strong>
      <p>{t('costRunsAndTokens', { requests: taskCost.requests, tokens: fmt.number(taskCost.totalTokens) })}</p>
    </section>}
    {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
  </>;
}

export function MockupInspectorSection({ data, onChange, mockupProjects, mockupProjectValue, mockupAgents, mockupAgentValue, onDeliverMockup }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('deliveryProject')}<select value={mockupProjectValue} onChange={(event) => { const project = mockupProjects.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ deliveryProjectRef: event.target.value, deliveryProjectName: project?.data.title || (event.target.value === 'draft:builderforce-launch' ? 'BuilderForce launch' : t('noProject')) }); }}><option value="draft:builderforce-launch">BuilderForce launch</option>{mockupProjects.filter((project) => (project.data.resourceId || project.id) !== 'draft:builderforce-launch').map((project) => <option key={project.id} value={project.data.resourceId || project.id}>{project.data.title}</option>)}<option value="">{t('noProject')}</option></select></label>
    <label>{t('assignAgent')}<select value={mockupAgentValue} onChange={(event) => { const agent = mockupAgents.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ mockupAgentRef: event.target.value, mockupAgentName: agent?.data.title || (event.target.value === 'web-analyst' ? 'Web Analyst' : t('unassigned')) }); }}><option value="campaign-strategist">Campaign Strategist</option>{mockupAgents.filter((agent) => (agent.data.resourceId || agent.id) !== 'campaign-strategist').map((agent) => <option key={agent.id} value={agent.data.resourceId || agent.id}>{agent.data.title}</option>)}<option value="web-analyst">Web Analyst</option><option value="">{t('unassigned')}</option></select></label>
    <button className={styles.fullButton} onClick={onDeliverMockup}>{t('addToProjectAssign')}</button>
  </>;
}

export function DrawingInspectorSection({ data, onChange }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('strokeColor')}<input
      type="color"
      value={canvasStrokes(data)[0]?.stroke.startsWith('#') ? canvasStrokes(data)[0]!.stroke : AUTHORED_DRAWING_STROKE}
      onChange={(event) => onChange(restyleDrawing(data, { stroke: event.target.value }))}
    /></label>
    <label>{t('strokeWidth')}<input
      type="range" min="1" max="12"
      value={canvasStrokes(data)[0]?.strokeWidth ?? 3}
      onChange={(event) => onChange(restyleDrawing(data, { strokeWidth: Number(event.target.value) }))}
    /></label>
    <p className={styles.inspectorHint}>{t('drawingHint')}</p>
  </>;
}

export function CreativeGeneratorSection({ data, onChange, onRunCreativeAction, onShipGame }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  const kind = data.kind;
  return <>
    <label>{t('creativeBrief')}<textarea rows={5} value={typeof data.prompt === 'string' ? data.prompt : typeof data.content === 'string' ? data.content : ''} onChange={(event) => onChange({ prompt: event.target.value, content: event.target.value })} placeholder={t('creativeBriefPlaceholder', { label: creationObjectDefinition(kind).label.toLowerCase() })} /></label>
    <label>{t('templateId')}<input value={typeof data.templateId === 'string' ? data.templateId : ''} onChange={(event) => onChange({ templateId: event.target.value })} placeholder={kind === 'template' ? t('browseWithBrain') : t('optionalTemplate')} /></label>
    <label>{t('outputFormat')}<select value={typeof data.outputFormat === 'string' ? data.outputFormat : ''} onChange={(event) => onChange({ outputFormat: event.target.value })}><option value="">{t('chooseOnExport')}</option>{(CREATIVE_OUTPUTS[kind] || []).map((format) => <option key={format} value={format}>{format}</option>)}</select></label>
    <section className={styles.taskPrdSummary} aria-label={t('nativeCreativeCapability')}><div><span>{t('creativeCapability')}</span><small>{typeof data.provider === 'string' ? data.provider : 'native'}</small></div><strong>{typeof data.capabilityId === 'string' ? data.capabilityId : `creative.${kind}`}</strong><p>{t('creativeCapabilityHint')}</p></section>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button type="button" className={styles.fullButton} onClick={() => onRunCreativeAction(kind === 'template' ? 'apply' : 'generate')}>{kind === 'template' ? t('applyTemplate') : t('generateLabel', { label: creationObjectDefinition(kind).label })}</button>
      {typeof data.outputUrl === 'string' && <><button type="button" onClick={() => onRunCreativeAction('preview')}>{t('preview')}</button><button type="button" onClick={() => onRunCreativeAction('export')}>{t('download')}</button></>}
      {/* A game is the one creative artifact that can be played somewhere other than here — the
          phone, an app store, Roblox. The panel behind this is where that happens; it stays out
          of the inspector because it is a flow with its own state, not another action button. */}
      {kind === 'game' && typeof data.outputUrl === 'string' && <button type="button" onClick={onShipGame}>{t('game.shipAction')}</button>}
    </div>
  </>;
}

/** Dispatch table for `custom.component` — DATA, not a `kind === 'x'` chain: adding a
 *  kind here is a row plus a section, never a new branch at the call site. The six
 *  entries that were already components (`guidedTour`… `pitch`) are adapted to the
 *  shared `KindSectionProps` shape so every entry in this table has the same call. */
export const KIND_DETAIL_SECTIONS: Record<string, (props: KindSectionProps) => JSX.Element | null> = {
  frame: ({ node, frameMembers, editable, onOpenEvermindBuild, onLoadEvermindTemplate }) => (
    <FrameFlowSection
      node={node}
      members={frameMembers}
      editable={editable}
      onOpenEvermindBuild={onOpenEvermindBuild}
      onLoadEvermindTemplate={onLoadEvermindTemplate}
    />
  ),
  flowStep: ({ node, nodes, edges, editable, onChange, onRemoveConnection }) => (
    <FlowStepInspector
      nodeId={node.id}
      data={node.data}
      nodes={nodes}
      edges={edges}
      editable={editable}
      onChange={onChange}
      {...(editable ? { onRemoveConnection } : {})}
    />
  ),
  agent: AgentInspectorSection,
  evaluation: EvaluationInspectorSection,
  release: ReleaseInspectorSection,
  website: WebsiteInspectorSection,
  video: VideoInspectorSection,
  dataset: DatasetInspectorSection,
  resume: ResumeInspectorSection,
  webPage: WebPageInspectorSection,
  task: TaskInspectorSection,
  mockup: MockupInspectorSection,
  drawing: DrawingInspectorSection,
  creative: CreativeGeneratorSection,
  guidedTour: ({ node, nodes, onChange }) => <GuidedTourInspector node={node} nodes={nodes} onChange={onChange} />,
  build: ({ node, editable, creatingBuild, persistence, onChange, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace }) => (
    <BuildInspectorSection node={node} editable={editable} creating={creatingBuild} persistence={persistence} onChange={onChange} onOpenBuild={onOpenBuild} onAttachBuild={onAttachBuild} onDeleteBuildWorkspace={onDeleteBuildWorkspace} />
  ),
  voice: ({ node, persistence, onChange }) => <CanvasVoiceInspector node={node} persistence={persistence} onChange={onChange} />,
  email: ({ data, editable, persistence, onChange }) => <CanvasEmailComposer data={data} editable={editable} persistence={persistence} onChange={onChange} />,
  evermind: ({ node, persistence, onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind }) => (
    <EvermindInspector node={node} persistence={persistence} onAttach={onAttachEvermindProject} onExpand={onExpandEvermindPipeline} onTrain={onTrainEvermind} />
  ),
  pitch: ({ node, editable, onChange }) => <PitchInspector node={node} editable={editable} onChange={onChange} />,
};
