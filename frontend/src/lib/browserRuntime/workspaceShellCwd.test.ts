import { describe, expect, it, vi } from 'vitest';
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { createWorkspaceShell } from './workspaceShell';

/**
 * The shared tools hand a working directory to the shell as `ShellRunOptions.cwd`. The in-browser
 * runtime's `bfsh -c` takes only a command line, so this adapter writes it in with the shared
 * guarded leading line (`posixCommandIn`), and refuses an unsafe directory before it boots anything.
 */
function recordingRuntime() {
  const spawned: Array<{ command: string; args: string[] }> = [];
  const runtime = {
    fs: { list: () => [], readFile: () => undefined, rm: () => undefined },
    writeTree: () => undefined,
    exportZip: () => new Uint8Array([7]),
    importZip: () => undefined,
    run: (command: string, args: string[]) => {
      spawned.push({ command, args });
      return {
        pid: 1,
        combinedOutput: new ReadableStream<string>({ start: (c) => c.close() }),
        stdin: new WritableStream<string>(),
        wait: async () => 0,
        kill: () => undefined,
        resizeTerminal: () => undefined,
      };
    },
  } as unknown as PreviewRuntime;
  return { runtime, spawned };
}

const store = {
  id: 7,
  kind: 'server',
  list: async () => [],
  read: async () => '',
  write: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  search: async () => ({ matches: [], truncated: false }),
} as unknown as WorkspaceFileStore;

describe('createWorkspaceShell — the working directory', () => {
  it('runs a command in the named directory behind a guarded cd, and one without as it was', async () => {
    const { runtime, spawned } = recordingRuntime();
    const shell = createWorkspaceShell(store, { boot: async () => runtime });
    await shell.run('npm test', { cwd: 'app' });
    await shell.run('ls');
    expect(spawned.map((s) => s.args[1])).toEqual(['cd "./app" || exit 1\nnpm test', 'ls']);
  });

  it('refuses an unsafe directory without booting the runtime', async () => {
    const boot = vi.fn();
    const shell = createWorkspaceShell(store, { boot: boot as never });
    expect(await shell.run('ls', { cwd: '../x' })).toMatchObject({ ok: false, error: expect.stringContaining('not a directory inside the workspace') });
    expect(boot).not.toHaveBeenCalled();
  });
});
