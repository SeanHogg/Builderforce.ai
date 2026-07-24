'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { defaultsForModality } from '@/lib/vanillaDefaults';
import { FileExplorer } from './FileExplorer';
import { CodePane } from './CodePane';
import { Terminal } from './Terminal';
import { AITrainingPanel } from './AITrainingPanel';
import { AgentPublishPanel } from './AgentPublishPanel';
import { SitePublishPanel } from './SitePublishPanel';
import { AgentStateViewer } from './AgentStateViewer';
import { EvermindStudioPanel } from './EvermindStudioPanel';
import { FinetuneStudioPanel } from './FinetuneStudioPanel';
import { PreviewFrame } from './PreviewFrame';
import { IdeProjectsSlideOutPanel } from './ide/IdeProjectsSlideOutPanel';
import { BrainPanel } from './brain/BrainPanel';
import { TeamChatButton } from './brain/TeamChatButton';
import { IdeSettingsPanel } from './IdeSettingsPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { IdeAgentPanel } from './ide/IdeAgentPanel';
import { DevicePreview } from './ide/DevicePreview';
import { MobileDevicePanel } from './ide/MobileDevicePanel';
import { useWebContainer } from '@/hooks/useWebContainer';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useVideoVersions } from '@/hooks/useVideoVersions';
import type { Project, FileEntry, TrainingJob } from '@/lib/types';
import { saveFile, fetchFileContent, deleteFile, fetchFiles, updateProject } from '@/lib/api';
import { validateFileContentForPath, coerceFileContent } from '@/lib/fileContentGuard';
import { isBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useRegisterBrainActions, useBrainContext, savePrd, saveTasks, type BrainAction } from '@/lib/brain';
import { PrdReviewModal, TasksReviewModal } from './ArtifactReviewModals';
import { getModality, RIGHT_TAB_LABELS, type ProjectModality, type RightTab } from '@/lib/modality';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { getStoredTenantToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/apiClient';
import { useVoiceStudio } from '@/lib/voiceStudio';
import { VoiceOutput } from './ide/VoiceOutput';
import { VoiceConfigPanel } from './ide/VoiceConfigPanel';
import { ProjectEvermindPanel } from './ide/ProjectEvermindPanel';
import { StudioPanel } from '@seanhogg/builderforce-studio-embedded';
import '@seanhogg/builderforce-studio-embedded/styles.css';

interface IDEProps {
  project: Project;
  initialFiles: FileEntry[];
  onProjectUpdate?: (project: Project) => void;
  /** Open the project details slide-out panel. */
  onOpenProjectDetails?: () => void;
  /** When opening from "Open in IDE" with a chat, select this project chat on load. */
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

export function IDE({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId, initialPrompt, initialTicket }: IDEProps) {
  const t = useTranslations('ide');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  // The IDE is scoped to its project's type: modality is fixed at creation, not
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

  // Task 2: Boot WebContainer and spawn an interactive shell immediately on IDE load.
  // This makes the terminal live from the moment the IDE opens, not just after clicking Run.
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

    const mount: Record<string, string> = { ...allContents };
    const restored: Record<string, string> = {};
    for (const [path, content] of Object.entries(defaultsForModality(modality))) {
      const current = mount[path];
      const isEmpty = !current || current.trim() === '';
      // Also restore a scaffold file whose on-disk content is structurally wrong
      // for its path — e.g. package.json's JSON cross-wired into vite.config.js,
      // which crashed Vite with `Expected ";" but found ":"`. Without this, a
      // corrupt (but non-empty) scaffold file sailed past the empty-only check
      // straight into the dev server. Same guard the editor writes through, so a
      // legitimate file is never clobbered.
      const isCorrupt = !isEmpty && !validateFileContentForPath(path, current).ok;
      if (isEmpty || isCorrupt) {
        onLog?.(
          isCorrupt
            ? `  \x1b[33m⚠\x1b[0m ${path} was corrupt — restored from the starter template\r\n`
            : `  \x1b[33m⚠\x1b[0m ${path} was empty — restored from the starter template\r\n`,
        );
        mount[path] = content;
        restored[path] = content;
      }
    }
    if (Object.keys(restored).length > 0) {
      setFileContents(prev => ({ ...prev, ...restored }));
      setFiles(prev => {
        const have = new Set(prev.map(f => f.path));
        const add = Object.keys(restored)
          .filter(p => !have.has(p))
          .map(path => ({ path, content: restored[path], type: 'file' as const }));
        return add.length > 0 ? [...prev, ...add] : prev;
      });
      // Best-effort: a save failure (offline, 503) must never block the run —
      // the mount already has the content either way.
      await Promise.all(
        Object.entries(restored).map(([path, content]) =>
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
      await mountFiles(mountContents);
      terminalWriter?.(`  \x1b[32m✓\x1b[0m Mounted ${Object.keys(mountContents).length} file(s).\r\n\r\n`);

      terminalWriter?.('\x1b[36m[3/3] Installing dependencies...\x1b[0m\r\n');
      const installCode = await ensureInstalled(mountContents, (data) => terminalWriter?.(data));
      if (installCode !== 0) {
        terminalWriter?.('\r\n\x1b[31m✗ npm install failed (exit code ' + installCode + '). Fix errors above and try again.\x1b[0m\r\n');
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
  }, [isRunning, startDevServer, mountFiles, assembleMountContents, ensureInstalled, terminalWriter, checkResults, gateRunOnChecks]);

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
   * validation of the code the IDE/agent produced. Mounts + installs (reusing the
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
      const installCode = await ensureInstalled(mount, (d) => terminalWriter?.(d));
      if (installCode !== 0) {
        setCheckResults([{ label: 'npm install', status: 'fail', detail: `exit ${installCode}` }]);
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
        const code = await runCommandAndWait(step.cmd[0], step.cmd[1], (d) => terminalWriter?.(d));
        results.push({ label: step.label, status: code === 0 ? 'pass' : 'fail', detail: code === 0 ? undefined : `exit ${code}` });
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
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, isRunning, assembleMountContents, ensureInstalled, mountFiles, runCommandAndWait, terminalWriter]);

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

  // --- Brain integration ----------------------------------------------------
  // The IDE's AI lives in the global Brain drawer. The IDE exposes its
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

  // Latest IDE state for action handlers, so the registered action array stays
  // stable (no re-registration churn) while `run()` reads current values.
  const liveRef = useRef({ activeFile, modality, applyCodeToActiveFile, createProjectFile, projectIdNum, setVoiceText: voice.setText });
  liveRef.current = { activeFile, modality, applyCodeToActiveFile, createProjectFile, projectIdNum, setVoiceText: voice.setText };

  const brainActions = useMemo<BrainAction[]>(() => [
    {
      name: 'create_file',
      description: 'Create or overwrite a file in the current project and open it in the editor.',
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
      description: "Replace the contents of the file currently open in the editor.",
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
  ], []);

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
            borderRadius: 8,
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
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
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
            borderRadius: 6,
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
              borderRadius: 8,
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
            <span style={{ fontSize: '1rem' }}>▦</span>
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
            borderRadius: 8,
            padding: '5px 9px',
            fontSize: '0.95rem',
            cursor: 'pointer',
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          ⚙️
        </button>

        {/* Team Chat — the project's group conversation (humans + agents) */}
        {Number.isFinite(projectIdNum) && <TeamChatButton projectId={projectIdNum} />}

        {/* Modality label — the IDE is scoped to this project's type (set at
            creation), so it's shown, not switchable. */}
        <span
          title={t('modalityProject', { label: modalityCopy.label })}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8, flexShrink: 0,
            padding: '4px 10px', fontSize: '0.78rem', fontWeight: 600,
            fontFamily: 'var(--font-display)', color: 'var(--text-secondary)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8,
          }}
        >
          <span>{modalityCopy.icon}</span>
          {modalityCopy.label}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: collab status, run */}
        {collabConnected && (
          <span style={{ fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%', display: 'inline-block' }} />
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
                color: failed > 0 ? '#f87171' : '#4ade80',
              }}
            >
              {failed > 0 ? `✗ ${failed} check${failed > 1 ? 's' : ''} failed` : `✓ ${passed} check${passed > 1 ? 's' : ''} passed`}
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
              border: '1px solid var(--border-subtle)', borderRadius: 8,
              padding: '5px 12px', fontSize: '0.82rem', fontWeight: 600,
              cursor: (isChecking || isRunning) ? 'wait' : 'pointer', fontFamily: 'var(--font-display)',
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              opacity: (isChecking || isRunning) ? 0.6 : 1,
            }}
          >
            {isChecking ? '⏳ Checking…' : '✓ Check'}
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
                background: active ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '5px 14px', fontSize: '0.82rem', fontWeight: 600,
                cursor: active ? 'wait' : (disabled ? 'not-allowed' : 'pointer'), fontFamily: 'var(--font-display)',
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {active ? `⏳ ${isVoice ? 'Generating' : 'Running'}…` : `▶ ${label}`}
            </button>
          );
        })()}
      </div>

      <IdeProjectsSlideOutPanel
        open={projectsPanelOpen}
        onClose={() => setProjectsPanelOpen(false)}
        currentStorageProjectId={typeof project.id === 'number' ? project.id : Number(project.id)}
      />

      <IdeSettingsPanel
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
          modalities use the global floating Brain drawer. Either way the IDE
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
                {modality === 'voice' ? '🎙' : '🤖'}
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
                capabilitySurface="ide"
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
                padding: '10px 18px', borderRadius: 9999, cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                background: 'linear-gradient(135deg, var(--coral-bright, #f4726e), var(--coral-dark, #d94f4a))',
                color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.85rem',
                boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
              }}
            >
              <span aria-hidden style={{ fontSize: '1.2rem', lineHeight: 1 }}>🧠</span>
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
                  borderRadius: 6,
                }}
              >
                {view === 'preview' ? (
                  <>
                    <span aria-hidden>{modalityDef.center === 'device' ? '📱' : '🌐'}</span>
                    {t('centerPreview')}
                    {previewUrl && <span style={{ color: '#4ade80' }}>●</span>}
                  </>
                ) : (
                  <>
                    <span aria-hidden>💻</span>
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
                      padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 6,
                      cursor: 'pointer', border: '1px solid var(--border-subtle)',
                      background: previewDevice === d ? 'var(--bg-elevated)' : 'transparent',
                      color: previewDevice === d ? 'var(--text-primary)' : 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <span aria-hidden>{d === 'web' ? '🌐' : '📱'}</span>
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
                  <PreviewFrame url={previewUrl} />
                )}
              </div>
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
              background: '#1a1a2e',
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
                {terminalExpanded ? '▼' : '▶'}
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
              {rightTab === 'agent' && <IdeAgentPanel projectId={project.id} />}
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
