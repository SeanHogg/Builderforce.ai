import { describe, expect, it } from 'vitest';
import { buildCoreToolRegistry } from './core-tools.js';
import type { ShellCapability } from './capabilities.js';
import type { ToolContext } from './tool.js';

export const shellConformanceCommands = {
  success: 'echo conformance-ok',
  failure: 'exit 7',
  long: 'node -e "setTimeout(function () {}, 60000)"',
  large: 'node -e "process.stdout.write(\'conformance-head\\n\' + \'x\'.repeat(300000) + \'\\nconformance-tail\')"',
} as const;

/** Assert the public tool contract through a host's normal shell capability. */
export function runShellConformance(name: string, makeShell: () => ShellCapability, skip = false) {
  const registry = buildCoreToolRegistry();
  const call = async (shell: ShellCapability, name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    const ctx: ToolContext = { caps: { capabilities: new Set(['shell', 'shell.jobs']), shell }, signal };
    return (await registry.dispatch(name, args, ctx)).data as Record<string, unknown>;
  };
  describe.skipIf(skip)(`shell conformance - ${name}`, () => {
    it('reports success, a nonzero exit, and invalid working directories', async () => {
      const shell = makeShell();
      expect(await call(shell, 'run_command', { command: shellConformanceCommands.success }))
        .toMatchObject({ ok: true, exitCode: 0, stdout: expect.stringContaining('conformance-ok') });
      expect(await call(shell, 'run_command', { command: shellConformanceCommands.failure }))
        .toMatchObject({ ok: false, exitCode: 7, code: 'command_failed' });
      expect(await call(shell, 'run_command', { command: shellConformanceCommands.success, cwd: '../outside' }))
        .toMatchObject({ ok: false, code: 'invalid' });
    });

    it('reports a completed background command with retained output', async () => {
      const shell = makeShell();
      const result = await call(shell, 'run_command', { command: shellConformanceCommands.success, background: true });
      expect(result).toMatchObject({ ok: true, status: 'running', id: expect.any(String) });
      expect(await call(shell, 'command_status', { id: result.id, waitMs: 5_000 }))
        .toMatchObject({ ok: true, status: 'exited', exitCode: 0, output: expect.stringContaining('conformance-ok') });
    }, 10_000);

    it('bounds captured output and returns part of the command log', async () => {
      const result = await call(makeShell(), 'run_command', { command: shellConformanceCommands.large });
      expect(result.ok).toBe(true);
      const stdout = String(result.stdout);
      expect(stdout.length).toBeLessThan(300_000);
      expect(/conformance-(head|tail)/.test(stdout)).toBe(true);
    }, 10_000);

    it('leaves a job running after an interrupted wait and reports stop and unknown status', async () => {
      const shell = makeShell();
      const result = await call(shell, 'run_command', { command: shellConformanceCommands.long, background: true });
      expect(result).toMatchObject({ ok: true, status: 'running', id: expect.any(String) });
      const signal = AbortSignal.abort();
      try {
        expect(await call(shell, 'command_status', { id: result.id, waitMs: 5_000 }, signal))
          .toMatchObject({ ok: true, status: 'running' });
      } finally {
        expect(await call(shell, 'command_stop', { id: result.id }))
          .toMatchObject({ ok: false, status: 'killed', code: 'aborted' });
      }
      expect(await call(shell, 'command_status', { id: 'job-conformance-missing' }))
        .toMatchObject({ ok: false, status: 'unknown', code: 'not_found' });
    }, 10_000);
  });
}
