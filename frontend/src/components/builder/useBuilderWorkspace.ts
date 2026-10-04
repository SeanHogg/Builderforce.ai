// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useLazyShell } from '@/hooks/useLazyShell';
import { useWorkspaceCommands } from '@/lib/workspace/workspaceCommands';
import { getModality, hasLivePreview, type RightTab } from '@/lib/modality';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { useIsMobile } from '@/lib/useIsMobile';
import { useVoiceStudio } from '@/lib/voiceStudio';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import type { FileEntry, TrainingJob } from '@/lib/types';
import { centerViewsFor, type CenterView } from './CenterViewSwitch';
import { useWorkspaceLogs } from './useWorkspaceLogs';
import { useWorkspaceRun } from './useWorkspaceRun';
import { useWorkspaceFiles } from './useWorkspaceFiles';
import { useAutoRun } from './useAutoRun';
import { usePointAndEdit } from './usePointAndEdit';
import { useMediaStudio } from './media/useMediaStudio';
import { useProjectVersions } from './useProjectVersions';

/** Below this width panes take turns instead of sitting side by side. */
export const NARROW_LAYOUT_PX = 760;

/**
 * The rail tabs a workspace held in this browser can serve. Versions, the agent, training,
 * publishing and state are capabilities of a durable project; offering them to a board
 * with no account would be a door that opens onto an error.
 */
// Media works in a browser-held workspace too: generated items are kept for the session.
const LOCAL_RIGHT_TABS: readonly RightTab[] = ['files', 'media'];

export interface BuilderWorkspaceSubject {
  /** Where the files live — a durable project, or this browser. */
  store: WorkspaceFileStore;
  name: string;
  modality: string | null | undefined;
  initialFiles: FileEntry[];
}

/**
 * Everything a Builder workspace IS, apart from where it is drawn: its files, its run
 * pipeline, the editor, point & edit, the terminal, the panels that are open, and which
 * of them this workspace can offer at all.
 *
 * Two layouts render it. `BuilderWorkspace` is Studio's — its own header and docked Brain.
 * `CanvasAppWorkspace` is the canvas App surface's — the canvas keeps its own chrome, so
 * the controls go into the session bar and the canvas Brain does the talking. Neither
 * layout re-derives a capability decision: it is made here, once.
 */
export function useBuilderWorkspace({ store, name, modality: requestedModality, initialFiles }: BuilderWorkspaceSubject) {
  // Modality is fixed at creation, not switchable in-session, so it's derived (and
  // clamped) rather than state. Layout comes from the registry, not `modality === '…'`.
  const modalityDef = getModality(requestedModality);
  const modality = modalityDef.id;
  const modalityCopy = useModalityCopy()(modality);
  const livePreview = hasLivePreview(modalityDef);
  /** The storage project behind a durable workspace; null for one held in this browser. */
  const storageProjectId = typeof store.id === 'number' ? store.id : null;
  const durable = storageProjectId !== null;
  const rightTabs = useMemo(
    () => (durable ? modalityDef.rightTabs : modalityDef.rightTabs.filter((tab) => LOCAL_RIGHT_TABS.includes(tab))),
    [durable, modalityDef],
  );
  const centerViews = useMemo<CenterView[]>(
    () => (!livePreview ? [] : durable ? centerViewsFor(modalityDef.publishPanel) : ['preview', 'code']),
    [durable, livePreview, modalityDef],
  );
  const narrow = useIsMobile(NARROW_LAYOUT_PX);

  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [centerView, setCenterView] = useState<CenterView>('preview');
  // Narrow screens show one pane at a time: the chat, or the workspace.
  const [narrowPane, setNarrowPane] = useState<'chat' | 'work'>('work');
  const [rightTab, setRightTab] = useState<RightTab>(() => rightTabs[0] ?? 'files');
  // A live preview gets the whole width by default; the panel opens on demand
  // (and by itself for Code, which needs the file tree). Types whose centre IS a
  // panel's subject (Evermind, Fine-tune, Voice) keep it open.
  const [railOpen, setRailOpen] = useState(() => !livePreview);
  const [completedJobs, setCompletedJobs] = useState<TrainingJob[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mobile: the "preview on your phone" slide-out (QR of the published build).
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);

  const openRail = useCallback((tab: RightTab) => {
    if (!rightTabs.includes(tab)) return;
    setRightTab(tab);
    setRailOpen(true);
    setNarrowPane('work');
  }, [rightTabs]);

  const selectView = useCallback((view: CenterView) => {
    setCenterView(view);
    setNarrowPane('work');
    // Code without a file tree is a dead end, so it brings the tree with it.
    if (view === 'code' && !railOpen) openRail('files');
  }, [railOpen, openRail]);
  const showEditor = useCallback(() => selectView('code'), [selectView]);

  // When modality changes, clamp the active right-panel tab to the allowed set.
  useEffect(() => {
    if (!rightTabs.includes(rightTab) && rightTabs[0]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRightTab(rightTabs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modality]);

  // One version per agent turn, recorded for as long as the workspace is open (the
  // Versions panel and the header's "Saved · v3" both read this one instance).
  const versions = useProjectVersions(rightTabs.includes('versions') ? storageProjectId : null);

  // Generated images and clips: the rail's Media tab, and where the agent's wait for a decision.
  const media = useMediaStudio(storageProjectId, useCallback(() => openRail('media'), [openRail]));

  // A surface around the workspace (the Studio header, the canvas session bar) opening one of its panels.
  useWorkspaceCommands(store.id, (command) => {
    if (command.type === 'openSettings') { if (durable) setSettingsOpen(true); }
    else if (command.type === 'openTab') openRail(command.tab);
  });

  // An empty room id keeps collaboration inert: a browser-held workspace has no room.
  const { doc: ydoc, connected: collabConnected } = useCollaboration(storageProjectId ?? '', 'user-local');
  // Voice studio state. Always called for hook stability; only works for Voice.
  const voice = useVoiceStudio({ enabled: modality === 'voice', storageProjectId });

  const logs = useWorkspaceLogs();
  const runner = useWorkspaceRun({
    store, modality, files, setFiles, fileContents, setFileContents,
    log: logs.log, publishLog: logs.publishLog,
  });
  useAutoRun({ enabled: livePreview, files, phase: runner.phase, run: runner.run });
  const edit = usePointAndEdit({ store, previewUrl: runner.previewUrl, writePreviewFile: runner.writePreviewFile, setFileContents });
  const editor = useWorkspaceFiles({
    store, modality, setFiles, fileContents, setFileContents,
    previewUrl: runner.previewUrl, writePreviewFile: runner.writePreviewFile, refLog: logs.log, onOpenInEditor: showEditor,
  });
  const handleTerminalInput = useLazyShell(runner.startShell, logs.writeTerminal);

  const recordCompletedJob = useCallback((job: TrainingJob) => setCompletedJobs((prev) => {
    const exists = prev.some((j) => j.id === job.id);
    return exists ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev];
  }), []);

  return {
    store,
    name,
    storageProjectId,
    durable,
    modalityDef,
    modality,
    modalityCopy,
    livePreview,
    rightTabs,
    centerViews,
    narrow,
    files,
    fileContents,
    centerView,
    selectView,
    narrowPane,
    setNarrowPane,
    rightTab,
    setRightTab,
    railOpen,
    setRailOpen,
    openRail,
    media,
    versions,
    completedJobs,
    recordCompletedJob,
    settingsOpen,
    setSettingsOpen,
    devicePanelOpen,
    setDevicePanelOpen,
    ydoc,
    collabConnected,
    voice,
    logs,
    runner,
    edit,
    editor,
    handleTerminalInput,
  };
}

export type BuilderWorkspaceState = ReturnType<typeof useBuilderWorkspace>;
