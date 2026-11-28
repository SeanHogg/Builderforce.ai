import { afterEach, describe, expect, it, vi } from 'vitest';

const { run, start, poll, kill } = vi.hoisted(() => ({ run: vi.fn(), start: vi.fn(), poll: vi.fn(), kill: vi.fn() }));

vi.mock('@/lib/browserRuntime/workspaceShell', () => ({
  createWorkspaceShell: () => ({ run, start, poll, kill }),
}));

import { canvasBuildCommandActions } from './canvasBuildCommandAction';
import { clearBuildFailures, formatBuildFailures } from './buildDiagnostics';
import type { BoundCanvasBuild } from './canvasBuildTools';
import { serverFileStore } from './workspace/workspaceFileStore';

const STORE_ID = 901;

function actions(confirmShellCommand?: (command: string) => Promise<boolean>) {
  const build: BoundCanvasBuild = {
    objectId: 'obj-1',
    title: 'App',
    modality: 'designer',
    store: serverFileStore(STORE_ID),
  };
  return canvasBuildCommandActions({ confirmShellCommand }, () => ({ build }));
}

const action = () => actions()[0]!;

afterEach(() => {
  run.mockReset();
  start.mockReset();
  poll.mockReset();
  kill.mockReset();
  clearBuildFailures(STORE_ID);
});

it('runs, checks and stops a background command through the canvas actions', async () => {
  const [command, status, stop] = actions();
  start.mockResolvedValue({ ok: true, id: 'job-1' });
  poll.mockResolvedValue({ ok: true, id: 'job-1', status: 'running', output: 'building' });
  kill.mockResolvedValue({ ok: false, id: 'job-1', status: 'killed' });

  expect(await command!.run({ command: 'npm test', background: true }))
    .toMatchObject({ ok: true, id: 'job-1', note: expect.stringContaining(status!.name) });
  expect(await status!.run({ id: 'job-1' })).toMatchObject({ ok: true, status: 'running', output: 'building' });
  expect(await stop!.run({ id: 'job-1' })).toMatchObject({ ok: false, status: 'killed', code: 'aborted' });
});

it('runs destructive workspace commands only after the host confirms', async () => {
  const command = 'git reset --hard';
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const [shell] = actions(confirm);
  run.mockResolvedValue({ ok: true, exitCode: 0 });

  expect(await shell!.run({ command })).toMatchObject({ ok: false, code: 'refused' });
  expect(run).not.toHaveBeenCalled();
  expect(await shell!.run({ command })).toMatchObject({ ok: true });
  expect(confirm).toHaveBeenCalledWith(command);
  expect(run).toHaveBeenCalledOnce();
});

describe('canvas_run_build_command diagnostics', () => {
  it('records a failed command so canvas_read_build_diagnostics can see it', async () => {
    run.mockResolvedValue({
      ok: false,
      exitCode: 127,
      stdout: 'bfsh: command not found: vite\n',
      error: 'Exited with code 127.',
    });

    const result = await action().run({ command: 'npm run build' });

    expect(result).toMatchObject({ ok: false, exitCode: 127 });
    const report = formatBuildFailures(STORE_ID);
    expect(report.current.count).toBe(1);
    expect(report.current.report).toContain('npm run build');
    expect(report.current.report).toContain('exit 127');
    expect(report.current.report).toContain('command not found: vite');
  });

  it('records a timeout, which is how a dev server is stopped', async () => {
    run.mockResolvedValue({
      ok: false,
      exitCode: 130,
      stdout: 'VITE ready\n',
      error: 'Timed out after 300s and was stopped.',
      timedOut: true,
    });

    await action().run({ command: 'npm run dev' });

    const report = formatBuildFailures(STORE_ID);
    expect(report.current.count).toBe(1);
    expect(report.current.report).toContain('Timed out after 300s');
    expect(report.current.report).toContain('exit 130');
  });

  it('does not record a command that exited 0', async () => {
    run.mockResolvedValue({ ok: true, exitCode: 0, stdout: 'built\n' });

    await action().run({ command: 'npm run build' });

    expect(formatBuildFailures(STORE_ID).current.count).toBe(0);
    expect(formatBuildFailures(STORE_ID).stale.count).toBe(0);
  });

  it('does not record a blank command the shell never started', async () => {
    const result = await action().run({ command: '   ' });

    expect(result).toMatchObject({ ok: false, error: 'command is required' });
    expect(run).not.toHaveBeenCalled();
    expect(formatBuildFailures(STORE_ID).current.count).toBe(0);
  });

  it('records a failure that never started a process', async () => {
    run.mockResolvedValue({
      ok: false,
      error: 'The workspace files could not be loaded into the runtime: the read failed',
    });

    await action().run({ command: 'npm test' });

    expect(formatBuildFailures(STORE_ID).current.report).toContain('could not be loaded');
  });

  it('records when the shell throws before returning a result', async () => {
    run.mockRejectedValue(new Error('runtime boot failed'));

    const result = await action().run({ command: 'npm test' });

    expect(result).toMatchObject({ ok: false });
    expect(formatBuildFailures(STORE_ID).current.report).toContain('runtime boot failed');
  });
});
