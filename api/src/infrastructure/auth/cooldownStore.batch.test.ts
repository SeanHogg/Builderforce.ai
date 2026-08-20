/**
 * The composite-key cooldown store — one blob per vendor instead of one key per
 * (vendor, model).
 *
 * What this is guarding: a failed cascade used to issue 2N parallel KV operations —
 * a read+write `recordFailure` per attempt plus a vendor-fault read-modify-write per
 * attempt — on a request that had ALREADY spent its subrequest budget failing. A
 * Worker has a hard subrequest ceiling; spending it on bookkeeping is spending it
 * instead of on the retries the budget exists for.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordFailures,
  loadCooldowns,
  loadCooledModelsForVendor,
  loadCooledVendors,
} from './cooldownStore';
import type { VendorId } from '../../application/llm/vendors';

/** A KV double that counts operations, so "how many writes" is an assertion. */
function countingKv() {
  const store = new Map<string, string>();
  const ops = { get: 0, put: 0, delete: 0 };
  return {
    ops,
    keys: () => [...store.keys()],
    kv: {
      async get(key: string) { ops.get += 1; return store.get(key) ?? null; },
      async put(key: string, value: string) { ops.put += 1; store.set(key, value); },
      async delete(key: string) { ops.delete += 1; store.delete(key); },
      async list() { return { keys: [], list_complete: true as const, cacheStatus: null }; },
      async getWithMetadata() { return { value: null, metadata: null, cacheStatus: null }; },
    } as unknown as KVNamespace,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('recordFailures — one read + one write per DISTINCT VENDOR', () => {
  it('collapses a four-attempt single-vendor cascade to one read and one write', async () => {
    const { kv, ops, keys } = countingKv();
    await recordFailures({ AUTH_CACHE_KV: kv }, [
      { vendor: 'openrouter' as VendorId, model: 'a/one',   status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/two',   status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/three', status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/four',  status: 503 },
    ]);

    // One blob write. The vendor-level ring/cooldown bookkeeping adds its own ops,
    // but the PER-MODEL fan-out — the thing that scaled with the cascade — is gone.
    expect(keys().filter((k) => k.startsWith('cooldowns:'))).toEqual(['cooldowns:openrouter']);
    expect(ops.put).toBeLessThanOrEqual(3);
  });

  it('keeps every model in the one blob', async () => {
    const { kv } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [
      { vendor: 'openrouter' as VendorId, model: 'a/one', status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/two', status: 503 },
    ]);
    const cooled = await loadCooledModelsForVendor(env, 'openrouter' as VendorId);
    expect([...cooled].sort()).toEqual(['a/one', 'a/two']);
  });

  it('splits by vendor, one blob each', async () => {
    const { kv, keys } = countingKv();
    await recordFailures({ AUTH_CACHE_KV: kv }, [
      { vendor: 'openrouter' as VendorId, model: 'a/one', status: 503 },
      { vendor: 'cerebras' as VendorId,   model: 'b/one', status: 503 },
    ]);
    expect(keys().filter((k) => k.startsWith('cooldowns:')).sort())
      .toEqual(['cooldowns:cerebras', 'cooldowns:openrouter']);
  });
});

describe('recordFailures — classification is unchanged', () => {
  it('writes NOTHING for a 400/422: the payload is the caller\'s bug, not the model\'s', async () => {
    const { kv, keys } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [{ vendor: 'openrouter' as VendorId, model: 'a/one', status: 400 }]);
    // Cooling a healthy model here would bench it for the NEXT caller, and tripping
    // vendor cooldown would starve every other tenant for one malformed payload.
    expect(keys()).toEqual([]);
    expect(await loadCooledModelsForVendor(env, 'openrouter' as VendorId)).toEqual(new Set());
  });

  it('an auth failure still benches the whole vendor on a single strike', async () => {
    const { kv } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [{ vendor: 'openrouter' as VendorId, model: 'a/one', status: 401 }]);
    expect(await loadCooledVendors(env, ['openrouter' as VendorId])).toEqual(new Set(['openrouter']));
  });

  it('three transient failures in ONE cascade still trip the vendor', async () => {
    // The regression this pins: grouping the vendor decision per-vendor could have
    // collapsed a 3-attempt cascade to a single ring timestamp, and the sliding-window
    // threshold would then never fire from the exact case it was written for.
    const { kv } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [
      { vendor: 'openrouter' as VendorId, model: 'a/one',   status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/two',   status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/three', status: 503 },
    ]);
    expect(await loadCooledVendors(env, ['openrouter' as VendorId])).toEqual(new Set(['openrouter']));
  });

  it('two transient failures do NOT trip the vendor', async () => {
    const { kv } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [
      { vendor: 'openrouter' as VendorId, model: 'a/one', status: 503 },
      { vendor: 'openrouter' as VendorId, model: 'a/two', status: 503 },
    ]);
    expect(await loadCooledVendors(env, ['openrouter' as VendorId])).toEqual(new Set());
  });
});

describe('loadCooldownExpiries — one read per distinct vendor', () => {
  it('answers about many models on one vendor with a single get', async () => {
    const { kv, ops } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [{ vendor: 'openrouter' as VendorId, model: 'a/one', status: 503 }]);

    const before = ops.get;
    const cooled = await loadCooldowns(env, [
      { vendor: 'openrouter' as VendorId, model: 'a/one' },
      { vendor: 'openrouter' as VendorId, model: 'a/two' },
      { vendor: 'openrouter' as VendorId, model: 'a/three' },
      { vendor: 'openrouter' as VendorId, model: 'a/four' },
    ]);
    // Four candidates, ONE get. This is what `COOLDOWN_PREFETCH_LIMIT` existed to cap.
    expect(ops.get - before).toBe(1);
    expect(cooled).toEqual(new Set(['openrouter/a/one']));
  });
});

describe('composite blob hygiene', () => {
  it('prunes expired entries rather than growing without bound', async () => {
    const { kv } = countingKv();
    const env = { AUTH_CACHE_KV: kv };
    await recordFailures(env, [{ vendor: 'openrouter' as VendorId, model: 'a/one', status: 503 }]);
    expect(await loadCooledModelsForVendor(env, 'openrouter' as VendorId)).toEqual(new Set(['a/one']));

    // Past the 5-minute transient TTL and its half-open trial.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
    expect(await loadCooledModelsForVendor(env, 'openrouter' as VendorId)).toEqual(new Set());
  });
});
