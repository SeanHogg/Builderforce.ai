import { describe, expect, it } from 'vitest';
import { sandboxShell } from './sandboxProvider';
import type { RunSandbox } from './runSandbox';

/**
 * The shared tools hand a working directory to the shell as `ShellRunOptions.cwd` and never write
 * a `cd` into a command. The sandbox's exec API takes only a command line (a remote POSIX sh), so
 * ITS adapter turns the directory into the shared guarded leading line (`posixCommandIn`), and
 * refuses a directory that is not a safe workspace-relative one rather than run at the root.
 */
describe('the sandbox shell and a working directory', () => {
  function sandboxRecording() {
    const commands: string[] = [];
    const sandbox = {
      run: async (command: string) => {
        commands.push(command);
        return { ok: true, exitCode: 0, stdout: '' };
      },
    } as unknown as RunSandbox;
    return { shell: sandboxShell(sandbox, { heartbeat: async () => undefined }), commands };
  }

  it('runs a command given a cwd inside that directory behind a guarded cd, and one without as it was', async () => {
    const { shell, commands } = sandboxRecording();
    await shell.run('npm test', { cwd: 'app' });
    await shell.run('ls');
    await shell.run('ls', { cwd: '.' });
    expect(commands).toEqual(['cd -- "./app" || exit 1\nnpm test', 'ls', 'ls']);
  });

  it('refuses a directory that leaves the workspace or reads as an option, without running anything', async () => {
    const { shell, commands } = sandboxRecording();
    for (const cwd of ['../x', '/etc', '-L', 'a;rm -rf /']) {
      expect(await shell.run('ls', { cwd })).toMatchObject({ ok: false, error: expect.stringContaining('not a directory inside the workspace') });
    }
    expect(commands).toEqual([]);
  });
});
