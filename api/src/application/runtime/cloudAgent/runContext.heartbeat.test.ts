import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLOUD_LONG_LIVED_SILENCE_MS } from '../orphanReasons';
import {
  CONTAINER_HEARTBEAT_CADENCE_MS,
  HEARTBEAT_MIN_INTERVAL_MS,
  heartbeatAndCheckCancelled,
  heartbeatExecution,
} from './runContext';
import type { Db } from '../../../infrastructure/database/connection';

/** Slowest single LLM step observed on the durable surface (execution #136). */
const SLOWEST_OBSERVED_STEP_MS = 93_000;

function fakeDb(opts: { written: boolean; row?: { status: string; updatedAt: Date | null } }) {
  const calls = { updates: 0, selects: 0 };
  const db = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            calls.updates += 1;
            return opts.written ? [{ id: 1 }] : [];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            calls.selects += 1;
            return opts.row ? [opts.row] : [];
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Db, calls };
}

describe('cloud execution heartbeat throttle', () => {
  it('keeps a live run inside the reaper ceiling (throttle bound to CLOUD_LONG_LIVED_SILENCE_MS)', () => {
    // Container: one cadence late, plus one dropped beat.
    expect(HEARTBEAT_MIN_INTERVAL_MS + 2 * CONTAINER_HEARTBEAT_CADENCE_MS).toBeLessThan(CLOUD_LONG_LIVED_SILENCE_MS);
    // Durable DO: the beat lands at the next alarm tick, one LLM step later.
    expect(HEARTBEAT_MIN_INTERVAL_MS + SLOWEST_OBSERVED_STEP_MS + CONTAINER_HEARTBEAT_CADENCE_MS)
      .toBeLessThan(CLOUD_LONG_LIVED_SILENCE_MS);
  });

  it('the container image beats at the cadence the throttle was sized for', () => {
    // String argument, not `new URL(...)`: see containerPauseContract.test.ts.
    const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const image = readFileSync(resolve(apiRoot, 'container/server.mjs'), 'utf8');
    expect(image).toMatch(/const HEARTBEAT_MS = 30 \* 1000;/);
    expect(CONTAINER_HEARTBEAT_CADENCE_MS).toBe(30_000);
  });

  it('skips the round trip entirely after this isolate wrote', async () => {
    const { db, calls } = fakeDb({ written: true });
    await heartbeatExecution(db, 9001);
    await heartbeatExecution(db, 9001);
    await heartbeatExecution(db, 9001);
    expect(calls.updates).toBe(1);
  });

  it('does not gate on a no-match (another isolate wrote at an unknown time)', async () => {
    const { db, calls } = fakeDb({ written: false });
    await heartbeatExecution(db, 9002);
    await heartbeatExecution(db, 9002);
    expect(calls.updates).toBe(2);
  });

  it('timer beat: one read answers cancelled, and writes only when the row is stale', async () => {
    const fresh = fakeDb({ written: true, row: { status: 'running', updatedAt: new Date(Date.now() - 10_000) } });
    expect(await heartbeatAndCheckCancelled(fresh.db, 1, 9003)).toBe(false);
    expect(fresh.calls).toEqual({ selects: 1, updates: 0 });

    const stale = fakeDb({ written: true, row: { status: 'running', updatedAt: new Date(Date.now() - HEARTBEAT_MIN_INTERVAL_MS) } });
    expect(await heartbeatAndCheckCancelled(stale.db, 1, 9004)).toBe(false);
    expect(stale.calls).toEqual({ selects: 1, updates: 1 });

    const cancelled = fakeDb({ written: false, row: { status: 'cancelled', updatedAt: new Date() } });
    expect(await heartbeatAndCheckCancelled(cancelled.db, 1, 9005)).toBe(true);
  });
});
