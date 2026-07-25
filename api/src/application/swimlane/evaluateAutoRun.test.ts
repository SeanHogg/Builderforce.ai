import { describe, it, expect } from 'vitest';
import {
  classifyResolvedAutoRun,
  parseRequiredCapabilities,
  trailingFailureStreak,
  autoRunCooldownRemainingMs,
  AUTORUN_COOLDOWN_BASE_MS,
  MAX_CONSECUTIVE_AUTORUN_FAILURES,
  AUTO_RUN_REASON_TEXT,
  EVALUATED_AUTO_RUN_REASONS,
  evaluateTaskAutoRun,
  pickManifestProducer,
  type ManifestSlot,
} from './evaluateAutoRun';
import type { Db } from '../../infrastructure/database/connection';
import type { RuntimeService } from '../runtime/RuntimeService';
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

  // The loop guard and a live run are DIFFERENT facts. They shared `already_running`
  // until a stall report claimed a live run on a ticket whose own gate snapshot printed
  // `liveExecution: (none)` — the reader could only resolve that by reading the source.
  it('suppresses a same-lane completion loop with its OWN reason, not already_running', () => {
    expect(classifyResolvedAutoRun({ ...base, sameLaneReentry: true }))
      .toEqual({ reason: 'same_lane_reentry', canRunNow: false });
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

  it('the loop guard outranks a live run, so a re-entry never reports a phantom execution', () => {
    expect(classifyResolvedAutoRun({ ...base, sameLaneReentry: true, hasLiveExecution: true }).reason)
      .toBe('same_lane_reentry');
  });
});

describe('AUTO_RUN_REASON_TEXT / EVALUATED_AUTO_RUN_REASONS — the reason vocabulary', () => {
  // Every reason the classifier or the evaluator can return must have a sentence: a
  // machine caller (the MCP task tools) and the lifecycle report both read this table
  // by key, and a missing entry degrades to the bare enum word — the "no explanation
  // at all" failure mode the ledger exists to remove.
  it('gives every evaluated reason a sentence', () => {
    for (const reason of EVALUATED_AUTO_RUN_REASONS) {
      expect(AUTO_RUN_REASON_TEXT[reason], reason).toBeTruthy();
    }
  });

  it('states that the workspace token block holds EVERY ticket, not just this one', () => {
    expect(AUTO_RUN_REASON_TEXT.tenant_token_limit).toContain('EVERY ticket');
  });

  // A live `will_run` legitimately refutes a stale recorded skip only for conditions
  // the evaluator actually models. The token gate is modelled now, so it belongs in
  // the set; the requirement gate and the cloud-run cap are applied later and must not.
  it('claims only the gates the evaluator itself resolves', () => {
    expect(EVALUATED_AUTO_RUN_REASONS.has('tenant_token_limit')).toBe(true);
    expect(EVALUATED_AUTO_RUN_REASONS.has('same_lane_reentry')).toBe(true);
    expect(EVALUATED_AUTO_RUN_REASONS.has('lane_requirement_gate')).toBe(false);
    expect(EVALUATED_AUTO_RUN_REASONS.has('cloud_run_limit')).toBe(false);
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

  // A deploy resets every live Durable Object at once, so an ordinary release used
  // to spend strikes against the 3-failure breaker on healthy tickets. Measured on
  // task 683: 3 of its 5 failures were this message inside one 47-minute window.
  const evicted = { status: 'failed', errorMessage: 'Durable Object reset because its code was updated.' };

  it('does not count a platform eviction as a strike', () => {
    expect(trailingFailureStreak([evicted, evicted, evicted])).toBe(0);
  });

  it('skips an eviction without BREAKING a genuine streak around it', () => {
    // Conservative on purpose: a deploy landing between two real failures must not
    // hand the ticket a clean slate, or the breaker stops catching retry storms.
    expect(trailingFailureStreak([{ status: 'failed' }, evicted, { status: 'failed' }])).toBe(2);
  });

  it('still stops at a completed run sitting behind an eviction', () => {
    expect(trailingFailureStreak([evicted, { status: 'completed' }, { status: 'failed' }])).toBe(0);
  });

  it('backs off from the newest COUNTED failure, not from an eviction on top of it', () => {
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);
    const realFailedAt = new Date(now - 60_000);          // 1 min ago → still cooling
    const remaining = autoRunCooldownRemainingMs([
      { ...evicted, completedAt: new Date(now - 1_000) }, // a deploy 1s ago
      { status: 'failed', completedAt: realFailedAt },
    ], now);
    // One counted failure → a 5-minute window measured from the REAL failure, so
    // ~4 minutes are still owed. Measuring from the eviction would have said ~5.
    expect(remaining).toBe(AUTORUN_COOLDOWN_BASE_MS - 60_000);
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

/**
 * The lane a verdict is ABOUT is read live from `tasks.status` — never the status
 * the caller passed in.
 *
 * MEASURED FAILURE (task 683). The autonomous sweep snapshots hundreds of candidate
 * rows and then dispatches them one at a time. A ticket whose run completed in that
 * window advanced into the human-gated review lane, but the sweep was still holding
 * `in_progress`, so the evaluator resolved the AUTO-gated Implementation lane,
 * answered `will_run`, and the dispatch dragged the ticket back to `in_progress`.
 * Repeated every tick: 8 backward hops, 17 autonomous hops, 0 human hops, and a
 * human gate that never once held. Re-reading the row costs nothing (the same query
 * already loads the owner + source) and makes the gate unbypassable.
 */
describe('evaluateTaskAutoRun — the lane comes from the ROW, not the caller', () => {
  /** Minimal drizzle stand-in: each awaited chain shifts the next queued result. */
  function stubDb(results: unknown[][]): Db {
    const queue = [...results];
    const builder = (): Record<string, unknown> => {
      const self: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin']) self[m] = () => self;
      self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queue.shift() ?? []).then(resolve);
      return self;
    };
    return { select: () => builder() } as unknown as Db;
  }

  const noRuns = { listByTask: async () => [] } as unknown as RuntimeService;

  /** Query order inside the evaluator: task row → board → lane → lane staffing → lane requirements. */
  const rows = (taskStatus: string, gate: 'auto' | 'human') => [
    [{ assignedAgentRef: 'owner-1', source: null, status: taskStatus }],
    [{ id: 1, projectId: 7, tenantId: 3, lifecycleManaged: false }],
    [{ id: 10, gate, isTerminal: false }],
    [{ agentRef: 'lane-agent', model: null, requiredCapabilities: null }],
    [],
  ];

  const args = {
    tenantId: 3, projectId: 7, taskId: 683,
    // What the sweep read minutes ago — the ticket has since moved on.
    status: TaskStatus.IN_PROGRESS,
    // Supplied so the token gate needs no lookup; the point under test is the lane.
    tenantTokens: {
      hasTokens: true, reason: null, usageToday: 0, dailyLimit: -1,
      usageMonth: 0, monthlyLimit: -1, effectivePlan: 'pro' as const,
    },
  };

  it('gates on the human-gated lane the ticket is ACTUALLY in, not the stale one passed in', async () => {
    const e = await evaluateTaskAutoRun(stubDb(rows(TaskStatus.IN_REVIEW, 'human')), noRuns, args);
    expect(e.status).toBe(TaskStatus.IN_REVIEW);
    expect(e.laneGate).toBe('human');
    expect(e.reason).toBe('human_gate');
    expect(e.canRunNow).toBe(false);
  });

  it('still runs when the row agrees with the caller and the lane is auto-gated', async () => {
    const e = await evaluateTaskAutoRun(stubDb(rows(TaskStatus.IN_PROGRESS, 'auto')), noRuns, args);
    expect(e.status).toBe(TaskStatus.IN_PROGRESS);
    expect(e.canRunNow).toBe(true);
    expect(e.reason).toBe('will_run');
    expect(e.decision.agentRef).toBe('lane-agent');
  });

  it('holds the ticket when the WORKSPACE is out of tokens — the gate that leaves no trace', async () => {
    const e = await evaluateTaskAutoRun(stubDb(rows(TaskStatus.IN_PROGRESS, 'auto')), noRuns, {
      ...args,
      tenantTokens: {
        hasTokens: false, reason: 'monthly_exhausted', usageToday: 5, dailyLimit: 100,
        usageMonth: 1_200_000, monthlyLimit: 1_000_000, effectivePlan: 'free',
      },
    });
    expect(e.reason).toBe('tenant_token_limit');
    expect(e.canRunNow).toBe(false);
    // The numbers travel with the verdict: "the plan ran out" is a different action
    // from every other gate, and the report has to be able to show why.
    expect(e.tenantTokens).toMatchObject({ hasTokens: false, usageMonth: 1_200_000 });
    // A human "Run now" dispatches off `candidate`, which the token gate never clears.
    expect(e.candidate?.agentRef).toBe('lane-agent');
  });

  it('falls back to the caller\'s status only when the row is gone', async () => {
    const e = await evaluateTaskAutoRun(stubDb([[], []]), noRuns, args);
    expect(e.status).toBe(TaskStatus.IN_PROGRESS);
    expect(e.reason).toBe('no_board');
  });
});
