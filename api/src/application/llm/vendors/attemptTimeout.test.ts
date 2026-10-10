import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_DECLARED_ATTEMPT_TIMEOUT_MS,
  declaredAttemptTimeoutMs,
  resolveAttemptTimeoutMs,
} from './attemptTimeout';
import { DEFAULT_VENDOR_CALL_TIMEOUT_MS, type VendorCallParams, type VendorCallResult } from './types';
import { dispatchVendor, getAllVendorIds, getModule } from './registry';
import { FREE_VENDOR_CALL_TIMEOUT_MS } from '../modelPool';

// ---------------------------------------------------------------------------
// Per-attempt vendor budget — production 2026-10-03..10: anthropic/claude-opus-5-5
// timed out 15x, googleai/gemini-2.5-flash 34x, NIM Nemotron 37x — all at exactly
// the free plan's 15000ms. The budget is now declared per vendor/model as data.
// ---------------------------------------------------------------------------

afterEach(() => vi.restoreAllMocks());

describe('resolveAttemptTimeoutMs', () => {
  it('returns the requested budget unchanged when nothing is declared', () => {
    expect(resolveAttemptTimeoutMs(15_000, undefined)).toBe(15_000);
    expect(resolveAttemptTimeoutMs(undefined, undefined)).toBeUndefined();
  });

  it('raises a short plan budget to the declared floor', () => {
    expect(resolveAttemptTimeoutMs(FREE_VENDOR_CALL_TIMEOUT_MS, 90_000)).toBe(90_000);
    expect(resolveAttemptTimeoutMs(undefined, 45_000)).toBe(45_000);
  });

  it('never lowers a caller budget that is already longer', () => {
    expect(resolveAttemptTimeoutMs(60_000, 30_000)).toBe(60_000);
    expect(resolveAttemptTimeoutMs(undefined, 10_000)).toBe(DEFAULT_VENDOR_CALL_TIMEOUT_MS);
  });

  it('clamps a declaration to MAX_DECLARED_ATTEMPT_TIMEOUT_MS', () => {
    expect(resolveAttemptTimeoutMs(15_000, 10 * 60_000)).toBe(MAX_DECLARED_ATTEMPT_TIMEOUT_MS);
  });
});

describe('declared budgets (vendor DATA)', () => {
  it('frontier vendors/models declare a budget longer than the free fast-fail', () => {
    expect(declaredAttemptTimeoutMs(getModule('anthropic'), 'claude-opus-5-5')).toBe(90_000);
    expect(declaredAttemptTimeoutMs(getModule('googleai'), 'gemini-2.5-flash')).toBe(45_000);
    expect(declaredAttemptTimeoutMs(getModule('googleai'), 'gemini-2.5-pro')).toBe(90_000);
    expect(declaredAttemptTimeoutMs(getModule('nvidia'), 'nvidia/nemotron-3-ultra-550b-a55b')).toBe(45_000);
    expect(declaredAttemptTimeoutMs(getModule('openrouter'), 'anthropic/claude-opus-5.5')).toBe(90_000);
    for (const ms of [90_000, 45_000]) expect(ms).toBeGreaterThan(FREE_VENDOR_CALL_TIMEOUT_MS);
  });

  it('every byModel key names a catalog entry of its own vendor (no drift on a rename)', () => {
    for (const vendor of getAllVendorIds()) {
      const mod = getModule(vendor);
      const ids = new Set(mod.catalog.map((e) => e.id));
      for (const modelId of Object.keys(mod.attemptTimeoutMs?.byModel ?? {})) {
        expect(ids.has(modelId), `${vendor} attemptTimeoutMs.byModel['${modelId}']`).toBe(true);
      }
    }
  });

  it('everything else keeps the plan budget', () => {
    expect(declaredAttemptTimeoutMs(getModule('cerebras'), 'gpt-oss-120b')).toBeUndefined();
    expect(declaredAttemptTimeoutMs(getModule('nvidia'), 'openai/gpt-oss-20b')).toBeUndefined();
    expect(declaredAttemptTimeoutMs(getModule('openrouter'), 'qwen/qwen3-coder:free')).toBeUndefined();
  });
});

describe('dispatchVendor applies the per-attempt budget per candidate', () => {
  const OK: VendorCallResult = { raw: { choices: [{ message: { content: 'ok' } }] }, content: 'ok' };

  it('a strict-pinned Opus turn on the free plan budget gets 90s, not 15s', async () => {
    const spy = vi.spyOn(getModule('anthropic'), 'call').mockResolvedValue(OK);
    await dispatchVendor({
      env: { CLAUDE_API_KEY: 'sk-ant' },
      modelChain: ['claude-opus-5-5'],
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS,
    });
    expect((spy.mock.calls[0]![0] as VendorCallParams).timeoutMs).toBe(90_000);
  });

  it('an undeclared candidate in the same dispatch keeps the plan budget', async () => {
    const spy = vi.spyOn(getModule('cerebras'), 'call').mockResolvedValue(OK);
    await dispatchVendor({
      env: { CEREBRAS_API_KEY: 'c' },
      modelChain: ['cerebras/gpt-oss-120b'],
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS,
    });
    expect((spy.mock.calls[0]![0] as VendorCallParams).timeoutMs).toBe(FREE_VENDOR_CALL_TIMEOUT_MS);
  });
});
