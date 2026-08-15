'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { repairScaffold } from '@/lib/scaffoldRepair';
import { FileExplorer } from './FileExplorer';
import { CodePane } from './CodePane';
import { Terminal } from './Terminal';
import { AITrainingPanel } from './AITrainingPanel';
import { AgentPublishPanel } from './AgentPublishPanel';
import { SitePublishPanel } from './SitePublishPanel';
import { AgentStateViewer } from './AgentStateViewer';
import { Icon } from '@/components/ui/Icon';
import { EvermindStudioPanel } from './EvermindStudioPanel';
import { FinetuneStudioPanel } from './FinetuneStudioPanel';
import { PreviewFrame } from './PreviewFrame';
import { BuilderProjectsSlideOutPanel } from './builder/BuilderProjectsSlideOutPanel';
import { BrainPanel } from './brain/BrainPanel';
import { TeamChatButton } from './brain/TeamChatButton';
import { BuilderSettingsPanel } from './BuilderSettingsPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { BuilderAgentPanel } from './builder/BuilderAgentPanel';
import { DevicePreview } from './builder/DevicePreview';
import { MobileDevicePanel } from './builder/MobileDevicePanel';
import { useWebContainer } from '@/hooks/useWebContainer';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useVideoVersions } from '@/hooks/useVideoVersions';
import type { Project, FileEntry, TrainingJob } from '@/lib/types';
import { saveFile, fetchFileContent, deleteFile, fetchFiles, updateProject } from '@/lib/api';
import { validateFileContentForPath, coerceFileContent } from '@/lib/fileContentGuard';
import { clearBuildFailures, previewErrorFrom, recordBuildFailure, teeOutput, withPreviewErrorReporter } from '@/lib/buildDiagnostics';
import { canvasBuildActions } from '@/lib/canvasBuildTools';
import { notifyWorkspaceFilesChanged, subscribeWorkspaceFiles } from '@/lib/workspaceFileEvents';
import {
  VISUAL_ARM_MESSAGE,
  replaceClassNameAtLine,
  replaceTextAtLine,
  visualSelectionFrom,
  withVisualEditor,
  type VisualSelection,
} from '@/lib/visualEditor';
import { isBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useRegisterBrainActions, useBrainContext, savePrd, saveTasks, type BrainAction } from '@/lib/brain';
import { PrdReviewModal, TasksReviewModal } from './ArtifactReviewModals';
import { getModality, RIGHT_TAB_LABELS, type ProjectModality, type RightTab } from '@/lib/modality';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { getStoredTenantToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/apiClient';
import { useVoiceStudio } from '@/lib/voiceStudio';
import { VoiceOutput } from './builder/VoiceOutput';
import { VoiceConfigPanel } from './builder/VoiceConfigPanel';
import { ProjectEvermindPanel } from './builder/ProjectEvermindPanel';
import { StudioPanel } from '@seanhogg/builderforce-studio-embedded';
import '@seanhogg/builderforce-studio-embedded/styles.css';

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
}

type CenterView = 'preview' | 'code';

/** Cheap, stable string hash (djb2) — used to skip npm install when package.json
 *  is unchanged since the last install in this WebContainer session. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/** A single in-WebContainer quality check (typecheck / lint / build). */
interface CheckResult {
  label: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

export function BuilderWorkspace({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId, initialPrompt, initialTicket }: IDEProps) {
  const t = useTranslations('ide');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  // Builder is scoped to its project's type: modality is fixed at creation, not
  // switchable in-session, so it's derived (and clamped) rather than state.
  const modalityDef = getModality(project.modality);
  const modality: ProjectModality = modalityDef.id;
  // Localized modality copy (label / runLabel) for the header + run button.
  const modalityCopy = useModalityCopy()(modality);
  // Layout comes from the modality registry, not from `modality === '…'` checks
  // scattered through this file — see the CenterPanel/dockBrain notes there.
  const hasDockedBrain = modalityDef.dockBrain;
  const [videoPrompt, setVideoPrompt] = useState('');
  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [centerView, setCenterView] = useState<CenterView>('preview');
  // For the combined Web + Mobile type: which preview to render in the code-preview
  // centre — full-width web, or the phone bezel. (Pure `device` modalities are
  // always the bezel and don't show this toggle.)
  const [previewDevice, setPreviewDevice] = useState<'web' | 'mobile'>('web');
  const [rightTab, setRightTab] = useState<RightTab>(() => getModality(project.modality).rightTabs[0]);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  // Point-and-edit. `previewFrameRef` is how the host reaches the overlay injected
  // into the preview document — it is cross-origin, so postMessage is the channel.
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [visualArmed, setVisualArmed] = useState(false);
  const [visualSelection, setVisualSelection] = useState<VisualSelection | null>(null);
  const [visualDraft, setVisualDraft] = useState<{ text: string; className: string }>({ text: '', className: '' });
  const [visualError, setVisualError] = useState<string | null>(null);
  const [terminalWriter, setTerminalWriter] = useState<((data: string) => void) | undefined>();
  const [shellWriter, setShellWriter] = useState<WritableStreamDefaultWriter<string> | undefined>();
  const [isRunning, setIsRunning] = useState(false);
  const [completedJobs, setCompletedJobs] = useState<TrainingJob[]>([]);
  const [projectTitle, setProjectTitle] = useState(project.name);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [projectsPanelOpen, setProjectsPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mobile: the "preview on your phone" slide-out (QR of the published build).
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null);
  // When on, a Run is hard-gated on the last check pass — "code must be good
  // before it runs". When off, failed checks only warn (confirm) before serving.
  const [gateRunOnChecks, setGateRunOnChecks] = useState(true);
  // Pending Brain-tool artifact reviews. The `generate_prd`/`generate_tasks`
  // tools surface the generated artifact here and await the user's confirm/cancel
  // (parity with the message-action button path), so nothing saves unreviewed.
  const [prdReview, setPrdReview] = useState<{ prd: string; resolve: (saved: boolean) => void } | null>(null);
  const [tasksReview, setTasksReview] = useState<
    { titles: string[]; descriptions: string[]; resolve: (saved: boolean) => void } | null
  >(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const shellStartedRef = useRef(false);
  const terminalWriteRef = useRef<((data: string) => void) | null>(null);
  // package.json hash of the last successful npm install in this WC session, so
  // Run/Check/Build can skip a redundant install when dependencies are unchanged.
  const lastInstallHashRef = useRef<string | null>(null);

  // Keep title in sync when project prop changes (e.g. after save elsewhere)
  useEffect(() => {
    setProjectTitle(project.name);
  }, [project.name]);

  // When modality changes, clamp the active right-panel tab to the allowed set.
  const allowedRightTabs = modalityDef.rightTabs;
  useEffect(() => {
    if (!allowedRightTabs.includes(rightTab)) {
      setRightTab(allowedRightTabs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modality]);

  const { state: wcState, mountFiles, runCommand, runCommandAndWait, readDirRecursive, writeFileToContainer, startShell, startDevServer, getOrBootWebContainer } = useWebContainer();
  const { doc: ydoc, connected: collabConnected } = useCollaboration(project.id, 'user-local');
  // Video versions: hook owns the IDB-blob + project-file-sidecar persistence
  // triad, so this component just hands the three values straight to <StudioPanel>.
  const videoVersions = useVideoVersions(project.id, files);
  const projectIdNum = typeof project.id === 'number' ? project.id : Number(project.id);
  // Voice studio state (clones, selected voice, lines, generation). Always called
  // for hook stability but only does work for Voice projects; the green Run button
  // calls voice.synth() and the center/right panels render its state.
  const voice = useVoiceStudio({ enabled: modality === 'voice', storageProjectId: projectIdNum });

  // Boot WebContainer and spawn an interactive shell immediately on Builder load.
  // This makes the terminal live from the moment Builder opens, not just after clicking Run.
  useEffect(() => {
    if (shellStartedRef.current) return;
    shellStartedRef.current = true;

    const initShell = async () => {
      try {
        await getOrBootWebContainer();
        // Pipe shell output to terminal via ref so it works whether Terminal has mounted yet or not
        let attempts = 0;
        const trySpawn = async () => {
          const writer = await startShell((data) => {
            terminalWriteRef.current?.(data);
          });
          setShellWriter(writer);
        };
        const waitAndSpawn = () => {
          attempts++;
          trySpawn().catch((e) => {
            if (attempts < 5) setTimeout(waitAndSpawn, 500);
            else console.warn('Shell spawn failed:', e);
          });
        };
        setTimeout(waitAndSpawn, 300);
      } catch (e) {
        console.warn('WebContainer boot failed (may not be supported in this browser):', e);
      }
    };

    initShell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When Terminal mounts, store its write function in a ref so the single shell's output reaches it
  const handleTerminalReady = useCallback((write: (data: string) => void) => {
    terminalWriteRef.current = write;
    setTerminalWriter(() => write);
  }, []);

  const openFile = useCallback(async (path: string) => {
    setCenterView('code');
    if (fileContents[path] !== undefined) {
      setActiveFile(path);
      if (!openFiles.includes(path)) {
        setOpenFiles(prev => [...prev, path]);
      }
      return;
    }
    try {
      const content = await fetchFileContent(project.id, path);
      setFileContents(prev => ({ ...prev, [path]: content }));
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      setActiveFile(path);
    } catch (e) {
      // Do NOT cache '' on failure: that poisons fileContents so the cached
      // branch above short-circuits every future open and the file shows blank
      // forever. Leave the path uncached so the next click re-fetches; still
      // open the tab so the user sees something happened.
      console.error(`Failed to load ${path}:`, e);
      terminalWriteRef.current?.(`\r\n\x1b[31m✗ Failed to load ${path} — click again to retry.\x1b[0m\r\n`);
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      setActiveFile(path);
    }
  }, [openFiles, fileContents, project.id]);

  const closeTab = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f !== path);
      if (activeFile === path) {
        setActiveFile(next[next.length - 1]);
      }
      return next;
    });
  }, [activeFile]);

  const handleEditorChange = useCallback(async (value: string) => {
    if (!activeFile) return;
    // Always reflect the keystroke locally (never lose typing).
    setFileContents(prev => ({ ...prev, [activeFile]: value }));
    // But NEVER PERSIST structurally-invalid content to disk/container — the same
    // guard apply_code_to_active_file uses. This is the editor onChange path that
    // previously had no guard, so a cross-wired/agent write of the wrong file's
    // content (e.g. HTML landing in the package.json model) was saved straight to
    // disk and broke Run with "Invalid package.json" [1315]. A human mid-typing an
    // invalid JSON state just defers the save until it parses again.
    if (!validateFileContentForPath(activeFile, value).ok) return;
    // Live reload: when a dev server is running, push the edit straight into the
    // container FS so Vite HMR refreshes the preview without a full re-run.
    if (previewUrl) writeFileToContainer(activeFile, value).catch(() => { /* best-effort */ });
    try {
      await saveFile(project.id, activeFile, value);
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }, [activeFile, project.id, previewUrl, writeFileToContainer]);

  const handleFileCreate = useCallback(async (path: string) => {
    try {
      await saveFile(project.id, path, '');
      setFiles(prev => [...prev, { path, content: '', type: 'file' }]);
      setFileContents(prev => ({ ...prev, [path]: '' }));
      openFile(path);
    } catch (e) {
      console.error('Failed to create file:', e);
    }
  }, [project.id, openFile]);

  const handleFileDelete = useCallback(async (path: string) => {
    try {
      await deleteFile(project.id, path);
      setFiles(prev => prev.filter(f => f.path !== path));
      closeTab(path);
    } catch (e) {
      console.error('Failed to delete file:', e);
    }
  }, [project.id, closeTab]);

  /**
   * Assemble the path→content map to mount into the WebContainer: the project's
   * current contents (fetching any not yet loaded into state) plus the starter
   * scaffold for any missing/empty required file. Returns null if a present
   * package.json is invalid JSON. Shared by Run, Check and the publish build so
   * the gather/defaults/validate logic lives in exactly one place.
   *
   * A scaffold file that has to be substituted is also SAVED back to the project.
   * These used to be run-only, which meant a workspace the server never seeded
   * ran fine but opened blank in the editor — every file 0 bytes, nothing to edit,
   * and the substitution repeated on every Run forever. Writing them makes the
   * repair stick and is safe by the same rule the server seeds by: only a path
   * with NO content is ever written, so real work is never overwritten.
   */
  const assembleMountContents = useCallback(async (
    onLog?: (s: string) => void,
  ): Promise<Record<string, string> | null> => {
    const allContents: Record<string, string> = { ...fileContents };
    const unfetched = files.filter(f => f.type === 'file' && !(f.path in allContents));
    if (unfetched.length > 0) {
      const fetched: Record<string, string> = {};
      await Promise.all(unfetched.map(async (f) => {
        try {
          const content = await fetchFileContent(project.id, f.path);
          allContents[f.path] = content;
          fetched[f.path] = content;
        } catch (error) {
          onLog?.(`  \x1b[31m✗\x1b[0m ${f.path} - Failed to fetch\r\n`);
          console.error(`Failed to fetch ${f.path}:`, error);
        }
      }));
      // Persist only real project data (never the run-only defaults below).
      if (Object.keys(fetched).length > 0) {
        setFileContents(prev => ({ ...prev, ...fetched }));
        setFiles(prev => {
          const have = new Set(prev.map(f => f.path));
          const add = Object.keys(fetched)
            .filter(p => !have.has(p))
            .map(path => ({ path, content: fetched[path], type: 'file' as const }));
          return add.length > 0 ? [...prev, ...add] : prev;
        });
      }
    }

    // Repair the scaffold: fill empty files AND replace structurally cross-wired
    // ones (another file's content written to this path — package.json's JSON in
    // vite.config.js, source text in index.html, …). Shared pure helper so Run,
    // Check and the publish build agree and the logic is unit-tested.
    const { repaired: mount, restored } = repairScaffold(allContents, modality);
    if (restored.length > 0) {
      for (const { path, reason } of restored) {
        onLog?.(
          reason === 'corrupt'
            ? `  \x1b[33m⚠\x1b[0m ${path} was corrupt — restored from the starter template\r\n`
            : `  \x1b[33m⚠\x1b[0m ${path} was empty — restored from the starter template\r\n`,
        );
      }
      const restoredMap = Object.fromEntries(restored.map(({ path }) => [path, mount[path]!]));
      setFileContents(prev => ({ ...prev, ...restoredMap }));
      setFiles(prev => {
        const have = new Set(prev.map(f => f.path));
        const add = Object.keys(restoredMap)
          .filter(p => !have.has(p))
          .map(path => ({ path, content: restoredMap[path]!, type: 'file' as const }));
        return add.length > 0 ? [...prev, ...add] : prev;
      });
      // Best-effort: a save failure (offline, 503) must never block the run —
      // the mount already has the content either way.
      await Promise.all(
        Object.entries(restoredMap).map(([path, content]) =>
          saveFile(project.id, path, content).catch((e) => console.error(`Failed to restore ${path}:`, e)),
        ),
      );
    }
    if (mount['package.json']) {
      try {
        JSON.parse(mount['package.json']);
      } catch (e) {
        onLog?.('\r\n\x1b[31m✗ Invalid package.json\x1b[0m\r\n');
        return null;
      }
    }
    return mount;
  }, [fileContents, files, project.id, modality]);

  /**
   * Run `npm install` only when package.json changed since the last install in
   * this WebContainer session (the singleton container keeps node_modules across
   * runs). Returns the install exit code (0 when skipped). Cuts the dominant cost
   * of every Run/Check after the first.
   */
  const ensureInstalled = useCallback(async (
    mount: Record<string, string>,
    onOutput?: (data: string) => void,
  ): Promise<number> => {
    if (!mount['package.json']) return 0;
    const hash = hashString(mount['package.json']);
    if (lastInstallHashRef.current === hash) {
      onOutput?.('  \x1b[32m✓\x1b[0m Dependencies unchanged — skipping npm install.\r\n');
      return 0;
    }
    const code = await runCommandAndWait('npm', ['install'], onOutput);
    if (code === 0) lastInstallHashRef.current = hash;
    return code;
  }, [runCommandAndWait]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    // Gate on the last check result so a known-broken build isn't served as a
    // preview. Hard-gate when enabled; otherwise warn and let the user override.
    const failedChecks = checkResults?.filter((r) => r.status === 'fail') ?? [];
    if (failedChecks.length > 0) {
      const summary = failedChecks.map((r) => r.label).join(', ');
      if (gateRunOnChecks) {
        terminalWriter?.('\r\n\x1b[31m✗ Run blocked — last checks failed: ' + summary + '\x1b[0m\r\n');
        terminalWriter?.('\x1b[33m  Fix the issues and re-run Check, or turn off "Gate Run on checks" to override.\x1b[0m\r\n');
        return;
      }
      if (typeof window !== 'undefined' &&
        !(await confirm({ message: tc('servePreviewAnywayConfirm', { summary }), destructive: false }))) {
        return;
      }
    }
    setIsRunning(true);
    // A new run is judged on its own output: clear the previous attempt's failures
    // so a repair turn is never handed an error the user has already fixed. A run
    // that fails the same way immediately re-records it.
    clearBuildFailures(projectIdNum);
    try {
      terminalWriter?.('\r\n\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
      terminalWriter?.('\x1b[36m▶ Run started\x1b[0m\r\n');
      terminalWriter?.('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n\r\n');

      terminalWriter?.('\x1b[36m[1/3] Preparing project files...\x1b[0m\r\n');
      const mountContents = await assembleMountContents((s) => terminalWriter?.(s));
      if (!mountContents) {
        throw new Error('Invalid package.json: please fix it in the Files tab.');
      }
      terminalWriter?.('  \x1b[32m✓\x1b[0m Project files ready.\r\n\r\n');

      terminalWriter?.('\x1b[36m[2/3] Mounting project files...\x1b[0m\r\n');
      // Both overlays go into the MOUNTED copy only — never the files on disk and
      // never the publish path — so a runtime error inside the preview reaches the
      // agent, and any element in it can be pointed at, while the user's source and
      // their published build stay exactly what they wrote.
      await mountFiles(withVisualEditor(withPreviewErrorReporter(mountContents)));
      terminalWriter?.(`  \x1b[32m✓\x1b[0m Mounted ${Object.keys(mountContents).length} file(s).\r\n\r\n`);

      terminalWriter?.('\x1b[36m[3/3] Installing dependencies...\x1b[0m\r\n');
      // Tee the install output: the terminal shows it to a human, the tail is what
      // an agent needs to know WHY it failed. Before this, only the exit code
      // survived and the cause stayed in pixels.
      const installLog = teeOutput((data) => terminalWriter?.(data));
      const installCode = await ensureInstalled(mountContents, installLog.write);
      if (installCode !== 0) {
        terminalWriter?.('\r\n\x1b[31m✗ npm install failed (exit code ' + installCode + '). Fix errors above and try again.\x1b[0m\r\n');
        recordBuildFailure(projectIdNum, {
          source: 'build',
          command: 'npm install',
          exitCode: installCode,
          message: `npm install failed (exit ${installCode}).`,
          detail: installLog.text(),
        });
        return;
      }
      terminalWriter?.('\r\n  \x1b[32m✓\x1b[0m Dependencies ready.\r\n\r\n');

      terminalWriter?.('\x1b[36mStarting dev server...\x1b[0m\r\n');
      const url = await startDevServer((data) => terminalWriter?.(data));
      terminalWriter?.(`\r\n  \x1b[32m✓\x1b[0m Dev server ready at \x1b[33m${url}\x1b[0m\r\n`);
      terminalWriter?.('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n\r\n');
      setPreviewUrl(url);
      setCenterView('preview');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('Run failed:', e);
      // Recorded BEFORE the terminal formatting below, so the agent's copy is the
      // raw message rather than whichever branch happened to render it.
      recordBuildFailure(projectIdNum, {
        source: 'build',
        command: 'npm run dev',
        message: errorMsg.split('\n')[0] || 'The dev server failed to start.',
        detail: errorMsg,
      });

      // Always surface the error in the terminal so the user sees it
      if (errorMsg.includes('EJSONPARSE') || errorMsg.includes('Invalid package.json')) {
        terminalWriter?.('\r\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
        terminalWriter?.('\x1b[31m✗ PACKAGE.JSON ERROR\x1b[0m\r\n');
        terminalWriter?.('\r\n\x1b[33mYour package.json file is invalid or empty.\x1b[0m\r\n');
        terminalWriter?.('\x1b[33mPlease check the Files tab and ensure package.json contains valid JSON.\x1b[0m\r\n');
        terminalWriter?.('\r\n\x1b[36mExpected format:\x1b[0m\r\n');
        terminalWriter?.('{\r\n');
        terminalWriter?.('  "name": "my-app",\r\n');
        terminalWriter?.('  "version": "1.0.0",\r\n');
        terminalWriter?.('  "scripts": { "dev": "vite" },\r\n');
        terminalWriter?.('  "dependencies": { ... }\r\n');
        terminalWriter?.('}\r\n');
        terminalWriter?.('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
      } else if (errorMsg.includes('output:')) {
        const outputMatch = errorMsg.match(/output:\n([\s\S]+)/);
        if (outputMatch) {
          terminalWriter?.('\r\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
          terminalWriter?.('\x1b[31m✗ DEV SERVER ERROR\x1b[0m\r\n\r\n');
          terminalWriter?.(outputMatch[1]);
          terminalWriter?.('\r\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
        } else {
          terminalWriter?.(`\r\n\x1b[31m✗ Error: ${errorMsg}\x1b[0m\r\n`);
        }
      } else {
        terminalWriter?.(`\r\n\x1b[31m✗ Error: ${errorMsg}\x1b[0m\r\n`);
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, startDevServer, mountFiles, assembleMountContents, ensureInstalled, terminalWriter, checkResults, gateRunOnChecks, confirm, tc, projectIdNum]);

  /**
   * Build the project in the WebContainer and capture its `dist/` output for
   * publishing. Mirrors handleRun's mount + install, then runs `npm run build`
   * (instead of the dev server) and reads the build directory back out. Shared
   * singleton container, so this reuses any already-installed deps.
   */
  const handlePublishBuild = useCallback(async (): Promise<Array<{ path: string; data: Uint8Array }>> => {
    terminalWriter?.('\r\n\x1b[36m━━━ Building for publish ━━━\x1b[0m\r\n');

    const mount = await assembleMountContents((s) => terminalWriter?.(s));
    if (!mount) throw new Error('Invalid package.json: please fix it in the Files tab.');

    await mountFiles(mount);
    terminalWriter?.('\x1b[36mnpm install…\x1b[0m\r\n');
    const installCode = await ensureInstalled(mount, (d) => terminalWriter?.(d));
    if (installCode !== 0) throw new Error(`npm install failed (exit ${installCode}).`);
    // Force a RELATIVE asset base (`--base=./`). Vite defaults to `base: '/'`,
    // which emits root-absolute asset URLs (`/assets/...`). Those only resolve
    // when the site is served from the domain root, so they 404 under the path
    // form `/api/sites/<sub>/` (the "preview" + pre-TLS fallback). Relative URLs
    // resolve correctly BOTH at `<sub>.apps.builderforce.ai/` and under the path
    // prefix. The flag overrides whatever the project's vite config sets.
    terminalWriter?.('\r\n\x1b[36mnpm run build…\x1b[0m\r\n');
    const buildCode = await runCommandAndWait('npm', ['run', 'build', '--', '--base=./'], (d) => terminalWriter?.(d));
    if (buildCode !== 0) throw new Error(`Build failed (exit ${buildCode}). Check the build output above.`);

    const assets = await readDirRecursive('dist');
    if (assets.length === 0) {
      throw new Error('Build produced no dist/ output. Ensure your build script outputs to "dist".');
    }
    terminalWriter?.(`\r\n  \x1b[32m✓\x1b[0m Captured ${assets.length} built file(s).\r\n`);
    return assets;
  }, [assembleMountContents, ensureInstalled, mountFiles, runCommandAndWait, readDirRecursive, terminalWriter]);

  /**
   * Run the project's quality checks inside the WebContainer — real, in-browser
   * validation of the code Builder/the agent produced. Mounts + installs (reusing the
   * install cache), then runs type-check, lint and build from the project's own
   * package.json scripts (skipping any it doesn't define). Surfaces a pass/fail
   * summary the Run button reads to warn before serving a broken preview.
   */
  const handleCheck = useCallback(async () => {
    if (isChecking || isRunning) return;
    setIsChecking(true);
    setCheckResults(null);
    try {
      terminalWriter?.('\r\n\x1b[36m━━━ Running checks ━━━\x1b[0m\r\n');
      const mount = await assembleMountContents((s) => terminalWriter?.(s));
      if (!mount) {
        setCheckResults([{ label: 'package.json', status: 'fail', detail: 'Invalid JSON' }]);
        return;
      }
      let scripts: Record<string, string> = {};
      let hasTypescript = false;
      try {
        const pkg = JSON.parse(mount['package.json'] ?? '{}') as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        scripts = pkg.scripts ?? {};
        hasTypescript = !!(pkg.dependencies?.typescript || pkg.devDependencies?.typescript);
      } catch { /* validated above */ }

      // When we'll fall back to `npx tsc --noEmit` (TS present, no project
      // typecheck script) and the project ships no tsconfig.json, synthesize a
      // minimal one into the WebContainer so tsc doesn't bail with "no inputs"/
      // default-config noise. Mounted only in the WC — never persisted to the project.
      const willUseTscFallback = hasTypescript && !scripts['typecheck'];
      if (willUseTscFallback && !mount['tsconfig.json']) {
        mount['tsconfig.json'] = JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2020',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'react-jsx',
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              skipLibCheck: true,
              allowJs: true,
              resolveJsonModule: true,
              isolatedModules: true,
            },
            include: ['**/*.ts', '**/*.tsx'],
          },
          null,
          2,
        );
        terminalWriter?.('\x1b[2m  (synthesized a minimal tsconfig.json for the type-check fallback)\x1b[0m\r\n');
      }

      await mountFiles(mount);
      const installLog = teeOutput((d) => terminalWriter?.(d));
      const installCode = await ensureInstalled(mount, installLog.write);
      if (installCode !== 0) {
        setCheckResults([{ label: 'npm install', status: 'fail', detail: `exit ${installCode}` }]);
        recordBuildFailure(projectIdNum, {
          source: 'build', command: 'npm install', exitCode: installCode,
          message: `npm install failed (exit ${installCode}).`, detail: installLog.text(),
        });
        return;
      }

      // Each check: prefer the project's own script; fall back to a sensible
      // default only when the toolchain is clearly present.
      const plan: Array<{ label: string; cmd: [string, string[]] | null }> = [
        {
          label: 'type-check',
          cmd: scripts['typecheck']
            ? ['npm', ['run', 'typecheck']]
            : hasTypescript
              ? ['npx', ['tsc', '--noEmit']]
              : null,
        },
        { label: 'lint', cmd: scripts['lint'] ? ['npm', ['run', 'lint']] : null },
        { label: 'build', cmd: scripts['build'] ? ['npm', ['run', 'build']] : null },
      ];

      const results: CheckResult[] = [];
      for (const step of plan) {
        if (!step.cmd) {
          results.push({ label: step.label, status: 'skip', detail: 'no script' });
          continue;
        }
        terminalWriter?.(`\r\n\x1b[36m▶ ${step.label}…\x1b[0m\r\n`);
        const stepLog = teeOutput((d) => terminalWriter?.(d));
        const code = await runCommandAndWait(step.cmd[0], step.cmd[1], stepLog.write);
        results.push({ label: step.label, status: code === 0 ? 'pass' : 'fail', detail: code === 0 ? undefined : `exit ${code}` });
        if (code !== 0) {
          // A failed type-check or build is the single most repairable thing this
          // workspace produces, and its output was previously terminal-only.
          recordBuildFailure(projectIdNum, {
            source: 'build',
            command: `${step.cmd[0]} ${step.cmd[1].join(' ')}`,
            exitCode: code,
            message: `${step.label} failed (exit ${code}).`,
            detail: stepLog.text(),
          });
        }
      }
      setCheckResults(results);
      const failed = results.filter(r => r.status === 'fail').length;
      terminalWriter?.(
        failed === 0
          ? '\r\n\x1b[32m✓ All checks passed.\x1b[0m\r\n'
          : `\r\n\x1b[31m✗ ${failed} check(s) failed.\x1b[0m\r\n`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      terminalWriter?.(`\r\n\x1b[31m✗ Check error: ${msg}\x1b[0m\r\n`);
      setCheckResults([{ label: 'checks', status: 'fail', detail: msg }]);
      recordBuildFailure(projectIdNum, { source: 'build', message: msg.split('\n')[0] || 'Checks failed.', detail: msg });
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, isRunning, assembleMountContents, ensureInstalled, mountFiles, runCommandAndWait, terminalWriter, projectIdNum]);

  const handleTerminalInput = useCallback((data: string) => {
    shellWriter?.write(data);
  }, [shellWriter]);

  // Refresh file list after create/delete
  const refreshFiles = useCallback(async () => {
    try {
      const updated = await fetchFiles(project.id);
      setFiles(updated);
    } catch { /* silent */ }
  }, [project.id]);

  /**
   * Runtime errors thrown INSIDE the preview, reported by the shim injected into
   * the mounted `index.html`. Without this an app that compiles and then throws
   * left a blank frame and no signal the agent could read.
   *
   * `event.source` is deliberately not checked against the preview iframe: the
   * dev server is a cross-origin document whose `contentWindow` this frame cannot
   * compare, so the message TYPE plus the shape check in `previewErrorFrom` is
   * the identification. Both are namespaced, and the payload is only ever read as
   * three strings, so a hostile sender's best case is a spurious diagnostic line.
   */
  useEffect(() => {
    if (!previewUrl) return;
    const onMessage = (event: MessageEvent) => {
      const failure = previewErrorFrom(event.data);
      if (failure) { recordBuildFailure(projectIdNum, failure); return; }
      // The other half of the preview conversation: an element the user pointed at.
      const selected = visualSelectionFrom(event.data);
      if (selected) { setVisualSelection(selected); setVisualDraft({ text: selected.text ?? '', className: selected.className }); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [previewUrl, projectIdNum]);

  /**
   * Point-and-edit: change what you can see without spending a model turn.
   *
   * The overlay is injected into the mounted preview (see `lib/visualEditor.ts`);
   * this is the host half — arming it, holding the selection, and applying the two
   * edits that are safe to make without a model checking them.
   */
  const armVisual = useCallback((armed: boolean) => {
    setVisualArmed(armed);
    if (!armed) setVisualSelection(null);
    previewFrameRef.current?.contentWindow?.postMessage({ type: VISUAL_ARM_MESSAGE, armed }, '*');
  }, []);

  // Re-arm after a reload: the overlay is a fresh script in a fresh document and
  // has no memory of having been armed before the dev server restarted it.
  useEffect(() => {
    if (!visualArmed || !previewUrl) return;
    const id = window.setTimeout(
      () => previewFrameRef.current?.contentWindow?.postMessage({ type: VISUAL_ARM_MESSAGE, armed: true }, '*'),
      400,
    );
    return () => window.clearTimeout(id);
  }, [visualArmed, previewUrl]);

  const applyVisualEdit = useCallback(async () => {
    const selection = visualSelection;
    if (!selection) return;
    setVisualError(null);
    try {
      let content = await fetchFileContent(project.id, selection.file);
      if (selection.text !== null && visualDraft.text !== selection.text) {
        const edited = replaceTextAtLine(content, selection.line, selection.text, visualDraft.text);
        if (!edited.ok) { setVisualError(edited.reason); return; }
        content = edited.content;
      }
      if (visualDraft.className !== selection.className) {
        const edited = replaceClassNameAtLine(content, selection.line, visualDraft.className);
        if (!edited.ok) { setVisualError(edited.reason); return; }
        content = edited.content;
      }
      const valid = validateFileContentForPath(selection.file, content);
      if (!valid.ok) { setVisualError(valid.reason); return; }
      await saveFile(project.id, selection.file, content);
      setFileContents((prev) => ({ ...prev, [selection.file]: content }));
      if (previewUrl) await writeFileToContainer(selection.file, content).catch(() => { /* best-effort */ });
      setVisualSelection(null);
    } catch (error) {
      setVisualError(error instanceof Error ? error.message : t('visualNoPreview'));
    }
  }, [project.id, previewUrl, t, visualDraft, visualSelection, writeFileToContainer]);

  /**
   * A file this workspace has open was written from the BOARD.
   *
   * The canvas build tools write over the API whether or not this panel is
   * mounted, so without this the editor would keep showing the pre-edit buffer
   * over post-edit content — and the next manual save would write the stale text
   * back over the agent's work. Re-reads the changed file, refreshes the tree, and
   * pushes it into the running dev server so the preview updates too.
   */
  useEffect(() => subscribeWorkspaceFiles((storageProjectId, paths) => {
    if (storageProjectId !== projectIdNum) return;
    void refreshFiles();
    for (const path of paths) {
      void fetchFileContent(project.id, path)
        .then((content) => {
          setFileContents((prev) => (prev[path] === content ? prev : { ...prev, [path]: content }));
          if (previewUrl) void writeFileToContainer(path, content).catch(() => { /* best-effort */ });
        })
        .catch(() => { /* the file may have been deleted between write and read */ });
    }
  }), [projectIdNum, project.id, previewUrl, refreshFiles, writeFileToContainer]);

  // --- Brain integration ----------------------------------------------------
  // Builder's AI lives in the global Brain drawer. Builder exposes its
  // capabilities as MCP-style actions the Brain can call via tool-calling, and
  // publishes ambient context (project, modality, open file) the Brain reads.
  const brainCtx = useBrainContext();

  const applyCodeToActiveFile = useCallback((code: string): { ok: true } | { ok: false; reason: string } => {
    if (!activeFile) return { ok: false, reason: 'No file is open in the editor.' };
    // Block structurally-invalid writes (e.g. CSS into package.json) before they
    // corrupt the file and break Run [1315].
    const valid = validateFileContentForPath(activeFile, code);
    if (!valid.ok) { console.error(valid.reason); return valid; }
    setFileContents(prev => ({ ...prev, [activeFile]: code }));
    if (previewUrl) writeFileToContainer(activeFile, code).catch(() => { /* best-effort */ });
    saveFile(project.id, activeFile, code).catch(console.error);
    return { ok: true };
  }, [activeFile, project.id, previewUrl, writeFileToContainer]);

  const createProjectFile = useCallback((path: string, content: string): { ok: true } | { ok: false; reason: string } => {
    const valid = validateFileContentForPath(path, content);
    if (!valid.ok) { console.error(valid.reason); return valid; }
    setFileContents(prev => ({ ...prev, [path]: content }));
    if (previewUrl) writeFileToContainer(path, content).catch(() => { /* best-effort */ });
    saveFile(project.id, path, content)
      .then(() => {
        refreshFiles();
        if (!openFiles.includes(path)) {
          setOpenFiles(prev => [...prev, path]);
          setActiveFile(path);
        }
      })
      .catch(console.error);
    return { ok: true };
  }, [project.id, refreshFiles, openFiles, previewUrl, writeFileToContainer]);

  // Latest Builder state for action handlers, so the registered action array stays
  // stable (no re-registration churn) while `run()` reads current values.
  const liveRef = useRef({ activeFile, modality, applyCodeToActiveFile, createProjectFile, projectIdNum, setVoiceText: voice.setText });
  liveRef.current = { activeFile, modality, applyCodeToActiveFile, createProjectFile, projectIdNum, setVoiceText: voice.setText };

  /**
   * The workspace's own copy of the canvas BUILD vocabulary.
   *
   * The same seven tools the board gets (`lib/canvasBuildTools.ts`), bound to
   * THIS project, minus `canvas_create_build` — a workspace that is already open
   * has nothing to create. Registering them here is what gives the docked Brain
   * the ability to LIST, READ and SEARCH the project it is editing, and to make a
   * surgical edit instead of regenerating a whole file. Before this, the docked
   * Brain could only write, and only ever whole files.
   *
   * It is the same implementation rather than a second one so an edit behaves
   * identically whether it was asked for on the board or in the panel.
   */
  const buildToolActions = useMemo<BrainAction[]>(() => canvasBuildActions({
    builds: () => [{
      objectId: String(projectIdNum),
      title: project.name,
      binding: { ideProjectId: projectIdNum, storageProjectId: projectIdNum, storageProjectPublicId: String(projectIdNum), modality },
    }],
    createBuild: async () => { throw new Error('This workspace is already open — edit its files instead of creating another build.'); },
    onFilesChanged: notifyWorkspaceFilesChanged,
  }).filter((action) => action.name !== 'canvas_create_build'), [modality, project.name, projectIdNum]);

  const brainActions = useMemo<BrainAction[]>(() => [
    ...buildToolActions,
    {
      name: 'create_file',
      // Steered at the surgical editor deliberately: this action also backs the
      // "Create file" button on a code block in a chat reply, so it cannot be
      // removed — but a model choosing between it and `canvas_edit_build_file`
      // for an EXISTING file should choose the one that cannot drop code.
      description: 'Create a NEW file in the current project and open it in the editor. To change a file that already exists, use canvas_edit_build_file instead — this action replaces the whole file and silently drops anything you did not reproduce.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path, e.g. src/App.jsx' },
          content: { type: 'string', description: 'Full file contents' },
        },
        required: ['path', 'content'],
      },
      run: async ({ path, content }: { path: string; content: unknown }) => {
        if (!path) return { error: 'A file path is required.' };
        // Models often emit a structured body (e.g. package.json) as an object —
        // coerce to text so the write never crashes on `.trim()` of a non-string.
        const res = liveRef.current.createProjectFile(path, coerceFileContent(content));
        return res.ok ? { created: path } : { error: res.reason };
      },
    },
    {
      name: 'apply_code_to_active_file',
      description: "Replace the entire contents of the file currently open in the editor. Prefer canvas_edit_build_file, which changes only the part you name and costs a fraction of a rewrite; use this only when the whole file genuinely is being replaced.",
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'New full contents for the open file' } },
        required: ['code'],
      },
      run: async ({ code }: { code: unknown }) => {
        const res = liveRef.current.applyCodeToActiveFile(coerceFileContent(code));
        return res.ok ? { applied: liveRef.current.activeFile } : { error: res.reason };
      },
    },
    {
      name: 'use_video_prompt',
      description: 'Load a refined prompt into the video generator (video modality only).',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'The video prompt to load into the generator' } },
        required: ['prompt'],
      },
      run: async ({ prompt }: { prompt: string }) => {
        if (liveRef.current.modality !== 'video') return { error: 'The project is not in Video modality.' };
        setVideoPrompt(prompt ?? '');
        return { loaded: true };
      },
    },
    {
      name: 'set_narration_text',
      description: 'Load the lines to synthesize into the voice studio (voice modality only). The user presses Generate to render them.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The lines to narrate in the selected voice' } },
        required: ['text'],
      },
      run: async ({ text }: { text: string }) => {
        if (liveRef.current.modality !== 'voice') return { error: 'The project is not in Voice modality.' };
        liveRef.current.setVoiceText(text ?? '');
        return { loaded: true };
      },
    },
    {
      name: 'generate_prd',
      description: 'Save a Product Requirements Document (markdown) to the project specs.',
      parameters: {
        type: 'object',
        properties: { prd: { type: 'string', description: 'The full PRD in markdown' } },
        required: ['prd'],
      },
      run: async ({ prd }: { prd: string }) => {
        if (!prd?.trim()) return { error: 'PRD content is empty.' };
        // Auto-approve skips the review modal — the user already opted out of
        // per-action prompts, so save straight through.
        if (isBrainAutoApprove()) {
          try {
            await savePrd(liveRef.current.projectIdNum, prd.trim());
            return { saved: true };
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'Failed to save PRD' };
          }
        }
        // Surface for review; resolve once the user saves or cancels.
        const saved = await new Promise<boolean>((resolve) => {
          setReviewError(null);
          setPrdReview({ prd: prd.trim(), resolve });
        });
        return saved ? { saved: true } : { saved: false, note: 'User declined to save the PRD.' };
      },
    },
    {
      name: 'generate_tasks',
      description: 'Add a list of actionable tasks to the project.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, description: { type: 'string' } },
              required: ['title'],
            },
          },
        },
        required: ['tasks'],
      },
      run: async ({ tasks }: { tasks: Array<{ title: string; description?: string }> }) => {
        const list = Array.isArray(tasks) ? tasks.filter(t => t?.title?.trim()) : [];
        if (list.length === 0) return { error: 'No tasks provided.' };
        const titles = list.map(t => t.title);
        const descriptions = list.map(t => t.description ?? '');
        // Auto-approve skips the review modal — the user already opted out of
        // per-action prompts, so add the tasks straight through.
        if (isBrainAutoApprove()) {
          try {
            await saveTasks(liveRef.current.projectIdNum, { titles, descriptions });
            return { added: list.length };
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'Failed to add tasks' };
          }
        }
        // Surface for review; resolve once the user adds or cancels.
        const saved = await new Promise<boolean>((resolve) => {
          setReviewError(null);
          setTasksReview({ titles, descriptions, resolve });
        });
        return saved ? { added: list.length } : { added: 0, note: 'User declined to add the tasks.' };
      },
    },
    // Closures read only stable refs/setters + module imports; the actual save
    // (which needs projectIdNum) happens in the review-confirm handlers below.
    // `buildToolActions` is the one real dependency: it rebinds when the project
    // or modality changes, and the tools must follow the workspace they edit.
  ], [buildToolActions]);

  useRegisterBrainActions(brainActions);

  // Review-modal handlers for the Brain `generate_prd`/`generate_tasks` tools.
  const confirmPrdReview = useCallback(async () => {
    if (!prdReview) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      await savePrd(projectIdNum, prdReview.prd);
      prdReview.resolve(true);
      setPrdReview(null);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Failed to save PRD');
    } finally {
      setReviewSaving(false);
    }
  }, [prdReview, projectIdNum]);

  const cancelPrdReview = useCallback(() => {
    if (!prdReview) return;
    prdReview.resolve(false);
    setPrdReview(null);
    setReviewError(null);
  }, [prdReview]);

  const confirmTasksReview = useCallback(async () => {
    if (!tasksReview) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      await saveTasks(projectIdNum, { titles: tasksReview.titles, descriptions: tasksReview.descriptions });
      tasksReview.resolve(true);
      setTasksReview(null);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Failed to add tasks');
    } finally {
      setReviewSaving(false);
    }
  }, [tasksReview, projectIdNum]);

  const cancelTasksReview = useCallback(() => {
    if (!tasksReview) return;
    tasksReview.resolve(false);
    setTasksReview(null);
    setReviewError(null);
  }, [tasksReview]);

  // Publish ambient context so the Brain knows the active project/modality and
  // can see the open file.
  const activeFileContent = activeFile ? (fileContents[activeFile] ?? '') : undefined;
  // The open-file context fed to the LLM. Shared by the global Brain (via
  // BrainContext) and the Designer left-panel <BrainPanel> so they speak with
  // identical project awareness.
  const extraSystem = useMemo(
    () =>
      activeFile
        ? `The user currently has the file \`${activeFile}\` open.${activeFileContent ? `\n\nCurrent content of that file:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : ''}`
        : undefined,
    [activeFile, activeFileContent],
  );
  const setBrainContext = brainCtx.setContext;
  useEffect(() => {
    setBrainContext({ projectId: projectIdNum, modality, extraSystem });
  }, [setBrainContext, projectIdNum, modality, extraSystem]);

  // Deep link: when opened with ?chat=, surface that chat. In Designer the chat
  // lives in the left panel (so we just select it); other modalities have no
  // left panel, so we pop the floating drawer instead.
  const setBrainOpen = brainCtx.setOpen;
  useEffect(() => {
    if (initialChatId == null && !initialPrompt && !initialTicket) return;
    // Only the non-docked path needs the context publish + drawer pop; the docked
    // Brain receives initialChatId/initialPrompt/initialTicket as direct props below.
    if (hasDockedBrain) {
      if (initialChatId != null) setBrainContext({ initialChatId });
      return;
    }
    setBrainContext({
      ...(initialChatId != null ? { initialChatId } : {}),
      ...(initialPrompt ? { initialPrompt } : {}),
      ...(initialTicket ? { initialTicket } : {}),
    });
    setBrainOpen(true);
  }, [initialChatId, initialPrompt, initialTicket, hasDockedBrain, setBrainContext, setBrainOpen]);

  const statusLabel = wcState.status === 'booting'
    ? '⏳ Booting…'
    : wcState.status === 'ready'
      ? '✅ Ready'
      : wcState.status === 'error'
        ? '⚠️ WC Error'
        : '';

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      {/* Top bar — editable project title, theme toggle, run button */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0, minHeight: 40,
      }}>
        {/* Left: hamburger (projects panel) */}
        <button
          type="button"
          onClick={() => setProjectsPanelOpen(true)}
          aria-label={t('openProjectsAria')}
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
          }}
          title={t('yourIdeProjects')}
        >
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 'var(--radius-sm)' }} />
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 'var(--radius-sm)' }} />
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 'var(--radius-sm)' }} />
        </button>
        {/* Editable project title */}
        <input
          type="text"
          value={projectTitle}
          onChange={e => setProjectTitle(e.target.value)}
          onBlur={async (e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            const name = projectTitle.trim() || project.name;
            if (name === project.name) {
              setProjectTitle(project.name);
              return;
            }
            setIsSavingTitle(true);
            try {
              const updated = await updateProject(project.id, { name });
              onProjectUpdate?.({ ...project, ...updated });
              setProjectTitle(updated.name);
            } catch {
              setProjectTitle(project.name);
            } finally {
              setIsSavingTitle(false);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; }}
          disabled={isSavingTitle}
          title={t('editNameHint')}
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '0.9rem',
            color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            minWidth: 120,
            maxWidth: 320,
            outline: 'none',
          }}
        />
        {project.description && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            — {project.description}
          </span>
        )}

        {/* Next to title: Details */}
        {onOpenProjectDetails && (
          <button
            type="button"
            onClick={onOpenProjectDetails}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '5px 10px',
              fontSize: '0.82rem',
              cursor: 'pointer',
              flexShrink: 0,
              fontFamily: 'var(--font-display)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={t('projectDetailsTitle')}
          >
            <Icon name="project" size={16} />
            Details
          </button>
        )}

        {/* Settings cog — repo / source-control configuration slide-out */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('projectSettingsAria')}
          title={t('settingsRepoTitle')}
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '5px 9px',
            fontSize: '0.95rem',
            cursor: 'pointer',
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          
          <Icon source="⚙️" size="1em" />
        </button>

        {/* Team Chat — the project's group conversation (humans + agents) */}
        {Number.isFinite(projectIdNum) && <TeamChatButton projectId={projectIdNum} />}

        {/* Modality label — Builder is scoped to this project's type (set at
            creation), so it's shown, not switchable. */}
        <span
          title={t('modalityProject', { label: modalityCopy.label })}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8, flexShrink: 0,
            padding: '4px 10px', fontSize: '0.78rem', fontWeight: 600,
            fontFamily: 'var(--font-display)', color: 'var(--text-secondary)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          }}
        >
          <span><Icon source={modalityCopy.icon} size={20} /></span>
          {modalityCopy.label}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: collab status, run */}
        {collabConnected && (
          <span style={{ fontSize: '0.72rem', color: 'var(--success-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, background: 'var(--emerald-bright)', borderRadius: '50%', display: 'inline-block' }} />
            Live
          </span>
        )}
        {statusLabel && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{statusLabel}</span>
        )}
        {modalityDef.showChecks && checkResults && (() => {
          const failed = checkResults.filter(r => r.status === 'fail').length;
          const passed = checkResults.filter(r => r.status === 'pass').length;
          return (
            <span
              title={checkResults.map(r => `${r.label}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join('\n')}
              style={{
                fontSize: '0.72rem', fontWeight: 600, flexShrink: 0,
                color: failed > 0 ? 'var(--error)' : 'var(--emerald-bright)',
              }}
            >
              <Icon name={failed > 0 ? 'close' : 'check'} size={14} /> {failed > 0 ? `${failed} check${failed > 1 ? 's' : ''} failed` : `${passed} check${passed > 1 ? 's' : ''} passed`}
            </span>
          );
        })()}
        {modalityDef.showChecks && (
          <label
            title={t('blockOnFailHint')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={gateRunOnChecks}
              onChange={(e) => setGateRunOnChecks(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Gate Run
          </label>
        )}
        {modalityDef.showChecks && (
          <button
            onClick={handleCheck}
            disabled={isChecking || isRunning}
            title={t('runChecksHint')}
            style={{
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
              padding: '5px 12px', fontSize: '0.82rem', fontWeight: 600,
              cursor: (isChecking || isRunning) ? 'wait' : 'pointer', fontFamily: 'var(--font-display)',
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              opacity: (isChecking || isRunning) ? 0.6 : 1,
            }}
          >
            {!isChecking && <Icon name="check" size={14} />} {isChecking ? 'Checking…' : 'Check'}
          </button>
        )}
        {modalityDef.showRunButton && (() => {
          // Voice generates speech (voice.synth); Designer runs the dev server.
          const isVoice = modality === 'voice';
          const label = modalityCopy.runLabel;
          const active = isVoice ? voice.busy : isRunning;
          const disabled = active || (isVoice && !voice.selectedCloneId);
          return (
            <button
              onClick={isVoice ? () => void voice.synth() : handleRun}
              disabled={disabled}
              title={isVoice && !voice.selectedCloneId ? 'Create or select a voice first' : undefined}
              style={{
                background: active ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--success), var(--success))',
                color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)',
                padding: '5px 14px', fontSize: '0.82rem', fontWeight: 600,
                cursor: active ? 'wait' : (disabled ? 'not-allowed' : 'pointer'), fontFamily: 'var(--font-display)',
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {active ? `${isVoice ? 'Generating': 'Running'}…` : `${label}`}
            </button>
          );
        })()}
      </div>

      <BuilderProjectsSlideOutPanel
        open={projectsPanelOpen}
        onClose={() => setProjectsPanelOpen(false)}
        currentStorageProjectId={typeof project.id === 'number' ? project.id : Number(project.id)}
      />

      <BuilderSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectId={projectIdNum}
        onImported={refreshFiles}
      />

      {/* Mobile: scan-to-open-on-a-real-phone. Mounted only where the device
          simulator is, since it hands off that modality's published build. */}
      {(modalityDef.center === 'device' || modalityDef.enableMobilePreview) && Number.isFinite(projectIdNum) && (
        <MobileDevicePanel
          open={devicePanelOpen}
          onClose={() => setDevicePanelOpen(false)}
          projectId={projectIdNum}
          onGoToPublish={() => setRightTab('publish')}
        />
      )}

      {/* Brain-tool artifact reviews — the agent's generate_prd/generate_tasks
          surface here for confirm-before-save, matching the button-action path. */}
      {prdReview && (
        <PrdReviewModal
          prd={prdReview.prd}
          onCancel={cancelPrdReview}
          onConfirm={confirmPrdReview}
          saving={reviewSaving}
          error={reviewError}
        />
      )}
      {tasksReview && (
        <TasksReviewModal
          titles={tasksReview.titles}
          descriptions={tasksReview.descriptions}
          onCancel={cancelTasksReview}
          onConfirm={confirmTasksReview}
          saving={reviewSaving}
          error={reviewError}
        />
      )}

      {/* Main content. In Designer and Voice the agent lives in the left panel
          (the shared <BrainPanel> wired to this project's brain actions); other
          modalities use the global floating Brain drawer. Either way Builder
          registers the same actions, so the agent can create/apply files or set
          the narration lines. */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Docked left panel (Designer + Voice) — context strip + agent chat */}
        {hasDockedBrain && (
          <div style={{
            width: 340, minWidth: 340, flexShrink: 0,
            borderRight: '1px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: 'var(--bg-base)',
          }}>
            {/* Context strip — what the agent currently "sees" / drives */}
            <div style={{
              flexShrink: 0, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
              borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
              fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden',
            }}>
              <span title={modality === 'voice' ? 'Voice director' : 'Coding agent'} style={{ fontSize: '0.9rem' }}>
                {modality === 'voice' ? <Icon source="🎙" size="1em" /> : <Icon source="🤖" size="1em" />}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                {modality === 'voice' ? 'Voice:' : 'Context:'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {modality === 'voice'
                  ? (voice.clones.find((c) => c.id === voice.selectedCloneId)?.name ?? 'none selected')
                  : (activeFile ? activeFile : 'whole project')}
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <BrainPanel
                variant="docked"
                pinnedProjectId={projectIdNum}
                modality={modality}
                extraSystem={extraSystem}
                initialChatId={initialChatId}
                initialPrompt={initialPrompt}
                initialTicket={initialTicket}
                capabilitySurface="build"
              />
            </div>
          </div>
        )}
        {/* Center panel — content depends on the active modality, chrome stays consistent */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Center Brain chat affordance — modalities that DON'T dock the agent
              in the left panel (Video / Evermind / Fine-tune) otherwise only have
              the corner launcher, so surface a prominent brain button in the middle
              of the Builder that opens the AI chat scoped to this project. */}
          {!hasDockedBrain && (
            <button
              type="button"
              onClick={() => { setBrainContext({ projectId: projectIdNum, modality }); setBrainOpen(true); }}
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
              <span aria-hidden style={{ fontSize: '1.2rem', lineHeight: 1 }}><Icon source="🧠" size="1em" /></span>
              {t('askAi')}
            </button>
          )}
          {modalityDef.center === 'video' ? (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <StudioPanel
                authToken={getStoredTenantToken() ?? ''}
                baseUrl={getApiBaseUrl()}
                hideHeader
                promptValue={videoPrompt}
                onPromptChange={setVideoPrompt}
                versions={videoVersions.versions}
                onSaveVersion={videoVersions.onSaveVersion}
                onLoadVersion={videoVersions.onLoadVersion}
              />
              {/* The project's self-learning Evermind — parity with the other
                  studios (self-gating, localized, theme-aware). */}
              {/* `Number(project.id)` is NaN for a non-numeric id, and
                  `NaN != null` is true — so guard on finiteness, matching the
                  other project-id checks in this file, or a malformed id would
                  mount the panel and request `/api/projects/NaN/...`. */}
              {Number.isFinite(projectIdNum) && (
                <div style={{ padding: '0 16px 16px' }}>
                  <ProjectEvermindPanel projectId={projectIdNum} />
                </div>
              )}
            </div>
          ) : modalityDef.center === 'voice' ? (
            <VoiceOutput
              result={voice.result}
              audioUrl={voice.audioUrl}
              busy={voice.busy}
              unavailable={voice.unavailable}
            />
          ) : modalityDef.center === 'evermind' || modalityDef.center === 'finetune' ? (
            activeFile ? (
              <CodePane
                openFiles={openFiles}
                activeFile={activeFile}
                fileContents={fileContents}
                onTabSelect={setActiveFile}
                onTabClose={closeTab}
                onChange={handleEditorChange}
                ydoc={ydoc}
                projectId={project.id}
              />
            ) : (
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {modalityDef.center === 'evermind' ? (
                  <EvermindStudioPanel projectId={project.id} />
                ) : (
                  <FinetuneStudioPanel
                    projectId={project.id}
                    files={files}
                    onGoToTab={setRightTab}
                    onOpenFile={openFile}
                  />
                )}
              </div>
            )
          ) : (
          <>
          {/* Preview/Code toggle */}
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', padding: '2px 6px', gap: 6, flexShrink: 0 }}>
            {(['preview', 'code'] as CenterView[]).map(view => (
              <button
                key={view}
                onClick={() => setCenterView(view)}
                style={{
                  padding: '6px 16px', fontSize: '0.8rem', fontWeight: 600,
                  background: centerView === view ? 'var(--bg-elevated)' : 'transparent',
                  color: centerView === view ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none', borderBottom: centerView === view ? '2px solid var(--coral-bright)' : '2px solid transparent',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {view === 'preview' ? (
                  <>
                    <span aria-hidden>{modalityDef.center === 'device' ? <Icon source="📱" size="1em" /> : <Icon source="🌐" size="1em" />}</span>
                    {t('centerPreview')}
                    {previewUrl && <span style={{ color: 'var(--success-text)' }}><Icon name="activity" size={12} /></span>}
                  </>
                ) : (
                  <>
                    <span aria-hidden><Icon source="💻" size="1em" /></span>
                    {t('centerCode')}
                  </>
                )}
              </button>
            ))}
            {/* Web ⇄ Mobile preview target — only the combined Web + Mobile type,
                and only while previewing. Lets one project render as both a
                full-width website and a phone-bezel handset app. */}
            {modalityDef.enableMobilePreview && centerView === 'preview' && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                {(['web', 'mobile'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPreviewDevice(d)}
                    aria-pressed={previewDevice === d}
                    title={d === 'web' ? t('previewWeb') : t('previewMobile')}
                    style={{
                      padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', border: '1px solid var(--border-subtle)',
                      background: previewDevice === d ? 'var(--bg-elevated)' : 'transparent',
                      color: previewDevice === d ? 'var(--text-primary)' : 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <span aria-hidden>{d === 'web' ? <Icon source="🌐" size="1em" /> : <Icon source="📱" size="1em" />}</span>
                    {d === 'web' ? t('previewWeb') : t('previewMobile')}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Main content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {/* Preview */}
            <div style={{ position: 'absolute', inset: 0, visibility: centerView === 'preview' ? 'visible' : 'hidden', pointerEvents: centerView === 'preview' ? 'auto' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                {/* Mobile previews inside a device bezel at the handset's real
                    viewport size; every other code modality fills the pane. The
                    combined Web + Mobile type switches between the two via the
                    Web/Mobile toggle above. */}
                {modalityDef.center === 'device' || (modalityDef.enableMobilePreview && previewDevice === 'mobile') ? (
                  <DevicePreview url={previewUrl} onOpenDevicePanel={() => setDevicePanelOpen(true)} />
                ) : (
                  <PreviewFrame url={previewUrl} frameRef={previewFrameRef} />
                )}
              </div>
              {/* Point-and-edit: the cheap half of changing an app. A class or a
                  line of copy is an exact, single-line source edit anchored to the
                  element React itself reported — no model turn, no tokens. */}
              {previewUrl && (
                <div
                  style={{
                    borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                    padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => armVisual(!visualArmed)}
                      aria-pressed={visualArmed}
                      title={t('visualEditHint')}
                      style={{
                        padding: '5px 12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                        borderRadius: 'var(--radius-md)', minHeight: 32,
                        border: `1px solid ${visualArmed ? 'var(--accent)' : 'var(--border-subtle)'}`,
                        background: visualArmed ? 'var(--accent)' : 'var(--bg-deep)',
                        color: visualArmed ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {visualArmed ? t('visualEditOn') : t('visualEdit')}
                    </button>
                    {visualSelection && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {t('visualSelected', { tag: visualSelection.tag, file: visualSelection.file, line: visualSelection.line })}
                      </span>
                    )}
                  </div>
                  {visualSelection && (
                    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
                      {visualSelection.text !== null && (
                        <label style={{ display: 'grid', gap: 4, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          {t('visualText')}
                          <input
                            value={visualDraft.text}
                            onChange={(event) => setVisualDraft((draft) => ({ ...draft, text: event.target.value }))}
                            style={visualFieldStyle}
                          />
                        </label>
                      )}
                      <label style={{ display: 'grid', gap: 4, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {t('visualClasses')}
                        <input
                          value={visualDraft.className}
                          onChange={(event) => setVisualDraft((draft) => ({ ...draft, className: event.target.value }))}
                          style={visualFieldStyle}
                        />
                      </label>
                    </div>
                  )}
                  {visualSelection && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => { void applyVisualEdit(); }} style={visualPrimaryButton}>
                        {t('visualApply')}
                      </button>
                      <button type="button" onClick={() => { setVisualSelection(null); setVisualError(null); }} style={visualSecondaryButton}>
                        {t('visualCancel')}
                      </button>
                      {visualError && (
                        <span role="alert" style={{ fontSize: '0.72rem', color: 'var(--error)' }}>{visualError}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Code Editor */}
            <div style={{ position: 'absolute', inset: 0, visibility: centerView === 'code' ? 'visible' : 'hidden', pointerEvents: centerView === 'code' ? 'auto' : 'none', display: 'flex', flexDirection: 'column' }}>
              <CodePane
                openFiles={openFiles}
                activeFile={activeFile}
                fileContents={fileContents}
                onTabSelect={setActiveFile}
                onTabClose={closeTab}
                onChange={handleEditorChange}
                ydoc={ydoc}
                projectId={project.id}
              />
            </div>
          </div>

          {/* Terminal at bottom — collapsible panel with tab */}
          <div
            style={{
              height: terminalExpanded ? 220 : 36,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              background: 'var(--bg-deep)',
              transition: 'height 0.2s ease',
            }}
          >
            <button
              type="button"
              onClick={() => setTerminalExpanded((e) => !e)}
              aria-expanded={terminalExpanded}
              aria-label={terminalExpanded ? 'Collapse terminal' : 'Expand terminal'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                background: 'rgba(0,0,0,0.25)',
                border: 'none',
                borderBottom: terminalExpanded ? '1px solid rgba(255,255,255,0.08)' : 'none',
                padding: '6px 10px',
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Terminal
              </span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
                {terminalExpanded ? '▼' : <Icon source="▶" size="1em" />}
              </span>
            </button>
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                minHeight: 0,
                minWidth: 0,
                width: '100%',
                display: terminalExpanded ? 'flex' : 'none',
              }}
            >
              <Terminal
                onReady={handleTerminalReady}
                onInput={handleTerminalInput}
              />
            </div>
          </div>
          </>
          )}
        </div>

        {/* Right panel: Files / Train / Publish */}
        <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            {allowedRightTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1, padding: '5px 4px', fontSize: '0.72rem', fontWeight: 600,
                  background: rightTab === tab ? 'var(--bg-elevated)' : 'transparent',
                  color: rightTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderTop: rightTab === tab ? '2px solid var(--coral-bright)' : '2px solid transparent',
                  cursor: 'pointer', fontFamily: 'var(--font-display)',
                  whiteSpace: 'nowrap',
                }}
              >{RIGHT_TAB_LABELS[tab]}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'voice' ? 'visible' : 'hidden', pointerEvents: rightTab === 'voice' ? 'auto' : 'none' }}>
              {modality === 'voice' && <VoiceConfigPanel voice={voice} projectId={projectIdNum} />}
            </div>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'files' ? 'visible' : 'hidden', pointerEvents: rightTab === 'files' ? 'auto' : 'none' }}>
              <FileExplorer
                files={files}
                activeFile={activeFile}
                onFileSelect={openFile}
                onFileCreate={async (path) => { await handleFileCreate(path); refreshFiles(); }}
                onFileDelete={async (path) => { await handleFileDelete(path); refreshFiles(); }}
                showHeader={false}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'agent' ? 'visible' : 'hidden', pointerEvents: rightTab === 'agent' ? 'auto' : 'none' }}>
              {rightTab === 'agent' && <BuilderAgentPanel projectId={project.id} />}
            </div>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'train' ? 'visible' : 'hidden', pointerEvents: rightTab === 'train' ? 'auto' : 'none' }}>
              <AITrainingPanel
                projectId={project.id}
                onLog={(msg) => terminalWriter?.(`\r\n\x1b[35m[Train]\x1b[0m ${msg}`)}
                onJobCompleted={(job) => setCompletedJobs(prev => {
                  const exists = prev.some(j => j.id === job.id);
                  return exists ? prev.map(j => j.id === job.id ? job : j) : [job, ...prev];
                })}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, overflow: 'auto', visibility: rightTab === 'publish' ? 'visible' : 'hidden', pointerEvents: rightTab === 'publish' ? 'auto' : 'none' }}>
              {modalityDef.publishPanel === 'site'
                ? <SitePublishPanel projectId={project.id} projectName={project.name} onBuild={handlePublishBuild} />
                : <AgentPublishPanel projectId={project.id} completedJobs={completedJobs} />}
            </div>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'state' ? 'visible' : 'hidden', pointerEvents: rightTab === 'state' ? 'auto' : 'none' }}>
              <AgentStateViewer projectId={project.id} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Point-and-edit field chrome. Every colour is a theme token so the panel reads
 * in both themes, and the fields are fluid so the row wraps rather than
 * overflowing on a narrow viewport.
 */
const visualFieldStyle: React.CSSProperties = {
  width: '100%', minWidth: 0, padding: '6px 8px', fontSize: '0.78rem', minHeight: 32,
  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)',
};

const visualPrimaryButton: React.CSSProperties = {
  padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', minHeight: 32,
  borderRadius: 'var(--radius-md)', border: 'none',
  background: 'var(--accent)', color: 'var(--text-on-accent)',
};

const visualSecondaryButton: React.CSSProperties = {
  padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', minHeight: 32,
  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-secondary)',
};
