import { describe, it, expect } from 'vitest';
import {
  classifyResolvedAutoRun,
  parseRequiredCapabilities,
  trailingFailureStreak,
  MAX_CONSECUTIVE_AUTORUN_FAILURES,
} from './evaluateAutoRun';

describe('classifyResolvedAutoRun', () => {
  const base = {
    gate: 'auto' as const,
    decisionAutoRun: true,
    hasCapabilityMismatch: false,
    sameLaneReentry: false,
    hasLiveExecution: false,
  };

  it('runs when an agent qualifies on an auto-gated lane with no live run', () => {
    expect(classifyResolvedAutoRun(base)).toEqual({ reason: 'will_run', canRunNow: true });
  });

  it('a human-gated lane never auto-runs (waits for approval / Run now)', () => {
    expect(classifyResolvedAutoRun({ ...base, gate: 'human' })).toEqual({ reason: 'human_gate', canRunNow: false });
  });

  it('reports no_agent when nothing qualifies and there was no mismatch', () => {
    expect(classifyResolvedAutoRun({ ...base, decisionAutoRun: false })).toEqual({ reason: 'no_agent', canRunNow: false });
  });

  it('reports capability_mismatch when candidates were skipped for missing capabilities', () => {
    expect(classifyResolvedAutoRun({ ...base, decisionAutoRun: false, hasCapabilityMismatch: true }))
      .toEqual({ reason: 'capability_mismatch', canRunNow: false });
  });

  it('suppresses a same-lane completion loop (already_running)', () => {
    expect(classifyResolvedAutoRun({ ...base, sameLaneReentry: true })).toEqual({ reason: 'already_running', canRunNow: false });
  });

  it('does not stack a second run when one is already live', () => {
    expect(classifyResolvedAutoRun({ ...base, hasLiveExecution: true })).toEqual({ reason: 'already_running', canRunNow: false });
  });

  it('gate precedence: a human gate wins even when an agent would otherwise run', () => {
    expect(classifyResolvedAutoRun({ ...base, gate: 'human', hasLiveExecution: true }).reason).toBe('human_gate');
  });

  it('halts autonomy once the consecutive-failure streak hits the cap', () => {
    expect(classifyResolvedAutoRun({ ...base, consecutiveFailures: MAX_CONSECUTIVE_AUTORUN_FAILURES }))
      .toEqual({ reason: 'run_cap_exhausted', canRunNow: false });
  });

  it('still runs while the failure streak is below the cap', () => {
    expect(classifyResolvedAutoRun({ ...base, consecutiveFailures: MAX_CONSECUTIVE_AUTORUN_FAILURES - 1 }))
      .toEqual({ reason: 'will_run', canRunNow: true });
  });

  it('a live run still takes precedence over the failure breaker (avoids stacking)', () => {
    expect(classifyResolvedAutoRun({ ...base, hasLiveExecution: true, consecutiveFailures: 99 }).reason)
      .toBe('already_running');
  });
});

describe('trailingFailureStreak', () => {
  it('counts leading (newest-first) failed runs', () => {
    expect(trailingFailureStreak([{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }])).toBe(3);
  });

  it('stops at the first non-failed run (a completed/cancelled/live resets it)', () => {
    expect(trailingFailureStreak([{ status: 'failed' }, { status: 'completed' }, { status: 'failed' }])).toBe(1);
    expect(trailingFailureStreak([{ status: 'running' }, { status: 'failed' }])).toBe(0);
    expect(trailingFailureStreak([{ status: 'cancelled' }, { status: 'failed' }])).toBe(0);
  });

  it('is 0 for no runs', () => {
    expect(trailingFailureStreak([])).toBe(0);
  });
});

describe('parseRequiredCapabilities', () => {
  it('parses a JSON array of non-empty trimmed strings', () => {
    expect(parseRequiredCapabilities('["coding-agent", " github "]')).toEqual(['coding-agent', 'github']);
  });
  it('returns [] for null/blank/non-array/garbage', () => {
    expect(parseRequiredCapabilities(null)).toEqual([]);
    expect(parseRequiredCapabilities('')).toEqual([]);
    expect(parseRequiredCapabilities('{"a":1}')).toEqual([]);
    expect(parseRequiredCapabilities('not json')).toEqual([]);
  });
});
