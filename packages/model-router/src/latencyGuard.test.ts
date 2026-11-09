/**
 * Fix #8 — LATENCY-AWARE FAILOVER, acceptance tests.
 *
 * Incident (VS Code chat #60338): failover picked MiniMax-M3.1-Flash-Preview at
 * 97s/46s/25s per one-call turn over a ~6s primary. A small turn must not fail over to
 * a model more than 3× slower than the primary unless the primary is down.
 *
 * Covered here, through `rankConnectedForRole` (the failover ranking for code/verify):
 *  1. With recorded p50s (primary ~6s, candidate ~97s), the slow candidate is demoted
 *     below a within-3× candidate.
 *  2. When the primary is marked down, the guard lifts and the slow candidate is eligible.
 *  3. Unmeasured candidates are treated neutrally (not demoted).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogView, ModelPrice, ModelTier } from '@builderforce/model-catalog';
import { clearLatency, recordLatency, rankConnectedForRole } from './index.js';

interface Spec { vendor: string; tier?: ModelTier; price?: ModelPrice }

function viewOf(specs: Record<string, Spec>): CatalogView {
  return {
    vendorOf: (m) => specs[m]?.vendor ?? 'unknown',
    tierOf: (m) => specs[m]?.tier,
    priceOf: (m) => specs[m]?.price,
  };
}

// Same-tier candidates so the latency guard is the deciding key: what matters is the
// measured p50, not the tier ladder.
const VIEW = viewOf({
  kimi: { vendor: 'local', tier: 'STANDARD' },
  minimax: { vendor: 'direct/minimax', tier: 'STANDARD' },
  swift: { vendor: 'cloud', tier: 'STANDARD' },
});

const POOL = ['kimi', 'minimax', 'swift'];

/** A stable ~6s p50 for the primary. */
function seedPrimary6s(): void {
  for (const ms of [5900, 6100, 6000, 6050, 5950]) recordLatency('kimi', ms);
}

/** A stable ~97s p50 for the slow candidate (the incident numbers). */
function seedMinimax97s(): void {
  for (const ms of [97_000, 46_000, 25_000, 98_000, 97_500]) recordLatency('minimax', ms);
}

/** A stable ~12s p50 — within 3× of the 6s primary. */
function seedSwift12s(): void {
  for (const ms of [12_000, 11_800, 12_200, 12_100, 11_900]) recordLatency('swift', ms);
}

beforeEach(() => {
  clearLatency();
  seedPrimary6s();
  seedMinimax97s();
  seedSwift12s();
});

afterEach(() => {
  clearLatency();
});

describe('latency-aware failover (fix #8)', () => {
  it('demotes a >3× slower candidate below a within-3× candidate on a code role', () => {
    const ordered = rankConnectedForRole(POOL, VIEW, { role: 'code' });
    // 97s vs 6s primary is >3×; 12s swift is within 3×, so it leads the failover order.
    expect(ordered.indexOf('swift')).toBeLessThan(ordered.indexOf('minimax'));
    expect(ordered[0]).toBe('kimi'); // the primary itself still leads
  });

  it('applies the same demotion on a verify role', () => {
    const ordered = rankConnectedForRole(POOL, VIEW, { role: 'verify' });
    expect(ordered.indexOf('swift')).toBeLessThan(ordered.indexOf('minimax'));
  });

  it('lifts the guard when the primary is down — the slow candidate is eligible again', () => {
    const ordered = rankConnectedForRole(POOL, VIEW, { role: 'code', latency: { primaryDown: true } });
    // No latency key at all: same-tier candidates keep their given order.
    expect(ordered).toEqual(POOL);
  });

  it('treats unmeasured candidates neutrally (not demoted)', () => {
    clearLatency();
    seedPrimary6s(); // only the primary is measured; both candidates are unmeasured
    const ordered = rankConnectedForRole(POOL, VIEW, { role: 'code' });
    expect(ordered).toEqual(POOL);
  });

  it('demotes an over-budget candidate against an unmeasured candidate (no evidence of slowness wins)', () => {
    clearLatency();
    seedPrimary6s();
    seedMinimax97s();
    // swift has no recorded latency: neutral, keeps its place ahead of the demoted minimax.
    const ordered = rankConnectedForRole(POOL, VIEW, { role: 'code' });
    expect(ordered.indexOf('swift')).toBeLessThan(ordered.indexOf('minimax'));
  });

  it('a balanced (plan) role is untouched by the guard', () => {
    const ordered = rankConnectedForRole(POOL, VIEW, { role: 'plan' });
    expect(ordered).toEqual(POOL);
  });
});
