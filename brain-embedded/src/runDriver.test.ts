import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRemoteRun,
  clearRunError,
  getGlobalRunState,
  getRunSnapshot,
  getRunTrace,
  installRunDriver,
  isRunning,
  resetBrainRunStore,
  resolveRunConfirm,
  startRun,
  stopRun,
  subscribeRun,
  type BrainRunSnapshot,
} from './index';
import type { BrainRunRequest } from './brainRunStore';

const req = (): BrainRunRequest => ({
  resolvedSystemPrompt: 'sys',
  stream: async () => { throw new Error('must not stream locally'); },
  persistence: { sendMessages: async () => [] },
});

const remote = (over: Partial<BrainRunSnapshot> = {}): BrainRunSnapshot => ({
  running: true,
  streamingText: '',
  error: '',
  errorAction: null,
  pendingConfirm: null,
  messagesEpoch: 0,
  appended: [],
  hasTrace: false,
  trace: [],
  activity: null,
  byoUnresolved: [],
  providerCap: [],
  ...over,
});

afterEach(() => {
  installRunDriver(null);
  resetBrainRunStore();
});

describe('the run-driver seam', () => {
  it('routes start / stop / confirm / clearError to the installed driver instead of the local loop', async () => {
    const driver = { start: vi.fn(async () => {}), stop: vi.fn(), confirm: vi.fn(), clearError: vi.fn() };
    installRunDriver(driver);
    const r = req();
    await startRun(7, r);
    stopRun(7);
    resolveRunConfirm(7, true);
    clearRunError(7);
    expect(driver.start).toHaveBeenCalledWith(7, r);
    expect(driver.stop).toHaveBeenCalledWith(7);
    expect(driver.confirm).toHaveBeenCalledWith(7, true);
    expect(driver.clearError).toHaveBeenCalledWith(7);
    // Nothing ran here: the local cell never claimed the run.
    expect(isRunning(7)).toBe(false);
  });

  it('mirrors a remote run into the local cell so every local reader sees it', () => {
    const seen = vi.fn();
    subscribeRun(9, seen);
    const ev = { ts: 't', category: 'tool' as const, label: 'read_file', result: 'ok' };
    applyRemoteRun(9, remote({ streamingText: 'hel', trace: [ev], hasTrace: true }));
    expect(seen).toHaveBeenCalled();
    expect(isRunning(9)).toBe(true);
    expect(getRunSnapshot(9).streamingText).toBe('hel');
    expect(getRunTrace(9)).toEqual([ev]);
    expect(getGlobalRunState()).toEqual({ running: [9], awaiting: [] });

    applyRemoteRun(9, remote({ pendingConfirm: { name: 'write_file', args: {} } }));
    expect(getGlobalRunState()).toEqual({ running: [], awaiting: [9] });

    applyRemoteRun(9, remote({ running: false, error: 'boom' }));
    expect(isRunning(9)).toBe(false);
    expect(getRunSnapshot(9).error).toBe('boom');
    expect(getGlobalRunState()).toEqual({ running: [], awaiting: [] });
  });
});
