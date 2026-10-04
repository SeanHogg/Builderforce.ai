// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { CodePane } from '@/components/CodePane';
import { EvermindStudioPanel } from '@/components/EvermindStudioPanel';
import { FinetuneStudioPanel } from '@/components/FinetuneStudioPanel';
import { ChecksControl } from './ChecksControl';
import { DatabasePanel } from './database/DatabasePanel';
import { PaneLayer } from './PaneLayer';
import { PreviewPane, type PreviewFraming } from './PreviewPane';
import { RunStatusItem } from './RunStatusItem';
import { VoiceOutput } from './VoiceOutput';
import { WorkspaceBottomPanel } from './WorkspaceBottomPanel';
import { hasRunnableEntry } from './useAutoRun';
import type { BuilderWorkspaceState } from './useBuilderWorkspace';

/**
 * The workspace's centre: the live preview, code and data for an app, or the studio
 * panel for the types that are not apps — plus the Terminal / Output / Problems panel.
 *
 * Shared by both layouts (Studio's and the canvas App surface's), so what the centre
 * shows for a project type is decided once. `overlay` is the layout's own floating
 * control, drawn over the centre (Studio's "Ask AI" for types with no docked Brain).
 */
export function WorkspaceCenter({ ws, hidden = false, overlay }: {
  ws: BuilderWorkspaceState;
  /** Hidden rather than unmounted on a narrow screen, so a running preview survives a trip to another pane. */
  hidden?: boolean;
  overlay?: ReactNode;
}) {
  const { modalityDef, editor, runner, store, storageProjectId } = ws;
  const codePane = (
    <CodePane
      openFiles={editor.openFiles}
      activeFile={editor.activeFile}
      fileContents={ws.fileContents}
      onTabSelect={editor.setActiveFile}
      onTabClose={editor.closeTab}
      onChange={editor.editActiveFile}
      ydoc={ws.ydoc}
      projectId={store.id}
    />
  );
  const framing: PreviewFraming = modalityDef.center === 'device' ? 'bezel' : modalityDef.enableMobilePreview ? 'both' : 'frame';
  // The phone hand-off is a QR of the PUBLISHED build, which only a durable project has.
  const canOpenDevicePanel = ws.durable && (modalityDef.center === 'device' || modalityDef.enableMobilePreview);

  return (
    <div style={{ display: hidden ? 'none' : 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
      {overlay}
      {modalityDef.center === 'voice' ? (
        <VoiceOutput result={ws.voice.result} audioUrl={ws.voice.audioUrl} busy={ws.voice.busy} unavailable={ws.voice.unavailable} />
      ) : modalityDef.center === 'evermind' || modalityDef.center === 'finetune' ? (
        editor.activeFile || storageProjectId === null ? codePane : (
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {modalityDef.center === 'evermind' ? (
              <EvermindStudioPanel projectId={storageProjectId} />
            ) : (
              <FinetuneStudioPanel projectId={storageProjectId} files={ws.files} onGoToTab={ws.openRail} onOpenFile={editor.openFile} />
            )}
          </div>
        )
      ) : (
        <>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            <PaneLayer active={ws.centerView === 'preview'} style={{ display: 'flex', flexDirection: 'column' }}>
              <PreviewPane
                projectId={store.id}
                projectName={ws.name}
                url={runner.previewUrl}
                phase={runner.phase}
                step={runner.step}
                runnable={hasRunnableEntry(ws.files)}
                onRestart={() => { void runner.run(); }}
                onOpenVersions={ws.rightTabs.includes('versions') ? () => ws.openRail('versions') : undefined}
                versions={ws.rightTabs.includes('versions') ? ws.versions : undefined}
                edit={ws.edit}
                framing={framing}
                onOpenDevicePanel={canOpenDevicePanel ? () => ws.setDevicePanelOpen(true) : undefined}
              />
            </PaneLayer>
            <PaneLayer active={ws.centerView === 'code'} style={{ display: 'flex', flexDirection: 'column' }}>
              {codePane}
            </PaneLayer>
            {/* Database — mounted only while open, so it re-reads each time it is shown */}
            {ws.centerView === 'database' && storageProjectId !== null && (
              <PaneLayer active>
                <DatabasePanel projectId={storageProjectId} />
              </PaneLayer>
            )}
          </div>

          <WorkspaceBottomPanel
            projectId={store.id}
            onTerminalReady={ws.logs.onTerminalReady}
            onTerminalInput={ws.handleTerminalInput}
            onOutputReady={ws.logs.onOutputReady}
            summary={<RunStatusItem phase={runner.phase} />}
            tools={modalityDef.showChecks ? (
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
  );
}
