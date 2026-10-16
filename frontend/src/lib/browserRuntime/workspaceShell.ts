/**
 * A real shell for the web Brain: run ONE command line (`npm install`, `npm test`,
 * `npx tsc --noEmit`, `npm run build`) against a workspace's files, in OUR in-browser
 * runtime — the shared instance the preview runs on (`previewRuntime.ts`).
 *
 * The VS Code extension and the cloud Container back `run_command` with a real OS
 * shell; the web Brain could only read and write files, so "does it build?" had no
 * answer short of asking the person to press Run. This is the same capability
 * (`ShellCapability` from `@builderforce/agent-tools`) over the browser runtime, so the
 * shared `run_command` definition runs here unchanged.
 *
 * ── ONE RUN ──────────────────────────────────────────────────────────────────────
 * 1. Mount the store's files (keeping `node_modules`, so an unchanged manifest does
 *    not reinstall) and snapshot exactly what was mounted.
 * 2. `jsh -c "<line>"` — the runtime's shell runs one line non-interactively
 *    (`builderforce-webcontainers` packages/core/src/shell/program.ts:204, the same
 *    form its `child_process` `shell: true` uses, packages/core/src/node/childProcess.ts:71),
 *    so pipes, `&&` and quoting behave as they would in a terminal.
 * 3. Save back what the command changed — written, created or deleted source files,
 *    never dependencies or build output — so a codemod, a formatter or
 *    `npm install <pkg>` updating `package.json` reaches the workspace like an edit.
 *
 * ── DECLINES ARE ANSWERS ─────────────────────────────────────────────────────────
 * A runtime that cannot boot (no service worker, the relay unreachable) is reported as
 * `{ ok: false, error }` the model can read and relay; nothing here throws.
 */
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import type { ShellCapability, ShellResult } from '@builderforce/agent-tools';
import { validateFileContentForPath } from '@builderforce/ide-file-contract';
import { isGeneratedPath } from '@/lib/workspace/generatedPaths';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { readStoreFiles } from '@/lib/workspace/readStoreFiles';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { bootSharedPreviewRuntime, replaceProjectFiles } from './previewRuntime';

/** Default ceiling for one command: an install of a mid-sized app fits; a dev server never ends. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

/** Output handed back to the model: the TAIL, where the error and the exit summary are. */
export const MAX_COMMAND_OUTPUT_CHARS = 16_000;

/** A file the command produced that is bigger than this is not source; it is not saved back. */
export const MAX_SAVED_FILE_CHARS = 1_000_000;

/** How long a killed process gets to exit before it is forced, and the output stream to close. */
const SETTLE_MS = 2_000;

/** What one run reports beyond the shared {@link ShellResult}: the files it saved back. */
export interface WorkspaceShellResult extends ShellResult {
  /** Files the command created or changed, now saved to the workspace. */
  changedFiles?: string[];
  /** Files the command deleted, now removed from the workspace. */
  removedFiles?: string[];
  /** Files the command changed that were NOT saved, and why. */
  unsavedFiles?: Array<{ path: string; reason: string }>;
  timedOut?: boolean;
}

export interface WorkspaceShellDeps {
  /** The runtime to run in. Default: the page's shared preview runtime. */
  boot?: () => Promise<PreviewRuntime>;
  timeoutMs?: number;
  /** Told which paths a run saved back, so an open editor re-reads them. */
  onFilesChanged?: (workspaceId: WorkspaceId, paths: string[]) => void;
}

/**
 * One command at a time on the page. The runtime is a page singleton and every run
 * REPLACES its project files, so two overlapping runs (two builds on one board) would
 * each run against the other's tree.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/** `value`, or undefined once `ms` passes first. */
async function settle<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Collect a stream into a bounded tail buffer. Resolves when the stream closes. */
function collectTail(output: ReadableStream<string>): { done: Promise<void>; text: () => { text: string; truncated: boolean } } {
  let buffer = '';
  let dropped = false;
  const reader = output.getReader();
  const done = (async () => {
    try {
      for (;;) {
        const { done: closed, value } = await reader.read();
        if (closed) return;
        buffer += value;
        // Trim in chunks rather than per write, so a chatty install is not O(n²).
        if (buffer.length > MAX_COMMAND_OUTPUT_CHARS * 2) {
          buffer = buffer.slice(-MAX_COMMAND_OUTPUT_CHARS);
          dropped = true;
        }
      }
    } catch {
      /* a killed process may error its stream; what arrived is still the answer */
    }
  })();
  return {
    done,
    text: () => {
      const truncated = dropped || buffer.length > MAX_COMMAND_OUTPUT_CHARS;
      return { text: buffer.slice(-MAX_COMMAND_OUTPUT_CHARS), truncated };
    },
  };
}

/** Why a file the command wrote is not saved back, or null when it should be. */
function unsavable(path: string, content: string | Uint8Array): string | null {
  if (typeof content !== 'string' || content.includes('\u0000')) return 'binary file';
  if (content.length > MAX_SAVED_FILE_CHARS) return 'larger than 1 MB';
  const valid = validateFileContentForPath(path, content);
  return valid.ok ? null : valid.reason;
}

/** Write what the command changed back to the store. */
async function saveBack(
  runtime: PreviewRuntime,
  store: WorkspaceFileStore,
  mounted: Record<string, string>,
): Promise<Pick<WorkspaceShellResult, 'changedFiles' | 'removedFiles' | 'unsavedFiles'>> {
  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  const unsavedFiles: Array<{ path: string; reason: string }> = [];
  const present = new Set<string>();

  for (const absolute of runtime.fs.list()) {
    const path = absolute.replace(/^\/+/, '');
    if (isGeneratedPath(path)) continue;
    present.add(path);
    const content = runtime.fs.readFile(absolute);
    if (content === undefined || content === mounted[path]) continue;
    const reason = unsavable(path, content);
    if (reason) {
      unsavedFiles.push({ path, reason });
      continue;
    }
    try {
      await store.write(path, content as string);
      changedFiles.push(path);
    } catch (error) {
      unsavedFiles.push({ path, reason: toolErrorMessage(error, 'the save failed') });
    }
  }
  for (const path of Object.keys(mounted)) {
    if (present.has(path) || isGeneratedPath(path)) continue;
    try {
      await store.remove(path);
      removedFiles.push(path);
    } catch (error) {
      unsavedFiles.push({ path, reason: `deleted by the command, but ${toolErrorMessage(error, 'the delete failed')}` });
    }
  }
  return {
    ...(changedFiles.length ? { changedFiles } : {}),
    ...(removedFiles.length ? { removedFiles } : {}),
    ...(unsavedFiles.length ? { unsavedFiles } : {}),
  };
}

/** Run one command line to completion (or the timeout) and report it. */
async function runInRuntime(
  runtime: PreviewRuntime,
  command: string,
  timeoutMs: number,
): Promise<{ exitCode: number | undefined; timedOut: boolean; stdout: string }> {
  const child = runtime.spawn('jsh', ['-c', command]);
  const output = collectTail(child.output);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  const outcome = await Promise.race([child.exit, timeout]);
  clearTimeout(timer);

  let exitCode: number | undefined;
  const timedOut = outcome === 'timeout';
  if (timedOut) {
    child.kill();
    exitCode = await settle(child.exit, SETTLE_MS);
    if (exitCode === undefined) {
      child.kill('SIGKILL');
      exitCode = await settle(child.exit, SETTLE_MS);
    }
  } else {
    exitCode = outcome;
  }
  await settle(output.done, SETTLE_MS);
  const { text, truncated } = output.text();
  return { exitCode, timedOut, stdout: truncated ? `[… earlier output truncated; showing the last ${MAX_COMMAND_OUTPUT_CHARS} characters]\n${text}` : text };
}

/**
 * The browser runtime as a {@link ShellCapability} over one workspace's files.
 */
export function createWorkspaceShell(store: WorkspaceFileStore, deps: WorkspaceShellDeps = {}): ShellCapability {
  const boot = deps.boot ?? bootSharedPreviewRuntime;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  const run = async (command: string): Promise<WorkspaceShellResult> => {
    let runtime: PreviewRuntime;
    try {
      runtime = await boot();
    } catch (error) {
      return { ok: false, error: `The in-browser runtime is unavailable: ${toolErrorMessage(error, 'it could not start in this browser')}` };
    }

    let mounted: Record<string, string>;
    try {
      mounted = await readStoreFiles(store);
      replaceProjectFiles(runtime, mounted);
    } catch (error) {
      return { ok: false, error: `The workspace files could not be loaded into the runtime: ${toolErrorMessage(error, 'the read failed')}` };
    }

    let ran: Awaited<ReturnType<typeof runInRuntime>>;
    try {
      ran = await runInRuntime(runtime, command, timeoutMs);
    } catch (error) {
      return { ok: false, error: `The command could not be started: ${toolErrorMessage(error, 'spawn failed')}` };
    }

    // Saved back even after a failure or a timeout: a half-finished codemod's edits are
    // real, and the model is told exactly which files moved either way.
    const saved = await saveBack(runtime, store, mounted);
    const touched = [...(saved.changedFiles ?? []), ...(saved.removedFiles ?? [])];
    if (touched.length) deps.onFilesChanged?.(store.id, touched);

    const ok = !ran.timedOut && ran.exitCode === 0;
    const error = ran.timedOut
      ? `Timed out after ${Math.round(timeoutMs / 1000)}s and was stopped. A long-running process (a dev server, a watcher) never finishes here — the live preview already runs the app.`
      : ok ? undefined : `Exited with code ${ran.exitCode}.`;
    return {
      ok,
      stdout: ran.stdout,
      ...(ran.exitCode !== undefined ? { exitCode: ran.exitCode } : {}),
      ...(error ? { error } : {}),
      ...(ran.timedOut ? { timedOut: true } : {}),
      ...saved,
    };
  };

  return { run: (command) => serialized(() => run(command)) };
}
