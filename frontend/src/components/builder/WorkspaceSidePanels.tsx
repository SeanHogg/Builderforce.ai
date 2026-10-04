// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { FileExplorer } from '@/components/FileExplorer';
import { AgentPublishPanel } from '@/components/AgentPublishPanel';
import { SitePublishPanel } from '@/components/SitePublishPanel';
import { AgentStateViewer } from '@/components/AgentStateViewer';
import { BuilderAgentPanel } from './BuilderAgentPanel';
import { FilesPanel } from './FilesPanel';
import { PaneLayer } from './PaneLayer';
import { VersionsPanel } from './VersionsPanel';
import { VoiceConfigPanel } from './VoiceConfigPanel';
import { WorkspaceRail } from './WorkspaceRail';
import type { BuilderWorkspaceState } from './useBuilderWorkspace';
import { MediaPanel } from './media/MediaPanel';

// WebGPU LoRA training — onnxruntime-web, the tokenizer and the whole training
// loop, behind ONE tab of this workspace. Statically imported it shipped to
// every builder who only ever edits files. `ssr: false`: there is no server-side WebGPU.
const AITrainingPanel = dynamic(
  () => import('@/components/AITrainingPanel').then((module) => module.AITrainingPanel),
  { ssr: false },
);

/**
 * The workspace's side panel — Files, Versions, Agent, Train, Publish, State — shared by
 * both layouts. Which tabs exist is the workspace's decision (`ws.rightTabs`): a durable
 * project gets its modality's set, a workspace held in this browser gets only what works
 * without an account. The durable-only panes are only ever mounted when there is a
 * project to point them at.
 */
export function WorkspaceSidePanels({ ws, visible }: {
  ws: BuilderWorkspaceState;
  /** Whether the work area is on screen at all (a narrow screen may be showing the chat). */
  visible: boolean;
}) {
  const t = useTranslations('ide');
  const { editor, storageProjectId, rightTab } = ws;
  return (
    <WorkspaceRail
      tabs={ws.rightTabs}
      active={rightTab}
      open={ws.railOpen && visible}
      fill={ws.narrow}
      onSelect={ws.setRightTab}
      onClose={() => ws.setRailOpen(false)}
    >
      <PaneLayer active={rightTab === 'voice'}>
        {ws.modality === 'voice' && storageProjectId !== null && <VoiceConfigPanel voice={ws.voice} projectId={storageProjectId} />}
      </PaneLayer>
      {ws.rightTabs.includes('media') && (
        <PaneLayer active={rightTab === 'media'}>
          <MediaPanel studio={ws.media} />
        </PaneLayer>
      )}
      <PaneLayer active={rightTab === 'files'}>
        <FilesPanel
          store={ws.store}
          onOpenFile={editor.openFile}
          explorer={(
            <FileExplorer
              files={ws.files}
              activeFile={editor.activeFile}
              onFileSelect={editor.openFile}
              onFileCreate={editor.createFile}
              onFileDelete={editor.removeFile}
              showHeader={false}
            />
          )}
        />
      </PaneLayer>
      {storageProjectId !== null && (
        <>
          {ws.rightTabs.includes('versions') && (
            <PaneLayer active={rightTab === 'versions'}>
              <VersionsPanel versions={ws.versions} />
            </PaneLayer>
          )}
          <PaneLayer active={rightTab === 'agent'}>
            {rightTab === 'agent' && <BuilderAgentPanel projectId={storageProjectId} />}
          </PaneLayer>
          <PaneLayer active={rightTab === 'train'}>
            <AITrainingPanel
              projectId={storageProjectId}
              datasetsVersion={editor.datasetsRegistered}
              onLog={(msg) => ws.logs.log.raw(`\r\n\x1b[35m[${t('runLog.trainTag')}]\x1b[0m ${msg}`)}
              onJobCompleted={ws.recordCompletedJob}
            />
          </PaneLayer>
          <PaneLayer active={rightTab === 'publish'} style={{ overflow: 'auto' }}>
            {ws.modalityDef.publishPanel === 'site'
              ? <SitePublishPanel projectId={storageProjectId} projectName={ws.name} onBuild={ws.runner.publishBuild} />
              : <AgentPublishPanel projectId={storageProjectId} completedJobs={ws.completedJobs} />}
          </PaneLayer>
          <PaneLayer active={rightTab === 'state'}>
            <AgentStateViewer projectId={storageProjectId} />
          </PaneLayer>
        </>
      )}
    </WorkspaceRail>
  );
}
