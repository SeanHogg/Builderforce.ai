import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetMemoryCooldowns,
  loadCooldownExpiries,
  loadCooldowns,
  recordFailure,
  type CooldownEnv,
} from './cooldownStore';
import type { VendorId } from '../../application/llm/vendors';

// ---------------------------------------------------------------------------
// Gap [1235]: cooldown TTL was fixed-by-classification with no early recovery,
// so a model cooled by a 1-minute vendor blip stayed benched for the full
// 5-/30-minute TTL. Each cooldown now carries a short `trialAfter` instant
// after which the gate-mode read reports the model as eligible again, letting
// the cascade send ONE live "half-open" probe. A probe success records nothing
// (the stale entry lives out its TTL, ignored); a probe failure re-cools with
// a fresh window. Zero extra KV subrequests — `trialAfter` rides in the value
// the read already fetches. In-memory backend (no AUTH_CACHE_KV) is the unit
// surface.
// ---------------------------------------------------------------------------

const env: CooldownEnv = {}; // no KV → in-memory backend
const VENDOR: VendorId = 'openrouter';
const MODEL = 'openrouter/qwen3-coder:free';
const KEY = `${VENDOR}/${MODEL}`;

beforeEach(() => {
  vi.useFakeTimers();
  _resetMemoryCooldowns();
});
afterEach(() => {
  _resetMemoryCooldowns();
  vi.useRealTimers();
});

describe('half-open early recovery (gap [1235])', () => {
  it('keeps a transient-cooled model gated immediately after the failure', async () => {
    vi.setSystemTime(new Date('2026-06-12T00:00:00Z'));
    await recordFailure(env, VENDOR, MODEL, 429); // transient → 5 min TTL

    const cooled = await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }]);
    expect(cooled.has(KEY)).toBe(true);
  });

  it('opens a half-open trial well before the full TTL (transient: probe ≤90s)', async () => {
    vi.setSystemTime(new Date('2026-06-12T00:00:00Z'));
    await recordFailure(env, VENDOR, MODEL, 429); // 5 min TTL, 25% = 75s < 90s cap

    // Just before the trial instant → still gated.
    vi.advanceTimersByTime(74_000);
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(true);

    // Past the trial instant but well before the 5-min TTL → eligible for a probe.
    vi.advanceTimersByTime(2_000); // now 76s in
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(false);
  });

  it('caps the auth-cooldown probe at 90s instead of waiting the full 30 min', async () => {
    vi.setSystemTime(new Date('2026-06-12T00:00:00Z'));
    await recordFailure(env, VENDOR, MODEL, 401); // auth → 30 min TTL, 25% = 450s, capped to 90s

    vi.advanceTimersByTime(89_000);
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(true);

    vi.advanceTimersByTime(2_000); // 91s — past the 90s cap, far short of 30 min
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(false);
  });

  it('re-cools with a fresh half-open window when the probe fails again', async () => {
    vi.setSystemTime(new Date('2026-06-12T00:00:00Z'));
    await recordFailure(env, VENDOR, MODEL, 429);

    vi.advanceTimersByTime(76_000); // half-open
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(false);

    // The probe dispatch fails → recordFailure runs again, opening a new window.
    await recordFailure(env, VENDOR, MODEL, 429);
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(true);

    // The new trial window is measured from the re-cool, not the original.
    vi.advanceTimersByTime(74_000);
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(false);
  });

  it("drops the entry entirely once the full TTL elapses", async () => {
    vi.setSystemTime(new Date('2026-06-12T00:00:00Z'));
    await recordFailure(env, VENDOR, MODEL, 429); // 5 min

    vi.advanceTimersByTime(5 * 60_000 + 1_000);
    expect((await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }])).has(KEY)).toBe(false);
  });

  it("display mode still surfaces the full countdown while half-open", async () => {
    vi.setSystemTime(new Date('2026-06-12T00:00:00Z'));
    const start = Date.now();
    await recordFailure(env, VENDOR, MODEL, 429);

    vi.advanceTimersByTime(76_000); // half-open: gate omits it…

    const gated = await loadCooldownExpiries(env, [{ vendor: VENDOR, model: MODEL }], 'gate');
    expect(gated.has(KEY)).toBe(false);

    // …but display mode keeps the original 5-min expiry visible for the admin UI.
    const shown = await loadCooldownExpiries(env, [{ vendor: VENDOR, model: MODEL }], 'display');
    expect(shown.get(KEY)).toBe(start + 5 * 60_000);
  });
});
