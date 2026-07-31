import { describe, it, expect } from 'vitest';
import {
  classifyRunFailure, rollUpRunFailures, isPlatformFailure, RUN_FAILURE_LABEL,
  type RunFailureClass,
} from './runFailureReasons';
import {
  CLOUD_ORPHAN_REASON, CLOUD_LONG_LIVED_ORPHAN_REASON, INFRA_EVICTION_REASON,
  GITHUB_ACTIONS_NEVER_SCHEDULED_REASON, PAUSED_ORPHAN_REASON, HOST_ORPHAN_REASON,
  cloudCrashReason, githubActionsRunEndedReason, githubActionsUnreachableReason,
} from './orphanReasons';

/**
 * "agent runs failed: 162" AGAINST "completed: 16" WAS THE WHOLE REPORT.
 *
 * Measured on project 11, 2026-07-31: a 91% failure rate, and nothing anywhere said
 * why. That is the same blind spot the manager pass had before `PassBudget.mark` — a
 * number that proves something is wrong and cannot say what — and it was diagnosed by
 * guessing twice, wrongly, in one session.
 *
 * The classes are mapped from the platform's OWN reason constants, so what these tests
 * really pin is that the two stay in step: a reason whose wording drifts silently falls
 * into `unknown`, and the rollup is worth nothing if its largest row is always that.
 */
describe('run failure classification', () => {
  it('classifies every reason constant the platform actually writes', () => {
    const cases: Array<[string, RunFailureClass]> = [
      [CLOUD_ORPHAN_REASON, 'orphan_early'],
      [CLOUD_LONG_LIVED_ORPHAN_REASON, 'orphan_late'],
      [INFRA_EVICTION_REASON, 'infra_eviction'],
      [GITHUB_ACTIONS_NEVER_SCHEDULED_REASON, 'actions_never_scheduled'],
      [PAUSED_ORPHAN_REASON, 'paused_unanswered'],
      [HOST_ORPHAN_REASON, 'host_orphan'],
      [cloudCrashReason('ENOENT: no such file'), 'runtime_crash'],
      [githubActionsRunEndedReason('cancelled', 'https://gh/run/1'), 'actions_job_ended'],
      [githubActionsUnreachableReason('access denied'), 'actions_unreachable'],
    ];
    for (const [message, expected] of cases) {
      expect(classifyRunFailure(message), message.slice(0, 60)).toBe(expected);
    }
  });

  /**
   * The raw Cloudflare wording, not our prose — this is what the breaker reads, and the
   * two MUST agree or the report will blame the ticket for a deploy.
   */
  it('agrees with the breaker about what an infrastructure eviction is', () => {
    for (const m of ['Durable Object reset because its code was updated', 'the isolate was evicted']) {
      expect(classifyRunFailure(m)).toBe('infra_eviction');
      expect(isPlatformFailure(classifyRunFailure(m))).toBe(true);
    }
  });

  /**
   * Order matters. Every reason constant is prose containing words like "limit" and
   * "crash"; matching the generic keyword probes first would misfile the named reasons
   * under whatever happened to appear in their advice sentence.
   */
  it('prefers a named reason over a keyword that appears inside its advice', () => {
    expect(GITHUB_ACTIONS_NEVER_SCHEDULED_REASON).toContain('spending limit');
    expect(classifyRunFailure(GITHUB_ACTIONS_NEVER_SCHEDULED_REASON)).toBe('actions_never_scheduled');
    expect(CLOUD_ORPHAN_REASON).toMatch(/re-run/i);
    expect(classifyRunFailure(CLOUD_ORPHAN_REASON)).toBe('orphan_early');
  });

  it('reads vendor messages that reach us verbatim', () => {
    expect(classifyRunFailure('429 Too Many Requests')).toBe('rate_limited');
    expect(classifyRunFailure('401 Unauthorized: invalid api key')).toBe('auth_failed');
    expect(classifyRunFailure('merge conflict: cannot apply')).toBe('repo_error');
    expect(classifyRunFailure('no model available for this request')).toBe('model_unavailable');
  });

  /**
   * `unknown` is the USEFUL answer, never a bug to be tuned away: a wrong class sends
   * the reader to the wrong subsystem, which is worse than an honest "unclassified".
   */
  it('returns unknown rather than guessing, and never for an empty message', () => {
    expect(classifyRunFailure('kaboom')).toBe('unknown');
    expect(classifyRunFailure(null)).toBe('unknown');
    expect(classifyRunFailure('   ')).toBe('unknown');
  });

  it('labels every class — a row with no label is unreadable', () => {
    for (const cls of Object.keys(RUN_FAILURE_LABEL) as RunFailureClass[]) {
      expect(RUN_FAILURE_LABEL[cls].length).toBeGreaterThan(0);
    }
  });
});

describe('run failure rollup', () => {
  it('sums distinct messages into classes, largest first', () => {
    const rolled = rollUpRunFailures([
      { message: INFRA_EVICTION_REASON, count: 5 },
      { message: 'kaboom', count: 100 },
      { message: CLOUD_ORPHAN_REASON, count: 20 },
    ]);
    expect(rolled.map((r) => [r.reason, r.count])).toEqual([
      ['unknown', 100], ['orphan_early', 20], ['infra_eviction', 5],
    ]);
  });

  it('merges different messages that mean the same thing', () => {
    const rolled = rollUpRunFailures([
      { message: 'Durable Object reset because its code was updated', count: 3 },
      { message: INFRA_EVICTION_REASON, count: 4 },
    ]);
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ reason: 'infra_eviction', count: 7, platform: true });
  });

  /**
   * The sample must come from the LARGEST contributing message. Keeping the first-seen
   * one would let a single stray error represent a class of hundreds, which is exactly
   * the row a reader would act on first.
   */
  it('samples the dominant message, not the first one seen', () => {
    const rolled = rollUpRunFailures([
      { message: 'rare one-off', count: 1 },
      { message: 'the real problem', count: 99 },
    ]);
    expect(rolled[0]?.sample).toBe('the real problem');
  });

  it('carries raw text only where it adds something', () => {
    const rolled = rollUpRunFailures([
      { message: 'kaboom', count: 1 },
      { message: INFRA_EVICTION_REASON, count: 1 },
    ]);
    // `unknown` IS its message; a named reason would just repeat three sentences of advice.
    expect(rolled.find((r) => r.reason === 'unknown')?.sample).toBe('kaboom');
    expect(rolled.find((r) => r.reason === 'infra_eviction')?.sample).toBeNull();
  });

  it('truncates a sample so one stack trace cannot dominate the report', () => {
    const rolled = rollUpRunFailures([{ message: 'x'.repeat(5_000), count: 1 }], 50);
    expect(rolled[0]?.sample).toHaveLength(50);
  });

  it('is empty for a day with no failures', () => {
    expect(rollUpRunFailures([])).toEqual([]);
  });
});

/**
 * THE ENVELOPE IS NOT THE CAUSE.
 *
 * Measured on the very first capture this classifier produced (project 11, 2026-07-31):
 *
 *   78× (48%) runtime_crash — "This cloud run's runtime crashed before reporting
 *   completion: gateway error: Gateway 429 on model 'direct/meta/muse-spark-1.1' ·
 *   chain: openrouter/moonshotai/kimi-k3 → …"
 *   72× (44%) rate_limited
 *
 * Every one of those 78 is a rate limit wearing a crash's clothes, so the report split
 * ONE cause across two rows and made the largest fact on the board — 150 of 164 failures
 * (91%) being the free model pool returning 429 — look like two medium ones. Splitting a
 * dominant cause in half is worse than not classifying it at all.
 */
describe('classifyRunFailure — crash wrappers carry the real cause inside', () => {
  it('classifies the INNER cause of a wrapped crash, not the wrapper', () => {
    const wrapped = cloudCrashReason(
      "gateway error: Gateway 429 on model 'direct/meta/muse-spark-1.1' · chain: openrouter/moonshotai/kimi-k3 → claude-opus-5",
    );
    expect(classifyRunFailure(wrapped)).toBe('rate_limited');
    // And it must be counted as the platform's fault, not the ticket's — the two demand
    // opposite responses, and 91% of a board's failures being a provider ceiling is not
    // a board that is broken.
    expect(isPlatformFailure(classifyRunFailure(wrapped))).toBe(true);
  });

  it('keeps runtime_crash when the inner detail names nothing recognisable', () => {
    expect(classifyRunFailure(cloudCrashReason('ENOENT: no such file or directory'))).toBe('runtime_crash');
  });

  it('does not let the wrapper’s own advice sentence classify the failure', () => {
    // `cloudCrashReason` appends "…re-run the task — and if a container run keeps
    // crashing here the image or a tool call is unstable." Those words must never become
    // the inner probe's input.
    const wrapped = cloudCrashReason('disk full');
    expect(wrapped).toMatch(/re-run the task/);
    expect(classifyRunFailure(wrapped)).toBe('runtime_crash');
  });

  it('rolls the unwrapped failures in with their unwrapped twins', () => {
    const rolled = rollUpRunFailures([
      { message: cloudCrashReason('Gateway 429 on model x'), count: 78 },
      { message: '429 Too Many Requests', count: 72 },
      { message: CLOUD_ORPHAN_REASON, count: 14 },
    ]);
    // One cause, one row, 150 — not 78 + 72 read as two different problems.
    expect(rolled[0]).toMatchObject({ reason: 'rate_limited', count: 150 });
    expect(rolled).toHaveLength(2);
  });
});
