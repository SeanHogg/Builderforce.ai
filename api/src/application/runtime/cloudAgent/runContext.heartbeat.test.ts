import { describe, expect, it } from 'vitest';
import { CLOUD_LONG_LIVED_SILENCE_MS } from '../orphanReasons';
import {
  HEARTBEAT_MIN_INTERVAL_MS,
  SANDBOX_COMMAND_HEARTBEAT_MS,
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
    // A long sandbox command: one beat cadence late, plus one dropped beat.
    expect(HEARTBEAT_MIN_INTERVAL_MS + 2 * SANDBOX_COMMAND_HEARTBEAT_MS).toBeLessThan(CLOUD_LONG_LIVED_SILENCE_MS);
    // Durable DO: the beat lands at the next alarm tick, one LLM step later.
    expect(HEARTBEAT_MIN_INTERVAL_MS + SLOWEST_OBSERVED_STEP_MS).toBeLessThan(CLOUD_LONG_LIVED_SILENCE_MS);
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

});
