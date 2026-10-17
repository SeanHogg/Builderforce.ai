import { afterEach, describe, expect, it } from 'vitest';
import { startEngineRun } from './engineRun';
import { getGlobalRunState, getRunSnapshot, resetBrainRunStore, resolveRunConfirm, stopRun } from './runControl';
import { STOPPED_TURN_STEP } from '../stoppedTurn';

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

  it('Stop while an approval is pending declines it and settles the run', async () => {
    let answer: boolean | undefined;
    const run = startEngineRun(KEY, async (ctl) => { answer = await ctl.confirm({ name: 'canvas_delete', args: {} }); });
    await Promise.resolve();
    expect(getRunSnapshot(KEY).pendingConfirm).not.toBeNull();
    stopRun(KEY);
    await run;
    expect(answer).toBe(false);
    expect(getRunSnapshot(KEY).running).toBe(false);
  });

  it('holds the turn on the cell, clears it at Stop, and records one Stop for a double press', async () => {
    let release!: () => void;
    const run = startEngineRun(KEY, (ctl) => {
      ctl.correlate('msg-1');
      return new Promise<void>((r) => { release = r; });
    });
    expect(getRunSnapshot(KEY).turn).toMatchObject({ id: 'msg-1' });
    expect(typeof getRunSnapshot(KEY).turn?.startedAt).toBe('number');
    stopRun(KEY);
    stopRun(KEY);
    const snap = getRunSnapshot(KEY);
    expect(snap.turn).toBeNull();
    expect(snap.running).toBe(true); // still unwinding
    expect(snap.trace.filter((e) => e.label === STOPPED_TURN_STEP)).toHaveLength(1);
    release();
    await run;
    expect(getRunSnapshot(KEY).running).toBe(false);
  });

  it('publishes a new trace array per step', async () => {
    const seen: unknown[] = [];
    await startEngineRun(KEY, async (ctl) => {
      seen.push(getRunSnapshot(KEY).trace);
      ctl.trace({ ts: '', category: 'llm', label: 'llm.complete', result: 'ok' });
      seen.push(getRunSnapshot(KEY).trace);
    });
    expect(seen[0]).not.toBe(seen[1]);
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
