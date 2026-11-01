/**
 * reapStaleExecutions — keeps the KV-gated cron tick open while a run is still in flight (it has a
 * deadline the reaper must be around to enforce), and goes quiet when none is. The in-flight
 * answer rides in the SAME one-statement probe as the stale arms, so an idle platform still pays
 * a single statement.
 */
import { describe, expect, it } from 'vitest';
import { createReaperFakeDb, newReaperFakeDbScript } from './__fixtures__/staleExecutionReaperDb';
import { fakeCronKv } from './__fixtures__/fakeCronKv';
import { reapStaleExecutions } from './staleExecutionReaper';

const NONE_STALE = { host_running: false, cloud_running: false, queued: false, paused: false, park_age: false };

async function reap(probe: Record<string, unknown>) {
  const script = newReaperFakeDbScript({ probe: () => ({ ...NONE_STALE, ...probe }) });
  const { env, signalled } = fakeCronKv();
  await reapStaleExecutions(env, Date.now(), createReaperFakeDb(script) as never);
  return { signalled: signalled(), calls: script.calls };
}

describe('reapStaleExecutions — cron gate', () => {
  it('signals while a pending / submitted / running execution exists, even when none is stale yet', async () => {
    const r = await reap({ live_runs: true });
    expect(r.signalled).toBe(true);
    expect(r.calls).toEqual(['execute']); // one probe statement, nothing else on a healthy tick
  });

  it('does NOT signal when no execution is in flight', async () => {
    const r = await reap({ live_runs: false });
    expect(r.signalled).toBe(false);
    expect(r.calls).toEqual(['execute']);
  });

  it('treats a probe row with no live_runs answer as nothing in flight', async () => {
    const r = await reap({});
    expect(r.signalled).toBe(false);
  });
});
