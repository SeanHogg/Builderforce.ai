/**
 * Per-ticket re-run cooldown — the backpressure between "instant retry on the next
 * 5-minute sweep tick" and the 3-strike circuit breaker.
 *
 * The cooldown is evaluated inside `evaluateTaskAutoRun` (the ONE evaluator every
 * dispatch path funnels through), derived from the SAME newest-first execution list
 * the breaker counts, so these pure units are what every surface actually applies.
 */
import { describe, it, expect } from 'vitest';
import {
  autoRunCooldownMs,
  autoRunCooldownRemainingMs,
  classifyResolvedAutoRun,
  AUTORUN_COOLDOWN_BASE_MS,
  AUTORUN_COOLDOWN_MAX_MS,
  MAX_CONSECUTIVE_AUTORUN_FAILURES,
} from './evaluateAutoRun';

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const failed = (endedMsAgo: number) => ({
  status: 'failed',
  completedAt: new Date(NOW - endedMsAgo),
  updatedAt: null,
  createdAt: new Date(NOW - endedMsAgo),
});

describe('autoRunCooldownMs — exponential backoff per consecutive failure', () => {
  it('is zero for a ticket with no trailing failure (the common case: no backoff)', () => {
    expect(autoRunCooldownMs(0)).toBe(0);
    expect(autoRunCooldownMs(-1)).toBe(0);
  });

  it('doubles with each consecutive failure', () => {
    expect(autoRunCooldownMs(1)).toBe(AUTORUN_COOLDOWN_BASE_MS);
    expect(autoRunCooldownMs(2)).toBe(AUTORUN_COOLDOWN_BASE_MS * 2);
    expect(autoRunCooldownMs(3)).toBe(AUTORUN_COOLDOWN_BASE_MS * 4);
  });

  it('never backs off beyond the cap, however long the streak', () => {
    expect(autoRunCooldownMs(50)).toBe(AUTORUN_COOLDOWN_MAX_MS);
  });
});

describe('autoRunCooldownRemainingMs — from the run history the breaker already reads', () => {
  it('owes nothing when the ticket has never run', () => {
    expect(autoRunCooldownRemainingMs([], NOW)).toBe(0);
  });

  it('owes nothing when the newest run succeeded (a success clears the streak)', () => {
    const execs = [{ status: 'completed', completedAt: new Date(NOW - 1_000) }, failed(2_000)];
    expect(autoRunCooldownRemainingMs(execs, NOW)).toBe(0);
  });

  it('owes the remainder of the window right after a failure', () => {
    const remaining = autoRunCooldownRemainingMs([failed(60_000)], NOW);
    expect(remaining).toBe(AUTORUN_COOLDOWN_BASE_MS - 60_000);
  });

  it('owes nothing once the window has elapsed', () => {
    expect(autoRunCooldownRemainingMs([failed(AUTORUN_COOLDOWN_BASE_MS + 1)], NOW)).toBe(0);
  });

  it('waits longer after a second consecutive failure (backoff compounds)', () => {
    const execs = [failed(AUTORUN_COOLDOWN_BASE_MS + 1), failed(AUTORUN_COOLDOWN_BASE_MS * 3)];
    // Past the 1-failure window, still inside the doubled 2-failure window.
    expect(autoRunCooldownRemainingMs([execs[0]!], NOW)).toBe(0);
    expect(autoRunCooldownRemainingMs(execs, NOW)).toBeGreaterThan(0);
  });

  it('never blocks on a row with no usable timestamp', () => {
    expect(autoRunCooldownRemainingMs([{ status: 'failed' }], NOW)).toBe(0);
  });

  it('falls back to updatedAt, then createdAt, when completedAt is absent', () => {
    const viaUpdated = [{ status: 'failed', updatedAt: new Date(NOW - 60_000) }];
    const viaCreated = [{ status: 'failed', createdAt: new Date(NOW - 60_000) }];
    expect(autoRunCooldownRemainingMs(viaUpdated, NOW)).toBe(AUTORUN_COOLDOWN_BASE_MS - 60_000);
    expect(autoRunCooldownRemainingMs(viaCreated, NOW)).toBe(AUTORUN_COOLDOWN_BASE_MS - 60_000);
  });
});

describe('classifyResolvedAutoRun — cooldown_active in the reason priority order', () => {
  const base = {
    gate: 'auto' as const,
    decisionAutoRun: true,
    hasCapabilityMismatch: false,
    sameLaneReentry: false,
    hasLiveExecution: false,
  };

  it('halts an otherwise-runnable ticket while the cooldown is owed', () => {
    expect(classifyResolvedAutoRun({ ...base, consecutiveFailures: 1, cooldownRemainingMs: 60_000 }))
      .toEqual({ reason: 'cooldown_active', canRunNow: false });
  });

  it('runs again once the cooldown has elapsed', () => {
    expect(classifyResolvedAutoRun({ ...base, consecutiveFailures: 1, cooldownRemainingMs: 0 }))
      .toEqual({ reason: 'will_run', canRunNow: true });
  });

  it('reports the STRONGER breaker reason when the ticket is also halted', () => {
    expect(classifyResolvedAutoRun({
      ...base,
      consecutiveFailures: MAX_CONSECUTIVE_AUTORUN_FAILURES,
      cooldownRemainingMs: 60_000,
    })).toEqual({ reason: 'run_cap_exhausted', canRunNow: false });
  });

  it('never masks an earlier reason (a human gate still reads human_gate)', () => {
    expect(classifyResolvedAutoRun({ ...base, gate: 'human', cooldownRemainingMs: 60_000 }))
      .toEqual({ reason: 'human_gate', canRunNow: false });
  });

  it('only ever suppresses canRunNow — never the `candidate` a human Run-now dispatches', () => {
    // The cooldown lives entirely in the canRunNow verdict; `candidate` is resolved
    // independently in evaluateTaskAutoRun, which is what makes Run-now an override.
    const cooled = classifyResolvedAutoRun({ ...base, consecutiveFailures: 2, cooldownRemainingMs: 1 });
    expect(cooled.canRunNow).toBe(false);
    expect(cooled.reason).toBe('cooldown_active');
  });
});
