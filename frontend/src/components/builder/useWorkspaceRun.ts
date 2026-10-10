// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { repairScaffold, type ScaffoldRestoreReason } from '@/lib/scaffoldRepair';
import { hashString } from '@/lib/hashString';
import { RUN_LOG_RULE, type RunLog } from '@/lib/runLog';
import { useProjectRuntime } from '@/hooks/useProjectRuntime';
import { useInstantPreview } from '@/hooks/useInstantPreview';
import { useToast } from '@/components/ToastProvider';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';
import { buildSite, hasTypeScript, typecheckFiles } from '@/lib/browserRuntime/siteTools';
import { runProjectChecks, type CheckResult } from '@/lib/browserRuntime/projectChecks';
import { clearBuildFailures, markBuildSourceChanged, recordBuildFailure, teeOutput, withPreviewErrorReporter } from '@/lib/buildDiagnostics';
import { withVisualEditor } from '@/lib/visualEditor';
import { withPreviewProbe } from '@/lib/previewProbe/probeScript';
import type { FileEntry } from '@/lib/types';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import type { ProjectModality } from '@/lib/modality';

const SCAFFOLD_RESTORE_LOG_KEY: Record<ScaffoldRestoreReason, string> = {
  empty: 'scaffoldRestoredEmpty',
  corrupt: 'scaffoldRestoredCorrupt',
  retired: 'scaffoldRestoredRetired',
};

/**
 * Where the preview is in its life:
 * - `idle`     nothing has been started yet (or the project has nothing to run)
 * - `starting` a run is in flight (see {@link RunStep})
 * - `live`     a preview URL is being served
 * - `failed`   the last run failed; the terminal and the Problems tab say why
 * - `blocked`  the run was refused because the last checks failed and the gate is on
 */
export type RunPhase = 'idle' | 'starting' | 'live' | 'failed' | 'blocked';

/** The step a starting run is on — what the preview's progress list highlights. */
export type RunStep = 'preparing' | 'installing' | 'starting';

export interface WorkspaceRunArgs {
  /** Where the project's files live — a durable project, or this browser. */
  store: WorkspaceFileStore;
  modality: ProjectModality;
  files: FileEntry[];
  setFiles: Dispatch<SetStateAction<FileEntry[]>>;
  fileContents: Record<string, string>;
  setFileContents: Dispatch<SetStateAction<Record<string, string>>>;
  log: RunLog;
  publishLog: RunLog;
}

/**
 * The workspace's run pipeline: preview, checks and the publish build, all from
 * the project's files in the browser.
 *
 * It owns the preview's lifecycle ({@link RunPhase}) so the preview pane can
 * say what is happening instead of asking the person to press a button — the
 * run itself is started by `useAutoRun`, not by a Run control.
 */
export function useWorkspaceRun({ store, modality, files, setFiles, fileContents, setFileContents, log, publishLog }: WorkspaceRunArgs) {
  const t = useTranslations('ide');
  const tc = useTranslations('common');
  const toast = useToast();
  const { mountFiles, runCommandAndWait, writeFile: writeRuntimeFile, startShell, startDevServer } = useProjectRuntime();
  const { start: startInstantPreview, write: writeInstantPreview } = useInstantPreview();

  const [phase, setPhase] = useState<RunPhase>('idle');
  const [step, setStep] = useState<RunStep | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [isChecking, setIsChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null);
  // When on, a run is hard-gated on the last check pass — "code must be good
  // before it runs". When off, failed checks only warn (a toast) while serving.
  const [gateRunOnChecks, setGateRunOnChecks] = useState(true);
  // A ref, not the phase: the auto-runner and a manual restart can both ask at
  // once, and a stale closure must not start a second run.
  const runningRef = useRef(false);
  // package.json hash of the last successful npm install in this runtime session,
  // so Run/Check/Build can skip a redundant install when dependencies are unchanged.
  const lastInstallHashRef = useRef<string | null>(null);

  /** An edit reaches whichever runtime is showing the preview. */
  const writePreviewFile = useCallback(
    (path: string, contents: string): Promise<void> => {
      // Failures from before this edit are no longer proof the source is broken.
      markBuildSourceChanged(store.id);
      return writeInstantPreview(path, contents) ? Promise.resolve() : writeRuntimeFile(path, contents);
    },
    [writeInstantPreview, writeRuntimeFile, store.id],
  );

  /**
   * Assemble the path→content map to mount into the runtime: the project's
   * current contents (fetching any not yet loaded into state) plus the starter
   * scaffold for any missing/empty required file. Returns null if a present
   * package.json is invalid JSON. Shared by Run, Check and the publish build so
   * the gather/defaults/validate logic lives in exactly one place.
   *
   * A scaffold file that has to be substituted is also SAVED back to the project,
   * so a workspace the server never seeded does not open blank in the editor and
   * the substitution does not repeat on every run. Only a path with NO usable
   * content is ever written, so real work is never overwritten.
   */
  const assembleMountContents = useCallback(async (onLog?: RunLog): Promise<Record<string, string> | null> => {
    const allContents: Record<string, string> = { ...fileContents };
    const unfetched = files.filter(f => f.type === 'file' && !(f.path in allContents));
    if (unfetched.length > 0) {
      const fetched: Record<string, string> = {};
      await Promise.all(unfetched.map(async (f) => {
        try {
          const content = await store.read(f.path);
          allContents[f.path] = content;
          fetched[f.path] = content;
        } catch (error) {
          onLog?.error('fileFetchFailed', { path: f.path });
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
    // ones (another file's content written to this path). Shared pure helper so
    // Run, Check and the publish build agree and the logic is unit-tested.
    const { repaired: mount, restored } = repairScaffold(allContents, modality);
    if (restored.length > 0) {
      for (const { path, reason } of restored) {
        onLog?.warn(SCAFFOLD_RESTORE_LOG_KEY[reason], { path });
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
          store.write(path, content).catch((e) => console.error(`Failed to restore ${path}:`, e)),
        ),
      );
    }
    if (mount['package.json']) {
      try {
        JSON.parse(mount['package.json']);
      } catch {
        onLog?.error('invalidPackageJson');
        return null;
      }
    }
    return mount;
  }, [fileContents, files, store, modality, setFiles, setFileContents]);

  /**
   * Run `npm install` only when package.json changed since the last install in
   * this runtime session (the shared runtime keeps node_modules across runs).
   * Returns the install exit code (0 when skipped).
   */
  const ensureInstalled = useCallback(async (
    mount: Record<string, string>,
    onOutput?: (data: string) => void,
    onLog?: RunLog,
  ): Promise<number> => {
    if (!mount['package.json']) return 0;
    const hash = hashString(mount['package.json']);
    if (lastInstallHashRef.current === hash) {
      onLog?.ok('depsUnchanged');
      return 0;
    }
    const code = await runCommandAndWait('npm', ['install'], onOutput);
    if (code === 0) lastInstallHashRef.current = hash;
    return code;
  }, [runCommandAndWait]);

  /** Start (or restart) the preview. Resolves once the run has settled. */
  const run = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    // Gate on the last check result so a known-broken build isn't served as a
    // preview. Hard-gate when enabled; otherwise warn and let it serve.
    const failedChecks = checkResults?.filter((r) => r.status === 'fail') ?? [];
    if (failedChecks.length > 0) {
      const summary = failedChecks.map((r) => r.label).join(', ');
      if (gateRunOnChecks) {
        log.error('runBlocked', { summary });
        log.hint('runBlockedHint');
        setPhase('blocked');
        return;
      }
      toast.warning(tc('servingPreviewAnyway', { summary }));
    }
    runningRef.current = true;
    setPhase('starting');
    setStep('preparing');
    // A new run is judged on its own output: clear the previous attempt's failures
    // so a repair turn is never handed an error the user has already fixed.
    clearBuildFailures(store.id);
    let live = false;
    try {
      log.banner('runStarted');

      log.step('stepPreparing');
      const mountContents = await assembleMountContents(log);
      if (!mountContents) {
        throw new Error(t('runLog.invalidPackageJsonFix'));
      }
      log.ok('filesReady');
      log.blank();

      // The overlays go into the MOUNTED copy only — never the files on disk and
      // never the publish path — so a runtime error inside the preview reaches the
      // agent, any element in it can be pointed at, and the agent can measure it to
      // review its own change, while the user's source and their published build stay
      // exactly what they wrote.
      const overlaid = withPreviewProbe(withVisualEditor(withPreviewErrorReporter(mountContents)));

      // Instant preview first: served from memory, no install and no dev server.
      // Projects it cannot serve (a Node server) run their own `npm run dev` below.
      const instant = await startInstantPreview(overlaid);
      if (instant.kind === 'ready') {
        log.ok('instantPreviewReady');
        log.raw(`\x1b[36m${RUN_LOG_RULE}\x1b[0m\r\n\r\n`);
        setPreviewUrl(instant.url);
        live = true;
        return;
      }
      log.hint('instantPreviewDeclined', { reason: instant.reason });
      log.blank();

      log.step('stepMounting');
      await mountFiles(overlaid);
      log.ok('mounted', { count: Object.keys(mountContents).length });
      log.blank();

      setStep('installing');
      log.step('stepInstalling');
      // Tee the install output: the terminal shows it to a human, the tail is what
      // an agent needs to know WHY it failed.
      const installLog = teeOutput((data) => log.raw(data));
      const installCode = await ensureInstalled(mountContents, installLog.write, log);
      if (installCode !== 0) {
        log.error('installFailed', { code: installCode });
        recordBuildFailure(store.id, {
          source: 'build',
          command: 'npm install',
          exitCode: installCode,
          message: `npm install failed (exit ${installCode}).`,
          detail: installLog.text(),
        });
        return;
      }
      log.blank();
      log.ok('depsReady');
      log.blank();

      setStep('starting');
      log.step('startingDevServer');
      const url = await startDevServer((data) => log.raw(data));
      log.blank();
      log.ok('devServerReady', { url });
      log.raw(`\x1b[36m${RUN_LOG_RULE}\x1b[0m\r\n\r\n`);
      setPreviewUrl(url);
      live = true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('Run failed:', e);
      // Recorded BEFORE the terminal formatting below, so the agent's copy is the
      // raw message rather than whichever branch happened to render it.
      recordBuildFailure(store.id, {
        source: 'build',
        command: 'npm run dev',
        message: errorMsg.split('\n')[0] || 'The dev server failed to start.',
        detail: errorMsg,
      });

      // `Invalid package.json` is matched against the ENGLISH marker npm emits
      // (EJSONPARSE) as well as our own localized text, so the branch survives
      // translation of the message we throw ourselves.
      if (errorMsg.includes('EJSONPARSE') || errorMsg === t('runLog.invalidPackageJsonFix')) {
        log.errorBlock('packageJsonErrorTitle', ['packageJsonErrorBody', 'packageJsonErrorHint']);
        // The example is code, not prose — it is what must be typed, so it is
        // shown verbatim rather than translated.
        log.step('expectedFormat');
        log.raw('{\r\n  "name": "my-app",\r\n  "version": "1.0.0",\r\n  "scripts": { "dev": "vite" },\r\n  "dependencies": { ... }\r\n}\r\n');
      } else if (errorMsg.includes('output:')) {
        const outputMatch = errorMsg.match(/output:\n([\s\S]+)/);
        if (outputMatch) {
          log.errorBlock('devServerErrorTitle', []);
          log.raw(outputMatch[1]);
          log.raw(`\r\n\x1b[31m${RUN_LOG_RULE}\x1b[0m\r\n`);
        } else {
          log.error('errorPrefix', { message: errorMsg });
        }
      } else {
        log.error('errorPrefix', { message: errorMsg });
      }
    } finally {
      runningRef.current = false;
      setStep(null);
      setPhase(live ? 'live' : 'failed');
    }
  }, [startDevServer, startInstantPreview, mountFiles, assembleMountContents, ensureInstalled, log, checkResults, gateRunOnChecks, toast, t, tc, store.id]);

  /**
   * Build the project for publishing, in the browser: its files in, a static
   * site out (index.html, hashed assets, public/). No install and no dev server,
   * and the running preview is left alone. The base is relative, so the site
   * works at `<sub>.builderforce.ai/` and under the `/api/sites/<sub>/` path.
   */
  const publishBuild = useCallback(async (): Promise<Array<{ path: string; data: Uint8Array }>> => {
    sendWorkspaceCommand(store.id, { type: 'showPanel', panel: 'output' });
    publishLog.bannerInline('buildingForPublish');

    const mount = await assembleMountContents(publishLog);
    if (!mount) throw new Error(t('runLog.invalidPackageJsonFix'));

    // `npm run build` is the COMMAND this stands for — shown verbatim.
    publishLog.raw('\x1b[36mnpm run build…\x1b[0m\r\n');
    const assets = await buildSite(mount);
    if (assets.length === 0) {
      throw new Error(t('runLog.noDistOutput'));
    }
    publishLog.blank();
    publishLog.ok('capturedFiles', { count: assets.length });
    return assets;
  }, [assembleMountContents, publishLog, t, store.id]);

  /**
   * Check the project the way its own toolchain would: type-check and build
   * straight from the files (no install), then the project's `lint` script on
   * the Node runtime when it defines one. A run reads the result to gate (or
   * warn before) serving a broken preview; failures reach the agent.
   */
  const check = useCallback(async () => {
    if (isChecking || runningRef.current) return;
    setIsChecking(true);
    setCheckResults(null);
    try {
      log.bannerInline('runningChecks');
      const mount = await assembleMountContents(log);
      if (!mount) {
        setCheckResults([{ label: 'package.json', status: 'fail', detail: 'Invalid JSON' }]);
        return;
      }
      let scripts: Record<string, string> = {};
      try {
        scripts = (JSON.parse(mount['package.json'] ?? '{}') as { scripts?: Record<string, string> }).scripts ?? {};
      } catch { /* validated above */ }

      const { results, failures } = await runProjectChecks({
        typecheck: hasTypeScript(mount) ? () => typecheckFiles(mount) : null,
        build: () => buildSite(mount),
        lint: scripts['lint']
          ? async () => {
            await mountFiles(mount);
            const installLog = teeOutput((d) => log.raw(d));
            const installCode = await ensureInstalled(mount, installLog.write, log);
            if (installCode !== 0) return { step: 'npm install' as const, code: installCode, output: installLog.text() };
            const lintLog = teeOutput((d) => log.raw(d));
            return { step: 'lint' as const, code: await runCommandAndWait('npm', ['run', 'lint'], lintLog.write), output: lintLog.text() };
          }
          : null,
        // `label` names the step (type-check / build / lint) — an identifier, interpolated verbatim.
        onStep: (label) => log.section('checkStep', { label }),
        onOutput: (text) => log.raw(text),
      });
      for (const failure of failures) recordBuildFailure(store.id, failure);
      setCheckResults(results);
      const failed = results.filter(r => r.status === 'fail').length;
      if (failed === 0) {
        log.blank();
        log.ok('allChecksPassed');
      } else {
        log.error('checksFailed', { count: failed });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('checkError', { message: msg });
      setCheckResults([{ label: 'checks', status: 'fail', detail: msg }]);
      recordBuildFailure(store.id, { source: 'build', message: msg.split('\n')[0] || 'Checks failed.', detail: msg });
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, assembleMountContents, ensureInstalled, mountFiles, runCommandAndWait, log, store.id]);

  return {
    phase,
    step,
    previewUrl,
    run,
    check,
    publishBuild,
    isChecking,
    checkResults,
    gateRunOnChecks,
    setGateRunOnChecks,
    writePreviewFile,
    startShell,
  };
}

export type WorkspaceRun = ReturnType<typeof useWorkspaceRun>;
