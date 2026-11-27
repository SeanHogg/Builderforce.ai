/**
 * A cloud run's {@link CapabilityProvider} with its sandbox behind it — the ONE place the
 * shared tool definitions meet the sandbox's primitives.
 *
 * The tools do not change: `read_file`, `list_files`, `edit_file`, `run_command`, the
 * `git_*` set and `analyze_codebase` are the shared definitions every surface runs. Only
 * their backing does:
 *
 *   • `shell` — `run_command` and the git tools run in the clone. A long command beats
 *     the run's heartbeat so the reaper never takes a build for a silent run, and the
 *     run's cancel signal kills it. A sandbox with jobs (`shell.jobs`) also starts,
 *     polls and kills BACKGROUND commands (`run_command` background / `yieldMs`,
 *     `command_status`, `command_stop`) — the job table is the sandbox's, so a job
 *     started on one tick is pollable on the next. The shell names the ticket branch it mirrors
 *     (`trackedBranch`), so `git_sync_latest` / `git_undo` / `git_redo` publish to it.
 *   • `repoRead.listFiles` / `readFile` — the working tree, so a file a command generated
 *     is readable; the provider's own (git API) read when the sandbox cannot answer.
 *     `searchCode` stays on the provider's own backing.
 *   • `repoWrite` — the commit stays the provider's (lease, outbound inspection, the
 *     file-change ledger, notifications): the sandbox then ABSORBS the committed change
 *     (fast-forwarding the clone to the ticket branch), so the shell builds against what
 *     the branch holds and the git tools see the commit as history. `editFile` is the
 *     provider's own edit of the BRANCH (so a stale clone can never revert another commit
 *     to that file); only a file a command produced and the branch lacks falls back to the
 *     same shared edit core over the working tree, committed via `writeFile`.
 */
import { posixCommandIn, type Capability, type CapabilityProvider, type RepoEditResult, type ShellCapability, type ShellRunOptions } from '@builderforce/agent-tools';
import { createRepoCapabilities, WorkspaceError, type WorkspaceFs } from '@builderforce/agent-tools/workspace';
import type { RunSandbox } from './runSandbox';
import { SANDBOX_COMMAND_HEARTBEAT_MS } from '../cloudAgent/runContext';
import { reportedFallback } from '../../observability/caughtErrorReporter';

export interface SandboxProviderOptions {
  /** The run's cancel signal — aborting it kills the running command. */
  signal?: AbortSignal;
  /** Prove the run alive while a long command runs. Throttled by the caller. */
  heartbeat: () => Promise<unknown>;
  /** The ticket branch the clone mirrors (the provider commits to it). */
  trackedBranch?: string;
}

/**
 * The sandbox's shell as the run sees it: a long command (or a wait on a job) beats the
 * heartbeat, the run's cancel kills it, and `timeoutMs` bounds it. Shared by the tools
 * (`withSandbox`) and the run-end verify, so neither can run a command the reaper takes
 * for a silent run.
 */
export function sandboxShell(sandbox: RunSandbox, opts: SandboxProviderOptions): ShellCapability & { runFor(command: string, timeoutMs: number): ReturnType<ShellCapability['run']> } {
  const beating = async <T>(work: () => Promise<T>): Promise<T> => {
    const beat = setInterval(() => { void opts.heartbeat().catch(reportedFallback(undefined, { source: 'application/runtime/sandbox/sandboxProvider.ts', operation: 'commandHeartbeat' })); }, SANDBOX_COMMAND_HEARTBEAT_MS);
    try {
      return await work();
    } finally {
      clearInterval(beat);
    }
  };
  const runFor = (command: string, timeoutMs?: number) => beating(() => sandbox.run(command, opts.signal, timeoutMs));
  const jobs = sandbox.jobs;
  return {
    // The sandbox's exec API takes only a command line (a remote POSIX sh), so the working
    // directory the shared tools hand over (`ShellRunOptions.cwd`) is written in by the ONE
    // shared helper — and a directory that is not a safe workspace-relative one is refused.
    run: async (command, runOpts) => {
      const scoped = posixCommandIn(runOpts?.cwd, command);
      return scoped === null ? { ok: false, error: `'${runOpts?.cwd}' is not a directory inside the workspace, so no command was run there` } : runFor(scoped);
    },
    runFor,
    // A background job is the RUN's, not the call's: the sandbox keeps it across ticks and
    // kills it when the run closes, so only a wait (never the job) follows the call's signal.
    ...(jobs ? {
      start: (command: string, runOpts?: ShellRunOptions) => jobs.start(command, runOpts?.cwd),
      poll: (id: string, pollOpts?: { waitMs?: number; signal?: AbortSignal }) => beating(() => jobs.poll(id, pollOpts)),
      kill: (id: string) => jobs.kill(id),
    } : {}),
    ...(opts.trackedBranch ? { trackedBranch: opts.trackedBranch } : {}),
    // The clone has no credential: the sandbox does the remote half of git_sync_latest / git_undo / git_redo for the tracked branch.
    ...(opts.trackedBranch && sandbox.git ? { git: sandbox.git } : {}),
  };
}

/** The capability the sandbox adds to a run's set. */
export const SANDBOX_CAPABILITIES: readonly Capability[] = ['shell'];
/** What a sandbox with a job table adds on top (`command_status` / `command_stop`). */
export const SANDBOX_JOB_CAPABILITIES: readonly Capability[] = ['shell.jobs'];

/** The clone's working tree as a `WorkspaceFs` for ONE edit: it reads the tree and commits through `commit`. */
function workingTreeFs(sandbox: RunSandbox, commit: (path: string, content: string) => Promise<void>): WorkspaceFs {
  return {
    async *list() { /* an edit never lists */ },
    read: async (path) => {
      const r = await sandbox.fs({ op: 'read', path });
      return r.ok && typeof r.content === 'string' ? { status: 'ok', content: r.content, truncated: false } : { status: 'not_found' };
    },
    write: commit,
    remove: async () => 'missing',
  };
}

export function withSandbox(base: CapabilityProvider, sandbox: RunSandbox, opts: SandboxProviderOptions): CapabilityProvider {
  const mirror = (req: Parameters<RunSandbox['fs']>[0]) => sandbox.fs(req).catch(reportedFallback(undefined, { source: 'application/runtime/sandbox/sandboxProvider.ts', operation: 'mirrorToWorkingTree', context: { op: req.op } }));
  const repoRead = base.repoRead;
  const repoWrite = base.repoWrite;
  return {
    ...base,
    capabilities: new Set<Capability>([...base.capabilities, ...SANDBOX_CAPABILITIES, ...(sandbox.jobs ? SANDBOX_JOB_CAPABILITIES : [])]),
    shell: sandboxShell(sandbox, opts),
    ...(repoRead ? {
      repoRead: {
        listFiles: async (subdir, glob) => {
          const r = await sandbox.fs({ op: 'list', ...(subdir ? { path: subdir } : {}), ...(glob ? { glob } : {}) });
          return r.ok
            ? { ok: true, paths: r.paths ?? [], ...(r.truncated ? { truncated: true } : {}), ...(r.note ? { note: r.note } : {}) }
            : repoRead.listFiles(subdir, glob);
        },
        readFile: async (path) => {
          const r = await sandbox.fs({ op: 'read', path });
          return r.ok ? { ok: true, path, content: r.content ?? '' } : repoRead.readFile(path);
        },
        searchCode: (query, scope) => repoRead.searchCode(query, scope),
      },
    } : {}),
    ...(repoWrite ? {
      repoWrite: {
        writeFile: async (path, content, summary) => {
          const r = await repoWrite.writeFile(path, content, summary);
          if (r.ok) await mirror({ op: 'write', path, content, committed: true });
          return r;
        },
        deleteFile: async (path, reason) => {
          const r = await repoWrite.deleteFile(path, reason);
          if (r.ok) await mirror({ op: 'delete', path, committed: true });
          return r;
        },
        editFile: async (path, oldString, newString, replaceAll): Promise<RepoEditResult> => {
          // The provider edits what the BRANCH holds and commits it (a stale clone can never revert another commit)...
          const r = await repoWrite.editFile(path, oldString, newString, replaceAll);
          if (r.ok) {
            const left = await repoRead?.readFile(path).catch(reportedFallback(null, { source: 'application/runtime/sandbox/sandboxProvider.ts', operation: 'readCommittedEdit', context: { path } }));
            if (left?.ok && typeof left.content === 'string') await mirror({ op: 'write', path, content: left.content, committed: true });
            return r;
          }
          // ...and a file only a command produced is not on the branch yet: the same shared edit core over the working tree, committed through `writeFile`.
          if (r.code !== 'not_found') return r;
          let committedContent = '';
          const viaTree = createRepoCapabilities(workingTreeFs(sandbox, async (p, c) => {
            const w = await repoWrite.writeFile(p, c);
            if (!w.ok) throw new WorkspaceError('io', w.error ?? `could not commit the edit to '${p}'`);
            committedContent = c;
          })).repoWrite;
          const edited = await viaTree.editFile(path, oldString, newString, replaceAll);
          if (edited.ok) await mirror({ op: 'write', path, content: committedContent, committed: true });
          return edited.ok ? edited : { ...edited, error: `cannot edit '${path}': ${edited.error}` };
        },
      },
    } : {}),
  };
}
