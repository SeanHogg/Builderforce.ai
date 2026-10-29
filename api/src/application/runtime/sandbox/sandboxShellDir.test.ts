import { describe, expect, it } from 'vitest';
import { inSandboxDir, sandboxShell } from './sandboxProvider';
import type { RunSandbox } from './runSandbox';

/**
 * The shared tools hand a working directory to the shell as `ShellRunOptions.cwd` and never write
 * a `cd` into a command. The sandbox's exec API takes only a command line (a remote POSIX sh), so
 * ITS adapter — and only it — turns the directory into a prefix.
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
    return { sandbox, commands };
  }

  it('leaves the command alone with no directory (or the root)', () => {
    expect(inSandboxDir('npm test', undefined)).toBe('npm test');
    expect(inSandboxDir('npm test', '.')).toBe('npm test');
  });

  it('scopes a one-liner with a guarded cd, and a multi-line script with a leading guarded cd', () => {
    expect(inSandboxDir('npm test', 'app')).toBe('cd "app" && npm test');
    expect(inSandboxDir('set -e\nnpm test', 'app')).toBe('cd "app" || exit 1\nset -e\nnpm test');
  });

  it('runs a command given a cwd inside that directory, and one without as it was', async () => {
    const { sandbox, commands } = sandboxRecording();
    const shell = sandboxShell(sandbox, { heartbeat: async () => undefined });
    await shell.run('npm test', { cwd: 'app' });
    await shell.run('ls');
    expect(commands).toEqual(['cd "app" && npm test', 'ls']);
  });
});
