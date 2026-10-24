/**
 * The run-end verify in the sandbox: the project's OWN declared checks, run over the
 * clone, with honest exit codes — ported from the container image's own run tail.
 */
import { describe, expect, it, vi } from 'vitest';
import { runSandboxVerify } from './sandboxVerify';
import type { RunSandbox, SandboxFsRequest } from './runSandbox';

function sandbox(opts: { packageJson?: string; lockfiles?: string[]; exitCodes?: Record<string, number | undefined> }): RunSandbox & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    fs: vi.fn(async (req: SandboxFsRequest) => {
      if (req.op === 'read') return opts.packageJson !== undefined && req.path === 'package.json' ? { ok: true, content: opts.packageJson } : { ok: false, error: 'ENOENT' };
      if (req.op === 'list') {
        const glob = req.glob ?? '';
        // A slash-free glob matches the basename at ANY depth — only a root hit names the runner.
        return { ok: true, paths: (opts.lockfiles ?? []).filter((p) => p.endsWith(glob)) };
      }
      return { ok: true };
    }),
    run: vi.fn(async (command: string) => {
      commands.push(command);
      const code = opts.exitCodes?.[command];
      return code === undefined ? { ok: false, error: 'could not launch' } : { ok: code === 0, exitCode: code, stdout: '' };
    }),
    checks: async () => null,
    close: async () => undefined,
  };
}

const SCRIPTS = JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest run', build: 'tsc' } });

describe('runSandboxVerify', () => {
  it('reads the declared scripts from the clone and runs the planned checks', async () => {
    const s = sandbox({ packageJson: SCRIPTS, exitCodes: { 'npm run typecheck': 0, 'npm run test': 1 } });
    const r = await runSandboxVerify(s);
    expect(r.packageScripts).toMatchObject({ typecheck: 'tsc --noEmit', test: 'vitest run' });
    expect(r.runner).toBe('npm');
    expect(r.results).toEqual([{ command: 'npm run typecheck', exitCode: 0 }, { command: 'npm run test', exitCode: 1 }]);
    // `build` is not a verify script: nothing invents a check the planner did not plan.
    expect(s.commands).toEqual(['npm run typecheck', 'npm run test']);
  });

  it('runs the checks with the package manager the root lockfile names', async () => {
    const s = sandbox({ packageJson: SCRIPTS, lockfiles: ['pnpm-lock.yaml'], exitCodes: { 'pnpm run typecheck': 0, 'pnpm run test': 0 } });
    const r = await runSandboxVerify(s);
    expect(r.runner).toBe('pnpm');
    expect(s.commands).toEqual(['pnpm run typecheck', 'pnpm run test']);
  });

  it('a nested lockfile does not decide the root runner', async () => {
    const s = sandbox({ packageJson: SCRIPTS, lockfiles: ['packages/x/yarn.lock'], exitCodes: { 'npm run typecheck': 0, 'npm run test': 0 } });
    expect((await runSandboxVerify(s)).runner).toBe('npm');
  });

  it('a command that could not launch is a failure, never a pass', async () => {
    const s = sandbox({ packageJson: JSON.stringify({ scripts: { test: 'vitest run' } }) });
    expect((await runSandboxVerify(s)).results).toEqual([{ command: 'npm run test', exitCode: 1 }]);
  });

  it('runs nothing when the repo declares no checks (or has no readable manifest)', async () => {
    for (const packageJson of [undefined, 'not json', JSON.stringify({ scripts: { build: 'tsc' } })]) {
      const s = sandbox({ ...(packageJson !== undefined ? { packageJson } : {}) });
      const r = await runSandboxVerify(s);
      expect(r.results).toEqual([]);
      expect(s.commands).toEqual([]);
    }
  });
});
