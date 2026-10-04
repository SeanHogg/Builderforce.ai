import { useState, useCallback, useEffect, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { CodePane } from './CodePane';
import { FileExplorer } from './FileExplorer';
// WebGPU LoRA training — onnxruntime-web, the tokenizer and the whole training
// loop, behind ONE tab of this workspace. Statically imported it shipped to
// every builder who only ever edits files; `CreationCanvas` already defers the
// same panel. `ssr: false`: there is no server-side WebGPU.
const AITrainingPanel = dynamic(
  () => import('./AITrainingPanel').then((module) => module.AITrainingPanel),
  { ssr: false },
);
import { AgentPublishPanel } from './AgentPublishPanel';
import { SitePublishPanel } from './SitePublishPanel';
import { AgentStateViewer } from './AgentStateViewer';
import { Icon } from '@/components/ui/Icon';
import { PlanBadge } from '@/components/PlanBadge';
import { EvermindStudioPanel } from './EvermindStudioPanel';
import { FinetuneStudioPanel } from './FinetuneStudioPanel';
import { BuilderProjectsSlideOutPanel } from './builder/BuilderProjectsSlideOutPanel';
import { WorkspaceBrainColumn } from './builder/WorkspaceBrainColumn';
import { TeamChatButton } from './brain/TeamChatButton';
import { BuilderSettingsPanel } from './BuilderSettingsPanel';
import { BuilderAgentPanel } from './builder/BuilderAgentPanel';
import { MobileDevicePanel } from './builder/MobileDevicePanel';
import { useLazyShell } from '@/hooks/useLazyShell';
import { useWorkspaceCommands } from '@/lib/workspace/workspaceCommands';
import { FilesPanel } from '@/components/builder/FilesPanel';
import { WorkspaceBottomPanel } from '@/components/builder/WorkspaceBottomPanel';
import { VersionsPanel } from '@/components/builder/VersionsPanel';
import { PaneLayer } from '@/components/builder/PaneLayer';
import { DatabasePanel } from '@/components/builder/database/DatabasePanel';
import { WorkspaceHeader } from '@/components/builder/WorkspaceHeader';
import { ProjectTitleField } from '@/components/builder/ProjectTitleField';
import { WorkspaceMoreMenu } from '@/components/builder/WorkspaceMoreMenu';
import { CenterViewSwitch, centerViewsFor, type CenterView } from '@/components/builder/CenterViewSwitch';
import { PreviewPane, type PreviewFraming } from '@/components/builder/PreviewPane';
import { ChecksControl } from '@/components/builder/ChecksControl';
import { WorkspaceRail } from '@/components/builder/WorkspaceRail';
import { VoiceGenerateButton } from '@/components/builder/VoiceGenerateButton';
import { useWorkspaceLogs } from '@/components/builder/useWorkspaceLogs';
import { useWorkspaceRun } from '@/components/builder/useWorkspaceRun';
import { useWorkspaceFiles } from '@/components/builder/useWorkspaceFiles';
import { useAutoRun, hasRunnableEntry } from '@/components/builder/useAutoRun';
import { usePointAndEdit } from '@/components/builder/usePointAndEdit';
import { useArtifactReviews } from '@/components/builder/useArtifactReviews';
import { useWorkspaceBrainActions } from '@/components/builder/useWorkspaceBrainActions';
import { useWorkspaceBrainContext } from '@/components/builder/useWorkspaceBrainContext';
import styles from '@/components/builder/workspaceChrome.module.css';
import { useCollaboration } from '@/hooks/useCollaboration';
import type { Project, FileEntry, TrainingJob } from '@/lib/types';
import { getModality, hasLivePreview, type RightTab } from '@/lib/modality';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { useIsMobile } from '@/lib/useIsMobile';
import { useVoiceStudio } from '@/lib/voiceStudio';
import { VoiceOutput } from './builder/VoiceOutput';
import { VoiceConfigPanel } from './builder/VoiceConfigPanel';

/** Below this width the chat and the workspace take turns instead of sitting side by side. */
const NARROW_LAYOUT_PX = 760;

interface IDEProps {
  project: Project;
  initialFiles: FileEntry[];
  onProjectUpdate?: (project: Project) => void;
  /** Open the project details slide-out panel. */
  onOpenProjectDetails?: () => void;
  /** When opening Builder with a chat, select this project chat on load. */
  initialChatId?: number | null;
  /** One-shot prompt auto-sent into the Brain panel on load (Project 360 seed). */
  initialPrompt?: string;
  /** One-shot work item to auto-link the opened chat to (`?ticket=<kind>:<ref>`). */
  initialTicket?: { kind: string; ref: string };
  /** A host's mark, at the start of the workspace's header (Studio's brand). */
  headerLeading?: ReactNode;
  /** A host's actions, at the end of the workspace's header (Share, Publish, the account). */
  headerTrailing?: ReactNode;
}

/**
 * The Builder workspace: one header row, the docked Brain, the centre (a live
 * preview that starts by itself, code, data — or a studio panel for the types
 * that are not apps), and a side panel opened on demand.
 *
 * It composes; the work lives in hooks beside it — the run pipeline
 * (`useWorkspaceRun` + `useAutoRun`), the editor's files (`useWorkspaceFiles`),
 * point & edit, the Brain's tools and context, and the review dialogs.
 */
export function BuilderWorkspace({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId, initialPrompt, initialTicket, headerLeading, headerTrailing }: IDEProps) {
  const t = useTranslations('ide');
  // Builder is scoped to its project's type: modality is fixed at creation, not
  // switchable in-session, so it's derived (and clamped) rather than state.
  const modalityDef = getModality(project.modality);
  const modality = modalityDef.id;
  const modalityCopy = useModalityCopy()(modality);
  // Layout comes from the modality registry, not from `modality === '…'` checks.
  const hasDockedBrain = modalityDef.dockBrain;
  const livePreview = hasLivePreview(modalityDef);
  const allowedRightTabs = modalityDef.rightTabs;
  const narrow = useIsMobile(NARROW_LAYOUT_PX);
  const projectIdNum = typeof project.id === 'number' ? project.id : Number(project.id);

  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [centerView, setCenterView] = useState<CenterView>('preview');
  // Narrow screens show one pane at a time: the chat, or the workspace.
  const [narrowPane, setNarrowPane] = useState<'chat' | 'work'>('work');
  const [rightTab, setRightTab] = useState<RightTab>(() => getModality(project.modality).rightTabs[0]);
  // A live preview gets the whole width by default; the panel opens on demand
  // (and by itself for Code, which needs the file tree). Types whose centre IS a
  // panel's subject (Evermind, Fine-tune, Voice) keep it open.
  const [railOpen, setRailOpen] = useState(() => !hasLivePreview(getModality(project.modality)));
  const [completedJobs, setCompletedJobs] = useState<TrainingJob[]>([]);
  const [projectsPanelOpen, setProjectsPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mobile: the "preview on your phone" slide-out (QR of the published build).
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);

  const openRail = useCallback((tab: RightTab) => {
    if (!allowedRightTabs.includes(tab)) return;
    setRightTab(tab);
    setRailOpen(true);
    setNarrowPane('work');
  }, [allowedRightTabs]);

  const selectView = useCallback((view: CenterView) => {
    setCenterView(view);
    setNarrowPane('work');
    // Code without a file tree is a dead end, so it brings the tree with it.
    if (view === 'code' && !railOpen) openRail('files');
  }, [railOpen, openRail]);
  const showEditor = useCallback(() => selectView('code'), [selectView]);

  // When modality changes, clamp the active right-panel tab to the allowed set.
  useEffect(() => {
    if (!allowedRightTabs.includes(rightTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRightTab(allowedRightTabs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modality]);

  // A surface around the workspace (the Studio header) opening one of its panels.
  useWorkspaceCommands(project.id, (command) => {
    if (command.type === 'openSettings') setSettingsOpen(true);
    else if (command.type === 'openTab') openRail(command.tab);
  });

  const { doc: ydoc, connected: collabConnected } = useCollaboration(project.id, 'user-local');
  // Voice studio state. Always called for hook stability; only works for Voice.
  const voice = useVoiceStudio({ enabled: modality === 'voice', storageProjectId: projectIdNum });

  const logs = useWorkspaceLogs();
  const runner = useWorkspaceRun({
    projectId: projectIdNum, modality, files, setFiles, fileContents, setFileContents,
    log: logs.log, publishLog: logs.publishLog,
  });
  useAutoRun({ enabled: livePreview, files, phase: runner.phase, run: runner.run });
  const edit = usePointAndEdit({ projectId: projectIdNum, previewUrl: runner.previewUrl, writePreviewFile: runner.writePreviewFile, setFileContents });
  const editor = useWorkspaceFiles({
    projectId: projectIdNum, modality, setFiles, fileContents, setFileContents,
    previewUrl: runner.previewUrl, writePreviewFile: runner.writePreviewFile, refLog: logs.log, onOpenInEditor: showEditor,
  });
  const handleTerminalInput = useLazyShell(runner.startShell, logs.writeTerminal);

  const reviews = useArtifactReviews(projectIdNum);
  useWorkspaceBrainActions({
    projectId: projectIdNum,
    projectName: project.name,
    modality,
    targets: { activeFile: editor.activeFile, applyCodeToActiveFile: editor.applyCodeToActiveFile, createProjectFile: editor.createProjectFile, setVoiceText: voice.setText },
    review: reviews,
  });
  const brain = useWorkspaceBrainContext({
    projectId: projectIdNum,
    modality,
    activeFile: editor.activeFile,
    activeFileContent: editor.activeFile ? (fileContents[editor.activeFile] ?? '') : undefined,
    docked: hasDockedBrain,
    initialChatId,
    initialPrompt,
    initialTicket,
  });

  const codePane = (
    <CodePane
      openFiles={editor.openFiles}
      activeFile={editor.activeFile}
      fileContents={fileContents}
      onTabSelect={editor.setActiveFile}
      onTabClose={editor.closeTab}
      onChange={editor.editActiveFile}
      ydoc={ydoc}
      projectId={project.id}
    />
  );
  const framing: PreviewFraming = modalityDef.center === 'device' ? 'bezel' : modalityDef.enableMobilePreview ? 'both' : 'frame';
  const showChat = hasDockedBrain && (!narrow || narrowPane === 'chat');
  const showWork = !narrow || !hasDockedBrain || narrowPane === 'work';

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      <WorkspaceHeader
        leading={headerLeading}
        title={<ProjectTitleField project={project} onProjectUpdate={onProjectUpdate} />}
        typeIcon={modalityCopy.icon}
        typeLabel={modalityCopy.label}
        onOpenProjects={() => setProjectsPanelOpen(true)}
        center={livePreview || (narrow && hasDockedBrain) ? (
          <CenterViewSwitch
            views={livePreview ? centerViewsFor(modalityDef.publishPanel) : []}
            value={centerView}
            onChange={selectView}
            chat={narrow && hasDockedBrain ? { active: narrowPane === 'chat', onSelect: () => setNarrowPane('chat') } : undefined}
            workLabel={modalityCopy.label}
          />
        ) : undefined}
        actions={(
          <>
            {collabConnected && (
              <span role="status" aria-label={t('workspace.collabConnected')} title={t('workspace.collabConnected')} style={{ display: 'inline-flex', padding: '0 4px' }}>
                <span className={styles.dot} />
              </span>
            )}
            {/* The plan funding this workspace's chat. It used to sit in the composer's
                last row, where "FREE · UPGRADE" read as part of the message being typed. */}
            <PlanBadge />
            {Number.isFinite(projectIdNum) && <TeamChatButton projectId={projectIdNum} />}
            {/* A type with no live preview (Voice) keeps an explicit button for its one action. */}
            {modalityDef.showRunButton && !livePreview && <VoiceGenerateButton voice={voice} label={modalityCopy.runLabel} />}
            <WorkspaceMoreMenu
              tabs={allowedRightTabs}
              onOpenTab={openRail}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenDetails={onOpenProjectDetails}
            />
          </>
        )}
        trailing={headerTrailing}
      />

      <BuilderProjectsSlideOutPanel open={projectsPanelOpen} onClose={() => setProjectsPanelOpen(false)} currentStorageProjectId={projectIdNum} />
      <BuilderSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} projectId={projectIdNum} onImported={editor.refreshFiles} />

      {/* Mobile: scan-to-open-on-a-real-phone. Mounted only where the device
          simulator is, since it hands off that modality's published build. */}
      {(modalityDef.center === 'device' || modalityDef.enableMobilePreview) && Number.isFinite(projectIdNum) && (
        <MobileDevicePanel
          open={devicePanelOpen}
          onClose={() => setDevicePanelOpen(false)}
          projectId={projectIdNum}
          onGoToPublish={() => openRail('publish')}
        />
      )}

      {/* Brain-tool artifact reviews (generate_prd / generate_tasks). */}
      {reviews.modals}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Docked left panel (Designer + Voice): the shared Brain, naming what it sees.
            Hidden rather than unmounted on a narrow screen, so switching to the
            preview and back never drops the conversation. */}
        {hasDockedBrain && (
          <div style={{ display: showChat ? 'contents' : 'none' }}>
            <WorkspaceBrainColumn
              projectId={projectIdNum}
              modality={modality}
              extraSystem={brain.extraSystem}
              activeFile={editor.activeFile}
              voiceName={voice.clones.find((c) => c.id === voice.selectedCloneId)?.name}
              initialChatId={initialChatId}
              initialPrompt={initialPrompt}
              initialTicket={initialTicket}
              fill={narrow}
            />
          </div>
        )}

        {/* Centre — content depends on the project type, chrome stays consistent. */}
        <div style={{ display: showWork && !(narrow && railOpen) ? 'flex' : 'none', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
          {/* Types that DON'T dock the agent (Evermind / Fine-tune) get a prominent
              button that opens the AI chat scoped to this project. */}
          {!hasDockedBrain && (
            <button
              type="button"
              onClick={brain.openDrawer}
              title={t('askAi')}
              aria-label={t('askAi')}
              style={{
                position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 18px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: 'var(--text-on-accent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.85rem',
                boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
              }}
            >
              <Icon name="brain" size={18} />
              {t('askAi')}
            </button>
          )}
          {modalityDef.center === 'voice' ? (
            <VoiceOutput result={voice.result} audioUrl={voice.audioUrl} busy={voice.busy} unavailable={voice.unavailable} />
          ) : modalityDef.center === 'evermind' || modalityDef.center === 'finetune' ? (
            editor.activeFile ? codePane : (
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {modalityDef.center === 'evermind' ? (
                  <EvermindStudioPanel projectId={project.id} />
                ) : (
                  <FinetuneStudioPanel projectId={project.id} files={files} onGoToTab={openRail} onOpenFile={editor.openFile} />
                )}
              </div>
            )
          ) : (
            <>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
                <PaneLayer active={centerView === 'preview'} style={{ display: 'flex', flexDirection: 'column' }}>
                  <PreviewPane
                    projectId={projectIdNum}
                    url={runner.previewUrl}
                    phase={runner.phase}
                    step={runner.step}
                    runnable={hasRunnableEntry(files)}
                    onRestart={() => { void runner.run(); }}
                    edit={edit}
                    framing={framing}
                    onOpenDevicePanel={() => setDevicePanelOpen(true)}
                  />
                </PaneLayer>
                <PaneLayer active={centerView === 'code'} style={{ display: 'flex', flexDirection: 'column' }}>
                  {codePane}
                </PaneLayer>
                {/* Database — mounted only while open, so it re-reads each time it is shown */}
                {centerView === 'database' && (
                  <PaneLayer active>
                    <DatabasePanel projectId={project.id} />
                  </PaneLayer>
                )}
              </div>

              <WorkspaceBottomPanel
                projectId={project.id}
                onTerminalReady={logs.onTerminalReady}
                onTerminalInput={handleTerminalInput}
                onOutputReady={logs.onOutputReady}
                status={modalityDef.showChecks ? (
                  <ChecksControl
                    results={runner.checkResults}
                    checking={runner.isChecking}
                    disabled={runner.phase === 'starting'}
                    onCheck={() => { void runner.check(); }}
                    gate={runner.gateRunOnChecks}
                    onGateChange={runner.setGateRunOnChecks}
                  />
                ) : undefined}
              />
            </>
          )}
        </div>

        {/* Side panel: Files / Versions / Agent / Train / Publish / State */}
        <WorkspaceRail
          tabs={allowedRightTabs}
          active={rightTab}
          open={railOpen && showWork}
          fill={narrow}
          onSelect={setRightTab}
          onClose={() => setRailOpen(false)}
        >
          <PaneLayer active={rightTab === 'voice'}>
            {modality === 'voice' && <VoiceConfigPanel voice={voice} projectId={projectIdNum} />}
          </PaneLayer>
          <PaneLayer active={rightTab === 'files'}>
            <FilesPanel
              projectId={project.id}
              onOpenFile={editor.openFile}
              explorer={(
                <FileExplorer
                  files={files}
                  activeFile={editor.activeFile}
                  onFileSelect={editor.openFile}
                  onFileCreate={editor.createFile}
                  onFileDelete={editor.removeFile}
                  showHeader={false}
                />
              )}
            />
          </PaneLayer>
          {/* Always mounted where the modality has versions: the panel is also what records one per agent turn. */}
          {allowedRightTabs.includes('versions') && (
            <PaneLayer active={rightTab === 'versions'}>
              <VersionsPanel projectId={project.id} />
            </PaneLayer>
          )}
          <PaneLayer active={rightTab === 'agent'}>
            {rightTab === 'agent' && <BuilderAgentPanel projectId={project.id} />}
          </PaneLayer>
          <PaneLayer active={rightTab === 'train'}>
            <AITrainingPanel
              projectId={project.id}
              datasetsVersion={editor.datasetsRegistered}
              onLog={(msg) => logs.log.raw(`\r\n\x1b[35m[${t('runLog.trainTag')}]\x1b[0m ${msg}`)}
              onJobCompleted={(job) => setCompletedJobs(prev => {
                const exists = prev.some(j => j.id === job.id);
                return exists ? prev.map(j => j.id === job.id ? job : j) : [job, ...prev];
              })}
            />
          </PaneLayer>
          <PaneLayer active={rightTab === 'publish'} style={{ overflow: 'auto' }}>
            {modalityDef.publishPanel === 'site'
              ? <SitePublishPanel projectId={project.id} projectName={project.name} onBuild={runner.publishBuild} />
              : <AgentPublishPanel projectId={project.id} completedJobs={completedJobs} />}
          </PaneLayer>
          <PaneLayer active={rightTab === 'state'}>
            <AgentStateViewer projectId={project.id} />
          </PaneLayer>
        </WorkspaceRail>
      </div>
    </div>
  );
}
