import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainRunSteering, hasRunInterrupt, queueRunSteering, resetRunSteering } from '../runSteering';
import { INTERRUPTED_BY_STEER, SKIPPED_BY_STEER, WAIT_INTERRUPTED_BY_STEER, isInterruptibleCall, runToolInterruptibly, skipOnSteer } from './steerInterrupt';

/** A tool that runs until its signal aborts, then reports it was stopped. */
function longTool() {
  return vi.fn((_name: string, _args: unknown, signal?: AbortSignal) => new Promise<unknown>((resolve) => {
    signal?.addEventListener('abort', () => resolve({ ok: false, aborted: true, stdout: 'partial' }), { once: true });
  }));
}

beforeEach(() => resetRunSteering());

describe('a steer interrupts the step in flight (PRD 35 E10)', () => {
  it('a foreground run_command and a wait on a job are interruptible', () => {
    expect(isInterruptibleCall('run_command', { command: 'npm test' })).toBe(true);
    expect(isInterruptibleCall('run_command', { command: 'npm run dev', background: true })).toBe(false);
    // A yieldMs window is a WAIT on the job — the wait is interruptible, the job is not.
    expect(isInterruptibleCall('run_command', { command: 'npm test', yieldMs: 5000 })).toBe(true);
    expect(isInterruptibleCall('command_status', { id: 'job-1', waitMs: 60000 })).toBe(true);
    expect(isInterruptibleCall('command_status', { id: 'job-1' })).toBe(false);
    expect(isInterruptibleCall('spawn_agent', {})).toBe(false);
  });

  it('calls any other tool exactly as before — two arguments, no signal', async () => {
    const runTool = vi.fn(async () => ({ ok: true }));
    await runToolInterruptibly(runTool, 1, new AbortController().signal, 'read_file', { path: 'a.ts' });
    expect(runTool).toHaveBeenCalledWith('read_file', { path: 'a.ts' });
  });

  it("the person's message aborts the command and the result says it was interrupted", async () => {
    const runTool = longTool();
    const pending = runToolInterruptibly(runTool, 7, new AbortController().signal, 'run_command', { command: 'npm test' });
    queueRunSteering(7, 'write the update now', { interrupt: true });
    const out = (await pending) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, aborted: true, interrupted: true, error: INTERRUPTED_BY_STEER, stdout: 'partial' });
    expect(hasRunInterrupt(7)).toBe(true);
    expect(drainRunSteering(7)).toEqual(['write the update now']);
    expect(hasRunInterrupt(7)).toBe(false);
  });

  it('a child report queued for the run does NOT interrupt it', async () => {
    let settled = false;
    const runTool = vi.fn((_n: string, _a: unknown, signal?: AbortSignal) => new Promise<unknown>((resolve) => {
      signal?.addEventListener('abort', () => resolve({ aborted: true }), { once: true });
      setTimeout(() => resolve({ ok: true }), 30);
    }));
    const pending = runToolInterruptibly(runTool, 8, undefined, 'run_command', { command: 'npm test' }).then((r) => { settled = true; return r; });
    queueRunSteering(8, 'Ada finished the schema');
    expect(settled).toBe(false);
    expect(await pending).toEqual({ ok: true });
  });

  it("the run's Stop aborts the command's step signal too", async () => {
    const runTool = longTool();
    const run = new AbortController();
    const pending = runToolInterruptibly(runTool, 9, run.signal, 'run_command', { command: 'npm test' });
    run.abort();
    expect(await pending).toMatchObject({ aborted: true });
    expect((await pending as Record<string, unknown>).interrupted).toBeUndefined();
  });

  it('skips the rest of the turn once an interrupting message waits', async () => {
    const inner = vi.fn(() => undefined);
    const hook = skipOnSteer(3, inner);
    const args = [{ id: 'c1', name: 'run_command', args: {} }, { data: {} }, {}, {}] as unknown as Parameters<typeof hook>;
    expect(await hook(...args)).toBeUndefined();
    queueRunSteering(3, 'stop that and do X', { interrupt: true });
    expect(await hook(...args)).toEqual({ skipRemaining: { data: { ok: false, skipped: true, error: SKIPPED_BY_STEER }, isError: false } });
  });
});

describe('a steer and the step it would interrupt — the edges', () => {
  it('a message already waiting means the command is never started', async () => {
    const runTool = vi.fn(async () => ({ ok: true }));
    queueRunSteering(21, 'actually, write the update first', { interrupt: true });
    const out = (await runToolInterruptibly(runTool, 21, undefined, 'run_command', { command: 'npm test' })) as Record<string, unknown>;
    expect(runTool).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, aborted: true, interrupted: true, error: INTERRUPTED_BY_STEER });
  });

  it('a command that FINISHED as the message arrived keeps its real result', async () => {
    const runTool = vi.fn(async (_n: string, _a: unknown, _s?: AbortSignal) => {
      queueRunSteering(22, 'next, do X', { interrupt: true });
      return { ok: true, exitCode: 0, stdout: '12 passed' };
    });
    const out = await runToolInterruptibly(runTool, 22, undefined, 'run_command', { command: 'npm test' });
    expect(out).toEqual({ ok: true, exitCode: 0, stdout: '12 passed' });
  });

  it('an interrupted command_status wait returns the status so far; the job runs on', async () => {
    const runTool = vi.fn((_n: string, _a: unknown, signal?: AbortSignal) => new Promise<unknown>((resolve) => {
      signal?.addEventListener('abort', () => resolve({ ok: true, id: 'job-1', status: 'running', output: 'half' }), { once: true });
    }));
    const pending = runToolInterruptibly(runTool, 23, undefined, 'command_status', { id: 'job-1', waitMs: 600000 });
    queueRunSteering(23, 'stop waiting and summarise', { interrupt: true });
    const out = (await pending) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, status: 'running', output: 'half', interrupted: true, note: WAIT_INTERRUPTED_BY_STEER });
    expect(out.aborted).toBeUndefined();
  });

  it('the run Stop ends a yieldMs wait too', async () => {
    const run = new AbortController();
    let seen: AbortSignal | undefined;
    const runTool = vi.fn((_n: string, _a: unknown, signal?: AbortSignal) => {
      seen = signal;
      return new Promise<unknown>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ ok: true, background: true, id: 'job-1', status: 'running' }), { once: true });
      });
    });
    const pending = runToolInterruptibly(runTool, 24, run.signal, 'run_command', { command: 'npm test', yieldMs: 60000 });
    run.abort();
    expect(await pending).toMatchObject({ status: 'running' });
    expect(seen?.aborted).toBe(true);
  });
});
