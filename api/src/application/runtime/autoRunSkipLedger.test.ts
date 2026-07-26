import { describe, it, expect, vi } from 'vitest';
import {
  autoRunSkipState, claimAutoRunSkipState, clearAutoRunSkip, recordAutoRunSkip,
  SKIP_REAFFIRM_TTL_SECONDS,
} from './autoRunSkipLedger';

vi.mock('./cloudAgentEngine', () => ({
  recordCloudToolEvent: vi.fn(async () => undefined),
}));
const { recordCloudToolEvent } = await import('./cloudAgentEngine');

/**
 * The amplification this closes: 11,182 `auto_run_skipped` rows in one day, against
 * ~180/day the week before — the single largest writer in `tool_audit_events` on a
 * database held under $5/month. 313 tickets stuck on `no_agent` do not become more
 * diagnosable for being told so every few minutes.
 */
function fakeKv() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; ttl?: number }> = [];
  return {
    store,
    puts,
    env: {
      AUTH_CACHE_KV: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
          store.set(k, v);
          puts.push({ key: k, ...(o?.expirationTtl ? { ttl: o.expirationTtl } : {}) });
        },
        delete: async (k: string) => { store.delete(k); },
      },
    } as never,
  };
}

const db = {} as never;
const skip = (reason: string, lane = 'ready') => ({
  tenantId: 1, taskId: 42, cloudAgentRef: 'agent-1', lane, reason,
  detail: { taskId: 42, reason }, result: `Auto-run skipped (${reason}).`,
});

describe('recordAutoRunSkip — state-change-only emit', () => {
  it('writes the first refusal and suppresses an identical repeat', async () => {
    const { env } = fakeKv();
    vi.mocked(recordCloudToolEvent).mockClear();
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(true);
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(false);
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(false);
    expect(recordCloudToolEvent).toHaveBeenCalledTimes(1);
  });

  it('writes again when the REASON changes — the transition is the information', async () => {
    const { env } = fakeKv();
    vi.mocked(recordCloudToolEvent).mockClear();
    await recordAutoRunSkip(env, db, skip('no_agent'));
    expect(await recordAutoRunSkip(env, db, skip('run_cap_exhausted'))).toBe(true);
    expect(recordCloudToolEvent).toHaveBeenCalledTimes(2);
  });

  it('writes again when the LANE changes — the same reason on a new lane is a new fact', async () => {
    const { env } = fakeKv();
    vi.mocked(recordCloudToolEvent).mockClear();
    await recordAutoRunSkip(env, db, skip('no_agent', 'ready'));
    expect(await recordAutoRunSkip(env, db, skip('no_agent', 'in_review'))).toBe(true);
    expect(recordCloudToolEvent).toHaveBeenCalledTimes(2);
  });

  it('re-affirms on a TTL so a stalled ticket never looks like a single stale row', async () => {
    const { env, puts } = fakeKv();
    await recordAutoRunSkip(env, db, skip('no_agent'));
    expect(puts[0]?.ttl).toBe(SKIP_REAFFIRM_TTL_SECONDS);
  });

  it('records the stall AGAIN after the ticket actually ran', async () => {
    // Without the clear, a ticket that runs and re-stalls for the same reason inside the
    // TTL would leave the second stall unrecorded — the one way this could lose
    // information rather than noise.
    const { env } = fakeKv();
    vi.mocked(recordCloudToolEvent).mockClear();
    await recordAutoRunSkip(env, db, skip('no_agent'));
    await clearAutoRunSkip(env, 1, 42);
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(true);
    expect(recordCloudToolEvent).toHaveBeenCalledTimes(2);
  });

  it('keeps tickets and tenants independent', async () => {
    const { env } = fakeKv();
    await recordAutoRunSkip(env, db, skip('no_agent'));
    expect(await recordAutoRunSkip(env, db, { ...skip('no_agent'), taskId: 43 })).toBe(true);
    expect(await recordAutoRunSkip(env, db, { ...skip('no_agent'), tenantId: 2 })).toBe(true);
  });

  it('FAILS OPEN with no KV binding — telemetry is never hidden by a missing cache', async () => {
    vi.mocked(recordCloudToolEvent).mockClear();
    const env = {} as never;
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(true);
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(true);
    expect(recordCloudToolEvent).toHaveBeenCalledTimes(2);
  });

  it('FAILS OPEN when the KV read throws', async () => {
    const env = { AUTH_CACHE_KV: { get: async () => { throw new Error('kv down'); }, put: async () => undefined, delete: async () => undefined } } as never;
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(true);
    expect(await recordAutoRunSkip(env, db, skip('no_agent'))).toBe(true);
  });
});

describe('claimAutoRunSkipState — the gate the multi-row caller uses', () => {
  it('claims once for a whole mismatch SET, so N rows are written together or not at all', async () => {
    const { env } = fakeKv();
    const state = autoRunSkipState('ready', 'capability_mismatch:a1,a2');
    expect(await claimAutoRunSkipState(env, 1, 42, state)).toBe(true);
    expect(await claimAutoRunSkipState(env, 1, 42, state)).toBe(false);
    // Re-staffing the lane with a DIFFERENT wrong-role agent is a real change.
    expect(await claimAutoRunSkipState(env, 1, 42, autoRunSkipState('ready', 'capability_mismatch:a1,a3'))).toBe(true);
  });

  it('builds the same state string the single-row path uses (no separator drift)', () => {
    expect(autoRunSkipState('ready', 'no_agent')).toBe('ready|no_agent');
    expect(autoRunSkipState(null, 'no_agent')).toBe('-|no_agent');
    expect(autoRunSkipState(undefined, 'no_agent')).toBe('-|no_agent');
  });
});
