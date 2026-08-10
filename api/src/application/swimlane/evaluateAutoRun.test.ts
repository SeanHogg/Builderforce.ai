import { describe, it, expect, vi } from 'vitest';

vi.mock('../kanban/managedLaneRoles', () => ({ resolveManagedProducer: vi.fn() }));
import {
  classifyResolvedAutoRun,
  parseRequiredCapabilities,
  trailingUnproductiveStreak,
  autoRunCooldownRemainingMs,
  AUTORUN_COOLDOWN_BASE_MS,
  MAX_CONSECUTIVE_AUTORUN_FAILURES,
  AUTO_RUN_REASON_TEXT,
  EVALUATED_AUTO_RUN_REASONS,
  evaluateTaskAutoRun,
} from './evaluateAutoRun';
import { resolveManagedProducer } from '../kanban/managedLaneRoles';
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

  // A managed stage with no role-attributed producer is a STRICTLY more specific answer
  // than `no_agent`, and it must outrank it: `no_agent` tells the operator to assign an
  // owner, which on a managed board does nothing at all (the assignee is the Coordinator).
  it('reports managed_no_role rather than the generic no_agent on a managed stage', () => {
    expect(classifyResolvedAutoRun({ ...base, decisionAutoRun: false, managedNoRole: true }))
      .toEqual({ reason: 'managed_no_role', canRunNow: false });
  });

  it('never lets a managed stage with no role report will_run', () => {
    expect(classifyResolvedAutoRun({ ...base, managedNoRole: true }).canRunNow).toBe(false);
  });

  it('a human gate still outranks it — an operator gate is not a configuration defect', () => {
    expect(classifyResolvedAutoRun({ ...base, gate: 'human', managedNoRole: true }).reason).toBe('human_gate');
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

describe('trailingUnproductiveStreak', () => {
  it('counts leading (newest-first) failed runs', () => {
    expect(trailingUnproductiveStreak([{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }])).toBe(3);
  });

  it('stops at the first run that produced something (cancelled/live also reset it)', () => {
    expect(trailingUnproductiveStreak([{ status: 'failed' }, { status: 'completed', produced: true }, { status: 'failed' }])).toBe(1);
    expect(trailingUnproductiveStreak([{ status: 'running' }, { status: 'failed' }])).toBe(0);
    expect(trailingUnproductiveStreak([{ status: 'cancelled' }, { status: 'failed' }])).toBe(0);
  });

  /**
   * THE 5,796 RUNS (0385). The streak counted `failed` and nothing else, which made
   * FAILURE the executor's only stopping condition. A run that COMPLETED and shipped
   * nothing reset the streak to zero and owed no cooldown, so the ticket was
   * re-dispatched on the very next five-minute tick — forever.
   *
   * Measured on project 11, 2026-07-29: 5,931 runs completed and 10 failed in ONE DAY,
   * against 3 finished tickets and 2 merged PRs. One agent accounted for 5,796 runs and
   * 0 finished tickets. The breaker was sitting right there and never armed once. The
   * same burn is why 371 tickets on that board had never run at all — the tenant's
   * 25-per-tick dispatch ceiling was ~80% consumed by the re-runs.
   */
  it('counts a COMPLETED run that shipped nothing — failure is not the only way to waste a run', () => {
    const empty = { status: 'completed', produced: false };
    expect(trailingUnproductiveStreak([empty, empty, empty])).toBe(3);
    // Mixed: a failure and two empty completions are one unbroken streak.
    expect(trailingUnproductiveStreak([empty, { status: 'failed' }, empty])).toBe(3);
  });

  it('clears the moment one run ships', () => {
    const empty = { status: 'completed', produced: false };
    expect(trailingUnproductiveStreak([{ status: 'completed', produced: true }, empty, empty])).toBe(0);
  });

  /**
   * LOAD-BEARING, not laziness. Every row written before 0385 is unjudged, as is every
   * dispatch surface that does not route through `finalizeCloudRun`. Reading `null` as
   * unproductive would trip the breaker on every ticket on every board on the deploy
   * that shipped it, and halt autonomy platform-wide.
   */
  it('treats an UNJUDGED run as productive, so an unknown can never halt a board', () => {
    expect(trailingUnproductiveStreak([{ status: 'completed' }, { status: 'failed' }])).toBe(0);
    expect(trailingUnproductiveStreak([{ status: 'completed', produced: null }, { status: 'failed' }])).toBe(0);
    // And a legacy row sitting behind fresh empties still stops the walk there.
    expect(trailingUnproductiveStreak([
      { status: 'completed', produced: false },
      { status: 'completed' },
      { status: 'completed', produced: false },
    ])).toBe(1);
  });

  it('is 0 for no runs', () => {
    expect(trailingUnproductiveStreak([])).toBe(0);
  });

  // A deploy resets every live Durable Object at once, so an ordinary release used
  // to spend strikes against the 3-failure breaker on healthy tickets. Measured on
  // task 683: 3 of its 5 failures were this message inside one 47-minute window.
  const evicted = { status: 'failed', errorMessage: 'Durable Object reset because its code was updated.' };

  it('does not count a platform eviction as a strike', () => {
    expect(trailingUnproductiveStreak([evicted, evicted, evicted])).toBe(0);
  });

  it('does not let platform capacity or lost-worker failures poison a ticket breaker', () => {
    const platformFailures = [
      { status: 'failed', errorMessage: '429 Too Many Requests' },
      { status: 'failed', errorMessage: 'This cloud run went silent mid-run after running well past the startup wall.' },
      { status: 'failed', errorMessage: "Runtime signalled the container to exit due to a new version rollout: 143" },
    ];
    expect(trailingUnproductiveStreak(platformFailures)).toBe(0);
  });

  it('skips platform failures without clearing genuine no-op failures around them', () => {
    expect(trailingUnproductiveStreak([
      { status: 'failed', errorMessage: 'agent returned an invalid patch' },
      { status: 'failed', errorMessage: '429 Too Many Requests' },
      { status: 'completed', produced: false },
    ])).toBe(2);
  });

  it('skips an eviction without BREAKING a genuine streak around it', () => {
    // Conservative on purpose: a deploy landing between two real failures must not
    // hand the ticket a clean slate, or the breaker stops catching retry storms.
    expect(trailingUnproductiveStreak([{ status: 'failed' }, evicted, { status: 'failed' }])).toBe(2);
  });

  it('still stops at a productive run sitting behind an eviction', () => {
    expect(trailingUnproductiveStreak([evicted, { status: 'completed', produced: true }, { status: 'failed' }])).toBe(0);
  });

  it('backs off from an empty completion, not only from a failure', () => {
    // The cooldown must measure from whichever run actually counted, or the ticket
    // that completes-and-ships-nothing keeps its zero-wait re-dispatch.
    const now = Date.UTC(2026, 6, 29, 12, 0, 0);
    const remaining = autoRunCooldownRemainingMs(
      [{ status: 'completed', produced: false, completedAt: new Date(now - 60_000) }],
      now,
    );
    expect(remaining).toBeGreaterThan(0);
  });

  it('backs off from a platform failure without spending a ticket-breaker strike', () => {
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);
    const realFailedAt = new Date(now - 60_000);          // 1 min ago → still cooling
    const remaining = autoRunCooldownRemainingMs([
      { ...evicted, completedAt: new Date(now - 1_000) }, // a deploy 1s ago
      { status: 'failed', completedAt: realFailedAt },
    ], now);
    // Both terminal failures strengthen retry backoff, measured from the newest event;
    // the eviction remains excluded from the ticket's breaker streak above.
    expect(remaining).toBe(AUTORUN_COOLDOWN_BASE_MS * 2 - 1_000);
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

// The per-stage producer pick moved to `kanban/managedLaneRoles` (and gained the
// authorised-role check the guard enforces) — see `managedLaneRoles.test.ts`. It lives
// with the guard's resolver now precisely so the two cannot drift apart again.

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

/**
 * A LIFECYCLE-MANAGED board: the verdict must name a ROLE, or there is no verdict.
 *
 * MEASURED FAILURE (project 11). The evaluator resolved "which agent" and stopped there,
 * so it answered `will_run` for a ticket whose dispatch the guard then refused — the
 * throw happened before an execution row existed, so no failure was recorded, the breaker
 * never engaged, and the refusal repeated on every sweep for weeks. The gate snapshot
 * printed "Nothing is gating this ticket" the whole time.
 */
describe('evaluateTaskAutoRun — a lifecycle-managed board', () => {
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

  /** Query order: task row → board → lane → lane staffing. (The managed branch resolves
   *  its producer through the mocked `resolveManagedProducer`, not through this db.) */
  const rows = (status: string) => [
    [{ assignedAgentRef: 'coordinator-1', source: null, status, taskType: 'task', actionType: null }],
    [{ id: 'b1', projectId: 11, tenantId: 1, lifecycleManaged: true }],
    [{ id: 'lane-1', gate: 'auto', isTerminal: false }],
    [{ agentRef: 'lane-agent', model: null, requiredCapabilities: null }],
  ];

  const args = {
    tenantId: 1, projectId: 11, taskId: 1032, status: TaskStatus.TODO,
    tenantTokens: {
      hasTokens: true, reason: null, usageToday: 0, dailyLimit: -1,
      usageMonth: 0, monthlyLimit: -1, effectivePlan: 'free' as const,
    },
  };

  it('dispatches AS the resolved role, not as an arbitrary staffed agent', async () => {
    vi.mocked(resolveManagedProducer).mockResolvedValue({
      producer: { roleKey: 'developer', agentRef: 'bob-dev', model: null, source: 'manifest' },
      authority: { roleKeys: ['developer', 'architect'], approvers: [], tier: 'requirements' },
    });

    const e = await evaluateTaskAutoRun(stubDb(rows(TaskStatus.TODO)), noRuns, args);

    expect(e.canRunNow).toBe(true);
    expect(e.reason).toBe('will_run');
    expect(e.lifecycleManaged).toBe(true);
    expect(e.managedRole).toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest' });
    // The candidate is the ROLE's agent — never `lane-agent`, which the guard would refuse.
    expect(e.decision.agentRef).toBe('bob-dev');
    // Reported so the gate snapshot can say WHICH roles the stage authorises.
    expect(e.managedRole?.authorizedRoleKeys).toEqual(['developer', 'architect']);
  });

  // The lie this fix removes: a staffed lane on a managed board used to read `will_run`.
  it('reports managed_no_role — NOT will_run — when no authorised role resolves, even on a staffed lane', async () => {
    vi.mocked(resolveManagedProducer).mockResolvedValue({
      producer: null,
      authority: { roleKeys: ['architect'], approvers: [], tier: 'requirements' },
    });

    const e = await evaluateTaskAutoRun(stubDb(rows(TaskStatus.TODO)), noRuns, args);

    expect(e.canRunNow).toBe(false);
    expect(e.reason).toBe('managed_no_role');
    expect(e.managedRole).toBeNull();
    // The lane IS staffed — which is exactly why `no_agent` would have been misleading.
    expect(e.staffedAgentRefs).toEqual(['lane-agent']);
    // And Run-now cannot force it either: there is no role-attributed run to force.
    expect(e.candidate).toBeNull();
  });

  // The no-self-review guarantee, preserved: a review lane's reviewer round-trip belongs
  // to the requirement gate, never to the manifest producer (which is usually the author).
  it('never resolves a manifest producer on a REVIEW lane', async () => {
    vi.mocked(resolveManagedProducer).mockClear();
    const e = await evaluateTaskAutoRun(stubDb(rows(TaskStatus.IN_REVIEW)), noRuns, { ...args, status: TaskStatus.IN_REVIEW });

    expect(resolveManagedProducer).not.toHaveBeenCalled();
    expect(e.managedRole).toBeNull();
    expect(e.reason).toBe('managed_no_role');
  });
});
