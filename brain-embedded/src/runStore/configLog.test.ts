/**
 * `configLog` — the per-chat, timestamped record of the model + run mode in force during
 * a chat: seeded at run start (`prepareBrainRun`) and appended when the host reports a
 * global change through the request's `configChange` hook. Pure cell fakes, the
 * `shipGates.preflight.test.ts` pattern.
 */
import { describe, expect, it } from 'vitest';
import { recordConfigChange, seedConfigLog } from './configLog';
import type { RunCell } from './runCell';

/** A run cell the helpers touch — `pushTrace` publishes a snapshot through `emit`. */
const cell = (): RunCell =>
  ({ configLog: [], trace: [], runTraceFrom: 0, listeners: new Set(), snapshot: null }) as unknown as RunCell;

const SNAP = { model: 'gpt-x', modelStrict: true, routingMode: 'auto', runMode: 'work', autoApprove: false };

describe('seedConfigLog', () => {
  it('records the model + runMode in force as timestamped entries', () => {
    const c = cell();
    seedConfigLog(c, SNAP);
    expect(c.configLog).toHaveLength(2);
    expect(c.configLog[0]).toMatchObject({ kind: 'model', to: 'gpt-x' });
    expect(c.configLog[1]).toMatchObject({ kind: 'runMode', to: 'work' });
    for (const e of c.configLog) expect(e.ts).toBeTruthy();
  });

  it('seeding twice with the same config does not duplicate; a new starting model does', () => {
    const c = cell();
    seedConfigLog(c, SNAP);
    seedConfigLog(c, SNAP);
    expect(c.configLog).toHaveLength(2);
    seedConfigLog(c, { ...SNAP, model: 'gpt-y' });
    expect(c.configLog).toHaveLength(3);
    expect(c.configLog[2]).toMatchObject({ kind: 'model', to: 'gpt-y' });
  });

  it('seeds only what the snapshot carries', () => {
    const c = cell();
    seedConfigLog(c, { runMode: 'chat' });
    expect(c.configLog).toEqual([expect.objectContaining({ kind: 'runMode', to: 'chat' })]);
  });
});

describe('recordConfigChange', () => {
  it('appends a timestamped entry and a run.config_change trace event', () => {
    const c = cell();
    recordConfigChange(c, { kind: 'model', from: 'gpt-x', to: 'gpt-y' });
    expect(c.configLog).toHaveLength(1);
    expect(c.configLog[0]).toMatchObject({ kind: 'model', from: 'gpt-x', to: 'gpt-y' });
    expect(c.configLog[0].ts).toBeTruthy();
    expect(c.trace.at(-1)).toMatchObject({
      category: 'message',
      label: 'run.config_change',
      args: { kind: 'model', from: 'gpt-x' },
    });
  });
});
