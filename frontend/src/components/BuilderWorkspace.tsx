import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { PlanBadge } from '@/components/PlanBadge';
import { BuilderProjectsSlideOutPanel } from './builder/BuilderProjectsSlideOutPanel';
import { WorkspaceBrainColumn } from './builder/WorkspaceBrainColumn';
import { TeamChatButton } from './brain/TeamChatButton';
import { DockedBrainProvider } from '@/lib/brain/dockedBrain';
import { WorkspaceHeader } from '@/components/builder/WorkspaceHeader';
import { ProjectTitleField } from '@/components/builder/ProjectTitleField';
import { WorkspaceMoreMenu } from '@/components/builder/WorkspaceMoreMenu';
import { CenterViewSwitch } from '@/components/builder/CenterViewSwitch';
import { VoiceGenerateButton } from '@/components/builder/VoiceGenerateButton';
import { WorkspaceCenter } from '@/components/builder/WorkspaceCenter';
import { WorkspaceSidePanels } from '@/components/builder/WorkspaceSidePanels';
import { WorkspaceOverlays } from '@/components/builder/WorkspaceOverlays';
import { useBuilderWorkspace } from '@/components/builder/useBuilderWorkspace';
import { useArtifactReviews } from '@/components/builder/useArtifactReviews';
import { useWorkspaceBrainActions } from '@/components/builder/useWorkspaceBrainActions';
import { useWorkspaceBrainContext } from '@/components/builder/useWorkspaceBrainContext';
import styles from '@/components/builder/workspaceChrome.module.css';
import { serverFileStore } from '@/lib/workspace/workspaceFileStore';
import type { Project, FileEntry } from '@/lib/types';

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
 * The Builder workspace as Studio lays it out: one header row, the docked Brain, the
 * centre (a live preview that starts by itself, code, data — or a studio panel for the
 * types that are not apps), and a side panel opened on demand.
 *
 * What the workspace IS lives in `useBuilderWorkspace`, and its regions are shared with
 * the canvas App surface (`CanvasAppWorkspace`). This file owns only Studio's chrome: the
 * header, the docked Brain and the Brain's workspace tools.
 */
export function BuilderWorkspace({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId, initialPrompt, initialTicket, headerLeading, headerTrailing }: IDEProps) {
  const t = useTranslations('ide');
  const store = useMemo(() => serverFileStore(project.id), [project.id]);
  const ws = useBuilderWorkspace({ store, name: project.name, modality: project.modality, initialFiles });
  const { modalityDef, modality, modalityCopy, livePreview, narrow, narrowPane, editor, voice } = ws;
  const hasDockedBrain = modalityDef.dockBrain;
  const [projectsPanelOpen, setProjectsPanelOpen] = useState(false);

  const reviews = useArtifactReviews(project.id);
  useWorkspaceBrainActions({
    store,
    projectName: project.name,
    modality,
    targets: { activeFile: editor.activeFile, applyCodeToActiveFile: editor.applyCodeToActiveFile, createProjectFile: editor.createProjectFile, setVoiceText: voice.setText },
    review: reviews,
  });
  const brain = useWorkspaceBrainContext({
    projectId: project.id,
    modality,
    activeFile: editor.activeFile,
    activeFileContent: editor.activeFile ? (ws.fileContents[editor.activeFile] ?? '') : undefined,
    docked: hasDockedBrain,
    initialChatId,
    initialPrompt,
    initialTicket,
  });

  const showChat = hasDockedBrain && (!narrow || narrowPane === 'chat');
  const showWork = !narrow || !hasDockedBrain || narrowPane === 'work';

  const workspace = (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      <WorkspaceHeader
        leading={headerLeading}
        title={<ProjectTitleField project={project} onProjectUpdate={onProjectUpdate} />}
        typeIcon={modalityCopy.icon}
        typeLabel={modalityCopy.label}
        onOpenProjects={() => setProjectsPanelOpen(true)}
        center={livePreview || (narrow && hasDockedBrain) ? (
          <CenterViewSwitch
            views={ws.centerViews}
            value={ws.centerView}
            onChange={ws.selectView}
            chat={narrow && hasDockedBrain ? { active: narrowPane === 'chat', onSelect: () => ws.setNarrowPane('chat') } : undefined}
            workLabel={modalityCopy.label}
          />
        ) : undefined}
        actions={(
          <>
            {ws.collabConnected && (
              <span role="status" aria-label={t('workspace.collabConnected')} title={t('workspace.collabConnected')} style={{ display: 'inline-flex', padding: '0 4px' }}>
                <span className={styles.dot} />
              </span>
            )}
            {/* The plan funding this workspace's chat. It used to sit in the composer's
                last row, where "FREE · UPGRADE" read as part of the message being typed. */}
            <PlanBadge />
            <TeamChatButton projectId={project.id} />
            {/* A type with no live preview (Voice) keeps an explicit button for its one action. */}
            {modalityDef.showRunButton && !livePreview && <VoiceGenerateButton voice={voice} label={modalityCopy.runLabel} />}
            <WorkspaceMoreMenu
              tabs={ws.rightTabs}
              onOpenTab={ws.openRail}
              onOpenSettings={() => ws.setSettingsOpen(true)}
              onOpenDetails={onOpenProjectDetails}
            />
          </>
        )}
        trailing={headerTrailing}
      />

      <BuilderProjectsSlideOutPanel open={projectsPanelOpen} onClose={() => setProjectsPanelOpen(false)} currentStorageProjectId={project.id} />
      <WorkspaceOverlays ws={ws} />

      {/* Brain-tool artifact reviews (generate_prd / generate_tasks). */}
      {reviews.modals}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Docked left panel (Designer + Voice): the shared Brain, naming what it sees.
            Hidden rather than unmounted on a narrow screen, so switching to the
            preview and back never drops the conversation. */}
        {hasDockedBrain && (
          <div style={{ display: showChat ? 'contents' : 'none' }}>
            <WorkspaceBrainColumn
              projectId={project.id}
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

        <WorkspaceCenter
          ws={ws}
          hidden={!showWork || (narrow && ws.railOpen)}
          // Types that DON'T dock the agent (Evermind / Fine-tune) get a prominent
          // button that opens the AI chat scoped to this project.
          overlay={!hasDockedBrain ? (
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
          ) : undefined}
        />

        <WorkspaceSidePanels ws={ws} visible={showWork} />
      </div>
    </div>
  );

  // With the Brain docked on the left, every "open a chat" entry point (the team-chat
  // button) selects it THERE rather than opening the floating drawer as a second panel.
  return hasDockedBrain
    ? <DockedBrainProvider reveal={() => ws.setNarrowPane('chat')}>{workspace}</DockedBrainProvider>
    : workspace;
}
