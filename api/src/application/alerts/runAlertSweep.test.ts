import { describe, expect, it } from 'vitest';
import {
  comparatorMatches,
  cooldownElapsed,
  buildAlertMessage,
} from './runAlertSweep';
import { ALERT_METRICS } from './metricEvaluators';

/**
 * Locks the pure alert-evaluation math behind the threshold alerts subsystem
 * (migration 0234) — no DB. Covers the comparator predicate (every operator +
 * boundary), the cooldown gate, and the message builder, plus a guard on the
 * supported-metric list staying in lockstep with the schema.
 */

describe('comparatorMatches', () => {
  it('gt: strictly above', () => {
    expect(comparatorMatches(11, 'gt', 10)).toBe(true);
    expect(comparatorMatches(10, 'gt', 10)).toBe(false);
    expect(comparatorMatches(9, 'gt', 10)).toBe(false);
  });

  it('gte: at or above', () => {
    expect(comparatorMatches(10, 'gte', 10)).toBe(true);
    expect(comparatorMatches(10.0001, 'gte', 10)).toBe(true);
    expect(comparatorMatches(9.999, 'gte', 10)).toBe(false);
  });

  it('lt: strictly below', () => {
    expect(comparatorMatches(9, 'lt', 10)).toBe(true);
    expect(comparatorMatches(10, 'lt', 10)).toBe(false);
    expect(comparatorMatches(11, 'lt', 10)).toBe(false);
  });

  it('lte: at or below', () => {
    expect(comparatorMatches(10, 'lte', 10)).toBe(true);
    expect(comparatorMatches(9, 'lte', 10)).toBe(true);
    expect(comparatorMatches(11, 'lte', 10)).toBe(false);
  });

  it('unknown comparator never matches (a bad operator must not fire a rule)', () => {
    expect(comparatorMatches(1000, 'eq' as unknown as string, 1)).toBe(false);
    expect(comparatorMatches(0, '' as unknown as string, 0)).toBe(false);
  });

  it('handles negatives and zero thresholds', () => {
    expect(comparatorMatches(-1, 'lt', 0)).toBe(true);
    expect(comparatorMatches(0, 'gte', 0)).toBe(true);
  });
});

describe('cooldownElapsed', () => {
  const now = Date.UTC(2026, 5, 27, 12, 0, 0);

  it('never-fired rule (null) is always eligible', () => {
    expect(cooldownElapsed(null, 24, now)).toBe(true);
  });

  it('within cooldown window is NOT eligible', () => {
    const firedOneHourAgo = new Date(now - 1 * 3_600_000);
    expect(cooldownElapsed(firedOneHourAgo, 24, now)).toBe(false);
  });

  it('past cooldown window is eligible', () => {
    const firedTwoDaysAgo = new Date(now - 48 * 3_600_000);
    expect(cooldownElapsed(firedTwoDaysAgo, 24, now)).toBe(true);
  });

  it('exactly at the boundary is eligible (>=)', () => {
    const firedExactly24hAgo = new Date(now - 24 * 3_600_000);
    expect(cooldownElapsed(firedExactly24hAgo, 24, now)).toBe(true);
  });

  it('zero cooldown is always eligible', () => {
    expect(cooldownElapsed(new Date(now), 0, now)).toBe(true);
  });
});

describe('buildAlertMessage', () => {
  it('names the rule, the metric label, the direction and both values', () => {
    const msg = buildAlertMessage('Cost guard', 'token_spend_usd', 'gt', 123.5, 100);
    expect(msg).toContain('Cost guard');
    expect(msg).toContain('Token spend (USD)');
    expect(msg).toContain('is above');
    expect(msg).toContain('123.50');
    expect(msg).toContain('100');
  });

  it('renders integers without decimals', () => {
    const msg = buildAlertMessage('Drift', 'eval_drift', 'gt', 3, 0);
    expect(msg).toContain('observed 3');
    expect(msg).toContain('threshold 0');
  });
});

describe('ALERT_METRICS', () => {
  it('lists exactly the seven supported metric keys', () => {
    expect([...ALERT_METRICS].sort()).toEqual(
      [
        'ai_effectiveness_score',
        'cost_per_merged_pr_usd',
        'dora_change_failure_rate',
        'dora_lead_time_hours',
        'eval_drift',
        'token_spend_pct_of_cap',
        'token_spend_usd',
      ].sort(),
    );
  });
});
