import { describe, expect, it } from 'vitest';
import {
  CODING_MODEL_POOL,
  CODING_DEFAULT_MODEL,
  FREE_MODEL_POOL,
  isKnownModel,
} from './LlmProxyService';
import { catalogEntry } from './vendors';

// ---------------------------------------------------------------------------
// Drift guard for the curated coding pool. The capability-reorder + the cloud-
// agent model picker + the runtime default all read from CODING_MODEL_POOL, so a
// silent rename in a vendor catalog (the exact bug that retired
// `anthropic/claude-3.7-sonnet` and left the tool-routing scoring every current
// model 0) must fail CI here instead of degrading routing in production.
// ---------------------------------------------------------------------------

describe('CODING_MODEL_POOL', () => {
  it('every entry is a real catalog model id', () => {
    const missing = CODING_MODEL_POOL.filter((m) => catalogEntry(m) === null);
    expect(missing, `coding-pool ids absent from any vendor catalog: ${missing.join(', ')}`).toEqual([]);
  });

  it('contains at least one FREE model so the default is dispatchable on the free key', () => {
    const free = CODING_MODEL_POOL.filter((m) => FREE_MODEL_POOL.includes(m));
    expect(free.length).toBeGreaterThan(0);
  });

  it('CODING_DEFAULT_MODEL is a FREE coding model', () => {
    expect(FREE_MODEL_POOL).toContain(CODING_DEFAULT_MODEL);
    expect(CODING_MODEL_POOL).toContain(CODING_DEFAULT_MODEL);
  });

  it('isKnownModel accepts catalog ids and rejects garbage', () => {
    expect(isKnownModel(CODING_DEFAULT_MODEL)).toBe(true);
    expect(isKnownModel('totally/made-up-model')).toBe(false);
    expect(isKnownModel('')).toBe(false);
    expect(isKnownModel(undefined)).toBe(false);
  });
});
