import { describe, it, expect } from 'vitest';
import {
  classifyResolvedAutoRun,
  parseRequiredCapabilities,
  trailingFailureStreak,
  MAX_CONSECUTIVE_AUTORUN_FAILURES,
  pickManifestProducer,
  type ManifestSlot,
} from './evaluateAutoRun';
import { isReviewLane } from '../task/taskLifecycle';
import { DEFAULT_SWIMLANES } from './defaultSwimlanes';
import { TaskStatus } from '../../domain/shared/types';

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

describe('pickManifestProducer — the per-stage executor on a lifecycle-managed board', () => {
  const slot = (over: Partial<ManifestSlot> = {}): ManifestSlot => ({
    assigneeRef: 'john-coder',
    responsibility: 'owner',
    state: 'pending',
    ...over,
  });

  it('picks an agent-resolved owner slot that still owes work', () => {
    expect(pickManifestProducer([slot()])).toBe('john-coder');
  });

  it('accepts a contributor as a producer', () => {
    expect(pickManifestProducer([slot({ responsibility: 'contributor', assigneeRef: 'bob-dev' })])).toBe('bob-dev');
  });

  it('never picks a reviewer — a reviewer is not the stage producer', () => {
    expect(pickManifestProducer([slot({ responsibility: 'reviewer' })])).toBeNull();
  });

  it('skips slots whose work is already finished, waived or skipped', () => {
    for (const state of ['completed', 'waived', 'skipped']) {
      expect(pickManifestProducer([slot({ state })])).toBeNull();
    }
  });

  it('re-dispatches a slot that had changes requested', () => {
    expect(pickManifestProducer([slot({ state: 'changes_requested' })])).toBe('john-coder');
  });

  it('ignores an unresolved slot (no assignee yet)', () => {
    expect(pickManifestProducer([slot({ assigneeRef: null })])).toBeNull();
  });

  it('prefers the first open producer when several slots exist', () => {
    const rows = [
      slot({ responsibility: 'reviewer', assigneeRef: 'validator-t1' }),
      slot({ state: 'completed', assigneeRef: 'kevin-pm' }),
      slot({ assigneeRef: 'john-coder' }),
    ];
    expect(pickManifestProducer(rows)).toBe('john-coder');
  });

  it('is null for an empty manifest — which correctly reads as no_agent', () => {
    expect(pickManifestProducer([])).toBeNull();
  });
});

/**
 * The guardrail that makes the auto-gated `in_review` lane (0369) safe.
 *
 * Opening that gate lets a lane dispatch a REVIEWER. The danger is the owner
 * fallback: on every other lane it correctly answers "I assigned Ada to this
 * ticket, why isn't she working it", but on a review lane the ticket's owner is
 * (almost always) the agent that produced the work — so the same fallback would
 * have the author grade its own homework and record a sign-off for it.
 */
describe('isReviewLane — the no-self-review lane class', () => {
  it('classifies the review lane', () => {
    expect(isReviewLane(TaskStatus.IN_REVIEW)).toBe(true);
  });

  it('does NOT classify producing lanes, where the owner fallback is correct', () => {
    for (const s of [TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.DONE]) {
      expect(isReviewLane(s)).toBe(false);
    }
  });

  it('is null-safe — an unresolved status is not a review lane', () => {
    expect(isReviewLane(null)).toBe(false);
    expect(isReviewLane(undefined)).toBe(false);
    expect(isReviewLane('')).toBe(false);
  });
});

describe('DEFAULT_SWIMLANES — the seeded gates', () => {
  it('no longer ships in_review human-gated (the 0.7%-autonomy default)', () => {
    // A human gate did not mean "a human reviews this" — nobody was reviewing. It
    // meant every board shipped with autonomy off one lane short of Done.
    expect(DEFAULT_SWIMLANES.find((l) => l.key === TaskStatus.IN_REVIEW)?.gate).toBe('auto');
  });

  it('seeds no human gate at all — a human gate is now an explicit operator choice', () => {
    expect(DEFAULT_SWIMLANES.filter((l) => l.gate === 'human')).toEqual([]);
  });

  it('keeps Done terminal so an auto gate never re-runs a finished ticket', () => {
    expect(DEFAULT_SWIMLANES.find((l) => l.key === TaskStatus.DONE)?.isTerminal).toBe(true);
  });
});
