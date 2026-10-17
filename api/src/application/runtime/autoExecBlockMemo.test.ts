import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import {
  blockCeilingMs, candidateFingerprint, loadBlockMemo,
  CONFIG_BLOCK_CEILING_MS, INTRINSIC_BLOCK_CEILING_MS,
} from './autoExecBlockMemo';

function fakeKv() {
  const data = new Map<string, string>();
  let puts = 0;
  return {
    store: {
      get: async (k: string) => data.get(k) ?? null,
      put: async (k: string, v: string) => { puts += 1; data.set(k, v); },
    },
    get puts() { return puts; },
  };
}
const envWith = (kv: ReturnType<typeof fakeKv>) => ({ AUTH_CACHE_KV: kv.store }) as unknown as Env;

const base = { status: 'todo', updatedAt: '2026-10-01T00:00:00.000Z', assignedAgentRef: 'a', lastExecutionId: 9 };
const NOW = 1_000_000;

describe('blockCeilingMs', () => {
  it('holds a cooldown exactly until it ends', () => {
    expect(blockCeilingMs({ reason: 'cooldown_active', cooldownRemainingMs: 120_000 })).toBe(120_000);
    expect(blockCeilingMs({ reason: 'cooldown_active', cooldownRemainingMs: 0 })).toBeNull();
  });

  it('gives config-dependent reasons the short ceiling and ticket-intrinsic ones the long one', () => {
    expect(blockCeilingMs({ reason: 'no_agent' })).toBe(CONFIG_BLOCK_CEILING_MS);
    expect(blockCeilingMs({ reason: 'lane_requirement_gate' })).toBe(CONFIG_BLOCK_CEILING_MS);
    expect(blockCeilingMs({ reason: 'terminal_lane' })).toBe(INTRINSIC_BLOCK_CEILING_MS);
  });

  it('never memoises tenant-wide or live-run reasons', () => {
    for (const reason of ['tenant_token_limit', 'cloud_run_limit', 'already_running', 'will_run', 'something_new']) {
      expect(blockCeilingMs({ reason })).toBeNull();
    }
  });
});

describe('candidateFingerprint', () => {
  it('changes when any deciding input changes', () => {
    const f = candidateFingerprint(base);
    expect(candidateFingerprint({ ...base, status: 'in_progress' })).not.toBe(f);
    expect(candidateFingerprint({ ...base, updatedAt: '2026-10-02T00:00:00.000Z' })).not.toBe(f);
    expect(candidateFingerprint({ ...base, assignedAgentRef: 'b' })).not.toBe(f);
    expect(candidateFingerprint({ ...base, lastExecutionId: 10 })).not.toBe(f);
    expect(candidateFingerprint({ ...base, updatedAt: new Date(base.updatedAt) })).toBe(f);
  });
});

describe('loadBlockMemo', () => {
  it('skips an unchanged blocked candidate until its ceiling, then re-evaluates', async () => {
    const kv = fakeKv();
    const f = candidateFingerprint(base);
    const memo = await loadBlockMemo(envWith(kv));
    memo.record(1, f, { reason: 'no_agent' }, NOW);
    await memo.save(new Set([1]), NOW);

    const next = await loadBlockMemo(envWith(kv));
    expect(next.isFresh(1, f, NOW + 60_000)).toBe(true);
    expect(next.isFresh(1, f, NOW + CONFIG_BLOCK_CEILING_MS)).toBe(false);
  });

  it('re-evaluates as soon as the fingerprint changes (a dependency moved the ticket, a new run landed)', async () => {
    const kv = fakeKv();
    const memo = await loadBlockMemo(envWith(kv));
    memo.record(1, candidateFingerprint(base), { reason: 'terminal_lane' }, NOW);
    expect(memo.isFresh(1, candidateFingerprint({ ...base, lastExecutionId: 10 }), NOW + 1)).toBe(false);
  });

  it('drops entries for tasks that left the window and writes nothing when unchanged', async () => {
    const kv = fakeKv();
    const memo = await loadBlockMemo(envWith(kv));
    memo.record(1, 'x', { reason: 'no_agent' }, NOW);
    memo.record(2, 'y', { reason: 'no_agent' }, NOW);
    await memo.save(new Set([1]), NOW);
    expect(kv.puts).toBe(1);

    const next = await loadBlockMemo(envWith(kv));
    expect(next.isFresh(2, 'y', NOW + 1)).toBe(false);
    expect(next.isFresh(1, 'x', NOW + 1)).toBe(true);
    await next.save(new Set([1]), NOW + 1);
    expect(kv.puts).toBe(1);
  });

  it('a non-memoisable verdict forgets a previous block', async () => {
    const kv = fakeKv();
    const memo = await loadBlockMemo(envWith(kv));
    memo.record(1, 'x', { reason: 'no_agent' }, NOW);
    memo.record(1, 'x', { reason: 'already_running' }, NOW);
    expect(memo.isFresh(1, 'x', NOW + 1)).toBe(false);
  });

  it('fails open without KV — every candidate is evaluated', async () => {
    const memo = await loadBlockMemo({} as Env);
    memo.record(1, 'x', { reason: 'no_agent' }, NOW);
    await expect(memo.save(new Set([1]), NOW)).resolves.toBeUndefined();
    expect((await loadBlockMemo({} as Env)).isFresh(1, 'x', NOW + 1)).toBe(false);
  });
});
