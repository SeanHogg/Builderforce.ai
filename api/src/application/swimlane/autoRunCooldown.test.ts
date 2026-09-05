/**
 * Per-ticket re-run cooldown — the backpressure between "instant retry on the next
 * 5-minute sweep tick" and the 3-strike circuit breaker.
 *
 * The cooldown and the breaker are composed by `assessRerunBackoff`, which BOTH the
 * evaluator (`evaluateTaskAutoRun`, for triage) and the dispatcher
 * (`dispatchCloudRunForTask`, for enforcement) consume — so a ticket can never be
 * shown one verdict and dispatched under another. This header used to claim the
 * evaluator was "the ONE evaluator every dispatch path funnels through"; it was not,
 * and that gap is exactly how task 467 accumulated 134 identical failed runs.
 */
import { describe, it, expect } from 'vitest';
import {
  assessRerunBackoff,
  autoRunCooldownMs,
  autoRunCooldownRemainingMs,
  classifyResolvedAutoRun,
  AUTORUN_COOLDOWN_BASE_MS,
  AUTORUN_COOLDOWN_MAX_MS,
  MAX_AUTONOMOUS_RUNS_PER_TASK,
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

/**
 * The verdict the DISPATCHER enforces. Extracted so it applies to every dispatch
 * path, not just the lane trigger — the omission that let task 467 accumulate 134
 * identical failed runs past a three-strike breaker that never saw one of them.
 */
describe('assessRerunBackoff', () => {
  const failedAt = (endedAt: string) => ({ status: 'failed', completedAt: new Date(endedAt) });
  const now = Date.parse('2026-07-11T20:00:00.000Z');

  it('lets a clean ticket through', () => {
    const v = assessRerunBackoff([{ status: 'completed', completedAt: new Date('2026-07-11T19:00:00.000Z') }], now);
    expect(v).toEqual({ consecutiveFailures: 0, cooldownRemainingMs: 0, blockedBy: null });
  });

  it('trips the breaker at the threshold and reports the streak', () => {
    const execs = Array.from({ length: MAX_CONSECUTIVE_AUTORUN_FAILURES }, () => failedAt('2026-07-11T10:00:00.000Z'));
    const v = assessRerunBackoff(execs, now);
    expect(v.consecutiveFailures).toBe(MAX_CONSECUTIVE_AUTORUN_FAILURES);
    expect(v.blockedBy).toBe('run_cap_exhausted');
  });

  it('stays tripped as the streak deepens — a storm never "ages out" of the breaker', () => {
    // 134 failures long since cooled down is still halted: the cooldown expires on its
    // own, the breaker does not, and that difference is the whole point.
    const execs = Array.from({ length: 134 }, () => failedAt('2026-07-01T10:00:00.000Z'));
    expect(assessRerunBackoff(execs, now).blockedBy).toBe('run_cap_exhausted');
  });

  it('backs off on a SINGLE recent failure without tripping the breaker', () => {
    const v = assessRerunBackoff([failedAt('2026-07-11T19:58:00.000Z')], now);
    expect(v.consecutiveFailures).toBe(1);
    expect(v.blockedBy).toBe('cooldown_active');
    expect(v.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('releases once the cooldown window has elapsed', () => {
    const v = assessRerunBackoff([failedAt('2026-07-11T19:00:00.000Z')], now);
    expect(v.consecutiveFailures).toBe(1);
    expect(v.blockedBy).toBeNull();
  });

  it('prefers the breaker over the cooldown — the stronger reason wins', () => {
    const execs = Array.from({ length: 5 }, () => failedAt('2026-07-11T19:59:00.000Z'));
    expect(assessRerunBackoff(execs, now).blockedBy).toBe('run_cap_exhausted');
  });

  it('clears the moment one run does not fail', () => {
    // A success at the head resets the streak even with failures behind it.
    const v = assessRerunBackoff(
      [{ status: 'completed', completedAt: new Date('2026-07-11T19:59:00.000Z') }, failedAt('2026-07-11T19:00:00.000Z')],
      now,
    );
    expect(v.consecutiveFailures).toBe(0);
    expect(v.blockedBy).toBeNull();
  });

  it('never blocks a ticket that has never run', () => {
    expect(assessRerunBackoff([], now).blockedBy).toBeNull();
  });
});

/**
 * The gap every test above shares: they all describe a FAILING ticket. The measured
 * incident was the opposite — 766 tickets took 510,632 dispatches while their runs
 * SUCCEEDED (ticket #147: 647 runs, 624 completed, then closed as done), so the streak
 * was 0, the cooldown was 0, and nothing refused the next dispatch. These pin the
 * lifetime ceiling that closes it.
 */
describe('MAX_AUTONOMOUS_RUNS_PER_TASK — the ceiling on a ticket that keeps SUCCEEDING', () => {
  const completed = () => ({ status: 'completed', produced: true, completedAt: new Date(NOW - 60_000) });

  it('blocks once the ticket reaches the ceiling, though every run succeeded', () => {
    const execs = Array.from({ length: MAX_AUTONOMOUS_RUNS_PER_TASK }, completed);
    const v = assessRerunBackoff(execs, NOW);
    // The point of the test: no failure streak and no cooldown, yet autonomy is stopped.
    expect(v.consecutiveFailures).toBe(0);
    expect(v.cooldownRemainingMs).toBe(0);
    expect(v.blockedBy).toBe('run_cap_exhausted');
  });

  it('does not block one run below the ceiling', () => {
    const execs = Array.from({ length: MAX_AUTONOMOUS_RUNS_PER_TASK - 1 }, completed);
    expect(assessRerunBackoff(execs, NOW).blockedBy).toBeNull();
  });

  it('would have stopped ticket #147 (647 successful runs) instead of letting it run on', () => {
    const execs = Array.from({ length: 647 }, completed);
    expect(assessRerunBackoff(execs, NOW).blockedBy).toBe('run_cap_exhausted');
  });

  it('reports the same verdict through the triage classifier, so neither can contradict the dispatcher', () => {
    const base = {
      gate: 'auto' as const,
      decisionAutoRun: true,
      hasCapabilityMismatch: false,
      sameLaneReentry: false,
      hasLiveExecution: false,
      consecutiveFailures: 0,
      cooldownRemainingMs: 0,
    };
    expect(classifyResolvedAutoRun({ ...base, totalRuns: MAX_AUTONOMOUS_RUNS_PER_TASK }))
      .toEqual({ reason: 'run_cap_exhausted', canRunNow: false });
    expect(classifyResolvedAutoRun({ ...base, totalRuns: MAX_AUTONOMOUS_RUNS_PER_TASK - 1 }))
      .toEqual({ reason: 'will_run', canRunNow: true });
    // Unknown count must never block — the field is optional for callers without the list.
    expect(classifyResolvedAutoRun(base)).toEqual({ reason: 'will_run', canRunNow: true });
  });
});
