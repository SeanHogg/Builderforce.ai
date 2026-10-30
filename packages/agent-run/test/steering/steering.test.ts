/**
 * The steer that interrupts the step in flight — brought from
 * `brain-embedded/src/runStore/steerInterrupt.test.ts` with imports retargeted and
 * nothing else changed. The steering hook's own drain contract and the stop-steer
 * predicate follow (a late steer is never lost; a stop command is recognised).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainRunSteering, hasRunInterrupt, queueRunSteering, resetRunSteering } from '../../src/policy/steering/index.js';
import { INTERRUPTED_BY_STEER, SKIPPED_BY_STEER, WAIT_INTERRUPTED_BY_STEER, isInterruptibleCall, runToolInterruptibly, skipOnSteer } from '../../src/policy/steering/index.js';
import { isStopSteer, steeringHook } from '../../src/policy/steering/index.js';
import { requeueRunSteering } from '../../src/policy/steering/index.js';

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
    // Steered messages carry their attachments since ffe912880 — the drained shape is a turn, not a string.
    expect(drainRunSteering(7)).toEqual([{ text: 'write the update now', attachments: undefined }]);
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

describe("steeringHook.inject — the drained steer becomes the next user turn", () => {
  it("turns every drained message into a user row, in order", () => {
    const rows = steeringHook.inject(
      {} as never,
      ["use the v2 endpoint instead", "and add a test"],
    );
    expect(rows).toEqual([
      { role: "user", content: "use the v2 endpoint instead" },
      { role: "user", content: "and add a test" },
    ]);
  });

  it("returns nothing when nothing was steered", () => {
    expect(steeringHook.inject({} as never, [])).toBeUndefined();
  });
});

describe("isStopSteer — a steered message that IS a stop command", () => {
  it("marks a whole-message stop command as an interrupt", () => {
    expect(isStopSteer(["STOP executing"])).toBe(true);
    expect(isStopSteer(["stop the run"])).toBe(true);
  });

  it("never marks an ordinary instruction, or a child report, as a stop", () => {
    expect(isStopSteer(["write the update now"])).toBe(false);
    expect(isStopSteer(["Ada finished the schema"])).toBe(false);
    expect(isStopSteer([])).toBe(false);
  });
});

describe('queueRunSteering - keys the words the run will save, whoever queues them', () => {
  it('mints the row key at the first enqueue of words the run will save, so no direct caller can leave them keyless', () => {
    const queued = queueRunSteering(31, 'save these', { fromPerson: true, persist: true });

    expect(queued?.eventKey).toMatch(/^steer:/);
    expect(drainRunSteering(31)[0]?.eventKey).toBe(queued?.eventKey);
  });

  it('keeps a key it is given (a requeue), and does not key words nobody will save', () => {
    queueRunSteering(32, 'again', { fromPerson: true, persist: true, eventKey: 'steer:kept' });
    queueRunSteering(32, 'owner direction', {});

    const [again, owner] = drainRunSteering(32);
    expect(again?.eventKey).toBe('steer:kept');
    expect(owner?.eventKey).toBeUndefined();
  });

  it('reports nothing for blank words', () => {
    expect(queueRunSteering(33, '   ', { persist: true })).toBeUndefined();
    expect(drainRunSteering(33)).toEqual([]);
  });
});

describe('requeueRunSteering - handed-back steers go to the FRONT, in their order', () => {
  it('puts them ahead of what was queued meanwhile', () => {
    queueRunSteering(34, 'said meanwhile', { fromPerson: true });

    requeueRunSteering(34, [{ text: 'first', eventKey: 'steer:1' }, { text: 'second', eventKey: 'steer:2' }]);

    expect(drainRunSteering(34).map((m) => m.text)).toEqual(['first', 'second', 'said meanwhile']);
  });

  it('is a no-op for nothing, and makes an inbox of its own for a run with none', () => {
    requeueRunSteering(35, []);
    expect(drainRunSteering(35)).toEqual([]);

    requeueRunSteering(35, [{ text: 'alone' }]);
    expect(drainRunSteering(35).map((m) => m.text)).toEqual(['alone']);
  });
});
