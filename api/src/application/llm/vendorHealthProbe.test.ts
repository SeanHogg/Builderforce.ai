import { describe, it, expect, beforeEach } from 'vitest';
import { tryAcquireProbeSlot, _resetProbeCooldowns } from './vendorHealthProbe';

describe('tryAcquireProbeSlot (manual probe rate-limit) [1424]', () => {
  beforeEach(() => _resetProbeCooldowns());

  it('allows the first probe for a vendor', () => {
    expect(tryAcquireProbeSlot('openrouter', 1_000_000)).toEqual({ ok: true });
  });

  it('blocks a second probe within the min interval, reporting retryAfterMs', () => {
    tryAcquireProbeSlot('openrouter', 1_000_000);
    const second = tryAcquireProbeSlot('openrouter', 1_000_000 + 10_000); // +10s
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retryAfterMs).toBe(50_000); // 60s - 10s
  });

  it('allows again once the interval has elapsed', () => {
    tryAcquireProbeSlot('openrouter', 1_000_000);
    expect(tryAcquireProbeSlot('openrouter', 1_000_000 + 60_000)).toEqual({ ok: true });
  });

  it('tracks cooldowns per vendor independently', () => {
    tryAcquireProbeSlot('openrouter', 1_000_000);
    // A different vendor is unaffected by openrouter's recent probe.
    expect(tryAcquireProbeSlot('cerebras', 1_000_000 + 1_000)).toEqual({ ok: true });
  });

  it('honors a custom min interval', () => {
    tryAcquireProbeSlot('nvidia', 0, 5_000);
    expect(tryAcquireProbeSlot('nvidia', 2_000, 5_000).ok).toBe(false);
    expect(tryAcquireProbeSlot('nvidia', 5_000, 5_000)).toEqual({ ok: true });
  });
});
