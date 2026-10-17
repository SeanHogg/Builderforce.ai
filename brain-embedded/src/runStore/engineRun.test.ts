import { afterEach, describe, expect, it } from 'vitest';
import { startEngineRun } from './engineRun';
import { getGlobalRunState, getRunSnapshot, resetBrainRunStore, resolveRunConfirm, stopRun } from './runControl';

const KEY = 'canvas:session-1';

afterEach(() => resetBrainRunStore());

describe('startEngineRun', () => {
  it('is single-flight per key and settles the cell', async () => {
    let release!: () => void;
    const first = startEngineRun(KEY, () => new Promise<void>((r) => { release = r; }));
    expect(getRunSnapshot(KEY).running).toBe(true);
    expect(await startEngineRun(KEY, async () => { throw new Error('must not run'); })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(getRunSnapshot(KEY).running).toBe(false);
    expect(getRunSnapshot(KEY).activity).toBeNull();
  });

  it('keeps engine runs out of the cross-chat state', async () => {
    let release!: () => void;
    const run = startEngineRun(KEY, () => new Promise<void>((r) => { release = r; }));
    expect(getGlobalRunState()).toEqual({ running: [], awaiting: [] });
    release();
    await run;
  });

  it('asks through the shared confirmation gate', async () => {
    let answer: boolean | undefined;
    const run = startEngineRun(KEY, async (ctl) => { answer = await ctl.confirm({ name: 'canvas_delete', args: {} }); });
    await Promise.resolve();
    expect(getRunSnapshot(KEY).pendingConfirm).toEqual({ name: 'canvas_delete', args: {} });
    resolveRunConfirm(KEY, true);
    await run;
    expect(answer).toBe(true);
    expect(getRunSnapshot(KEY).pendingConfirm).toBeNull();
  });

  it('Stop aborts the engine without surfacing an error', async () => {
    const run = startEngineRun(KEY, (ctl) => new Promise<void>((_, reject) => {
      ctl.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    stopRun(KEY);
    await run;
    const snap = getRunSnapshot(KEY);
    expect(snap.running).toBe(false);
    expect(snap.error).toBe('');
  });

  it('a thrown error becomes the cell error with one durable row', async () => {
    await startEngineRun(KEY, async (ctl) => {
      ctl.trace({ ts: '', category: 'llm', label: 'llm.complete', result: 'ok' });
      throw new Error('upstream failed');
    });
    const snap = getRunSnapshot(KEY);
    expect(snap.error).toBe('upstream failed');
    expect(snap.trace.filter((e) => e.isError)).toHaveLength(1);
  });
});
