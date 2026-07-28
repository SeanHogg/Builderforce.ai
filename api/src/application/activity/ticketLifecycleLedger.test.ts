import { describe, it, expect } from 'vitest';
import {
  classifyTicketAutonomy,
  classifyTicketOrigin,
  groupRunFailures,
  summarizeDispatchers,
  toGateSnapshot,
  type FailedRunRow,
  type TicketAutonomySignals,
} from './ticketLifecycleLedger';
import type { AutoRunEvaluation } from '../swimlane/evaluateAutoRun';

/**
 * These two classifiers ARE the definition of "did this ticket run autonomously".
 * The audit's credibility rests entirely on them, so every branch is pinned here —
 * particularly the strict ones, because a false "yes" is far worse than a false "no".
 */

/** A ticket that autonomy carried from creation to Done with no human touching it. */
const autonomousToDone: TicketAutonomySignals = {
  origin: 'agent',
  currentStatus: 'done',
  isTerminal: true,
  autonomousHops: 4,
  humanHops: 0,
  backwardHops: 0,
  runsDispatched: 4,
  runsCompleted: 4,
  runsFailed: 0,
  hasLiveRun: false,
  lastSkipReason: null,
};

describe('classifyTicketAutonomy', () => {
  it('confirms a ticket that reached Done with zero human hops as fully autonomous', () => {
    const v = classifyTicketAutonomy(autonomousToDone);
    expect(v.reachedTerminal).toBe(true);
    expect(v.progressedAutonomously).toBe(true);
    expect(v.fullyAutonomous).toBe(true);
    expect(v.stalled).toBe(false);
    expect(v.stallReason).toBeNull();
  });

  it('REFUSES "fully autonomous" when a human moved a lane even once', () => {
    // The whole point of the strictness: agents may have done most of the work, but a
    // human hop means the lifecycle was not autonomous end-to-end. A "yes" here would
    // make the metric worthless.
    const v = classifyTicketAutonomy({ ...autonomousToDone, humanHops: 1, autonomousHops: 3 });
    expect(v.reachedTerminal).toBe(true);
    expect(v.progressedAutonomously).toBe(true);
    expect(v.fullyAutonomous).toBe(false);
  });

  it('REFUSES "fully autonomous" for a ticket a human dragged the whole way', () => {
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      autonomousHops: 0,
      humanHops: 5,
      runsDispatched: 0,
      runsCompleted: 0,
    });
    expect(v.reachedTerminal).toBe(true);
    expect(v.progressedAutonomously).toBe(false);
    expect(v.fullyAutonomous).toBe(false);
  });

  it('does not credit a terminal ticket that never moved at all (created straight into Done)', () => {
    // reachedTerminal alone must not imply autonomy — with no hops, nothing was driven.
    const v = classifyTicketAutonomy({
      ...autonomousToDone, autonomousHops: 0, humanHops: 0, runsDispatched: 0, runsCompleted: 0,
    });
    expect(v.progressedAutonomously).toBe(false);
    expect(v.fullyAutonomous).toBe(false);
  });

  it('marks a ticket short of Done with nothing running as stalled, and names the gate', () => {
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'backlog',
      isTerminal: false,
      autonomousHops: 0,
      runsDispatched: 0,
      runsCompleted: 0,
      lastSkipReason: 'no_agent',
    });
    expect(v.stalled).toBe(true);
    expect(v.stallReason).toBe('no_agent');
    expect(v.stallText).toContain('lane has no staffed agent');
  });

  it('is NOT stalled while a run is live, however long it has been going', () => {
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'in_progress',
      isTerminal: false,
      hasLiveRun: true,
      lastSkipReason: 'cooldown_active',
    });
    expect(v.stalled).toBe(false);
    expect(v.stallReason).toBeNull();
    expect(v.stallText).toBeNull();
  });

  it('prefers the LIVE gate over a recorded skip — a stale reason must not mislead', () => {
    // The lane was unstaffed when the skip was recorded; it is human-gated now. The
    // operator needs the condition that applies today, not the one from last week.
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'review',
      isTerminal: false,
      lastSkipReason: 'no_agent',
      liveReason: 'human_gate',
    });
    expect(v.stalled).toBe(true);
    expect(v.stallReason).toBe('human_gate');
  });

  it('reports a live `will_run` verbatim instead of falling back to a stale skip', () => {
    // THE REGRESSION (task 173). The lane had since been re-gated to 'auto' and staffed,
    // so the live gate cleared the ticket — but `will_run` was being suppressed to null
    // and `??` then reached past it to a `human_gate` skip recorded eleven days earlier.
    // The report named an approval gate that no longer existed, in the same payload as a
    // gate block reading `laneGate: auto, canRunNow: true`.
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'in_review',
      isTerminal: false,
      lastSkipReason: 'human_gate',
      liveReason: 'will_run',
    });
    expect(v.stalled).toBe(true);
    expect(v.stallReason).toBe('will_run');
    expect(v.stallText).toContain('Nothing is gating this ticket');
    // The tense guard: a verdict evaluates, it never dispatches.
    expect(v.stallText).not.toContain('was dispatched');
  });

  it('keeps a recorded reason the live gate does NOT model, even when it answers will_run', () => {
    // `evaluateTaskAutoRun` never looks at the lane REQUIREMENT gate, so its `will_run`
    // means "nothing I model blocks this" — not "nothing blocks this". Task 173 is held
    // in `in_review` awaiting a code-reviewer sign-off; letting a live will_run erase
    // that recorded reason would delete the only evidence of the actual holder.
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'in_review',
      isTerminal: false,
      lastSkipReason: 'lane_requirement_gate',
      liveReason: 'will_run',
    });
    expect(v.stallReason).toBe('lane_requirement_gate');
    expect(v.stallText).toContain('role sign-off');
  });

  it('lets a live BLOCKING reason override even an unmodelled recorded one', () => {
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'in_review',
      isTerminal: false,
      lastSkipReason: 'lane_requirement_gate',
      liveReason: 'run_cap_exhausted',
    });
    expect(v.stallReason).toBe('run_cap_exhausted');
  });

  it('falls back to the recorded skip when no live evaluation was supplied', () => {
    const v = classifyTicketAutonomy({
      ...autonomousToDone, currentStatus: 'review', isTerminal: false, lastSkipReason: 'run_cap_exhausted',
    });
    expect(v.stallReason).toBe('run_cap_exhausted');
    expect(v.stallText).toContain('last consecutive runs all failed');
  });

  it('reports a stall with no recorded reason as an unexplained stall, not a false pass', () => {
    const v = classifyTicketAutonomy({
      ...autonomousToDone, currentStatus: 'todo', isTerminal: false, lastSkipReason: null,
    });
    expect(v.stalled).toBe(true);
    expect(v.stallReason).toBeNull();
  });

  it('treats a done-class status as terminal even when the lane flag is absent', () => {
    // A non-board task has no swimlane to carry `is_terminal`; the status still means done.
    const v = classifyTicketAutonomy({ ...autonomousToDone, isTerminal: false, currentStatus: 'done' });
    expect(v.reachedTerminal).toBe(true);
    expect(v.stalled).toBe(false);
  });

  it('counts a partially-autonomous stalled ticket as progressed but not complete', () => {
    // The common real case: autonomy took it a couple of hops, then a gate stopped it.
    const v = classifyTicketAutonomy({
      ...autonomousToDone,
      currentStatus: 'in_review',
      isTerminal: false,
      autonomousHops: 2,
      humanHops: 0,
      runsDispatched: 2,
      runsCompleted: 2,
      lastSkipReason: 'no_agent',
    });
    expect(v.progressedAutonomously).toBe(true);
    expect(v.fullyAutonomous).toBe(false);
    expect(v.stalled).toBe(true);
  });

  it('passes the raw counts through untouched so the UI can show the evidence', () => {
    const v = classifyTicketAutonomy({ ...autonomousToDone, backwardHops: 2, runsFailed: 3 });
    expect(v.autonomousHops).toBe(4);
    expect(v.backwardHops).toBe(2);
    expect(v.runsFailed).toBe(3);
    expect(v.origin).toBe('agent');
  });
});

describe('classifyTicketOrigin', () => {
  it('classifies a manager grooming card by its source, never as executable work', () => {
    // `source='manager'` is what makes the row `not_executable` in evaluateTaskAutoRun.
    // Counting these as "autonomy failed to run them" would slander the metric.
    expect(classifyTicketOrigin('cloud_agent', 'manager')).toBe('manager_card');
    expect(classifyTicketOrigin('human', 'manager')).toBe('manager_card');
    expect(classifyTicketOrigin(null, 'manager')).toBe('manager_card');
  });

  it('maps a person (member or external hire) to human', () => {
    expect(classifyTicketOrigin('human', null)).toBe('human');
    expect(classifyTicketOrigin('hire', null)).toBe('human');
  });

  it('maps either agent surface to agent — this is the AI-Manager-created bucket', () => {
    expect(classifyTicketOrigin('cloud_agent', null)).toBe('agent');
    expect(classifyTicketOrigin('host_agent', null)).toBe('agent');
  });

  it('maps platform automation to system', () => {
    expect(classifyTicketOrigin('system', null)).toBe('system');
  });

  it('reports unknown rather than guessing when no creation attribution exists', () => {
    // Pre-instrumentation history: an honest "unknown" beats silently bucketing it.
    expect(classifyTicketOrigin(null, null)).toBe('unknown');
    expect(classifyTicketOrigin(undefined, undefined)).toBe('unknown');
    expect(classifyTicketOrigin('something-else', 'jira')).toBe('unknown');
  });

  it('does not let a board-sync source shadow the real creating actor', () => {
    // `source` carries the origin BOARD for synced tickets ('jira'), which says nothing
    // about who created it — only 'manager' is special.
    expect(classifyTicketOrigin('human', 'jira')).toBe('human');
    expect(classifyTicketOrigin('cloud_agent', 'linear')).toBe('agent');
  });
});

/**
 * The three ANALYSIS blocks. Their job is to make a 268-failure ticket readable
 * without the reader deriving anything by hand, so what is pinned here is exactly
 * that: identical causes collapse, distinct causes do NOT, and the dispatcher that
 * drove the storm is named.
 */
describe('groupRunFailures', () => {
  /** The real shape of a run-cap storm: same sentence, moving counter. */
  const capStorm: FailedRunRow[] = Array.from({ length: 5 }, (_, i) => ({
    id: 100 + i,
    errorMessage: `Monthly cloud-run allowance reached (${30 + i}/25 on the free plan). Upgrade at builderforce.ai/pricing.`,
    submittedBy: 'system:coordinator',
    at: new Date(Date.UTC(2026, 6, 11, 14, i * 5)).toISOString(),
  }));

  it('collapses one cause with a MOVING COUNTER into a single group', () => {
    // 30/25, 31/25, 32/25 … are one bug. Grouping on the raw string would report five.
    const groups = groupRunFailures(capStorm);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.runs).toBe(5);
    expect(groups[0]?.signature).toContain('<n>/<n>');
  });

  it('keeps a verbatim sample so collapsing never loses the exact text', () => {
    expect(groupRunFailures(capStorm)[0]?.sample).toContain('(34/25 on the free plan)');
  });

  it('reports the retry CADENCE — the fact that proves it is a loop', () => {
    expect(groupRunFailures(capStorm)[0]?.medianIntervalMs).toBe(300_000);
  });

  it('names the dispatcher and the newest execution ids', () => {
    const g = groupRunFailures(capStorm)[0];
    expect(g?.dispatchers).toEqual(['system:coordinator']);
    expect(g?.exampleExecutionIds).toEqual([104, 103, 102, 101, 100]);
    expect(g?.firstAt).toBe('2026-07-11T14:00:00.000Z');
    expect(g?.lastAt).toBe('2026-07-11T14:20:00.000Z');
  });

  it('does NOT merge genuinely different causes, and ranks the dominant one first', () => {
    const groups = groupRunFailures([
      ...capStorm,
      { id: 200, errorMessage: 'No durable executor was available.', submittedBy: 'system:lane-auto', at: '2026-07-11T15:00:00.000Z' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.runs).toBe(5);
    expect(groups[1]?.medianIntervalMs).toBeNull();
  });

  it('treats a failure with NO message as its own cause rather than dropping it', () => {
    // A run that died without saying why is a finding, not a blank to be swallowed.
    const groups = groupRunFailures([{ id: 1, errorMessage: null, submittedBy: null, at: '2026-07-11T15:00:00.000Z' }]);
    expect(groups[0]?.signature).toBe('(no error message recorded)');
    expect(groups[0]?.dispatchers).toEqual([]);
  });

  it('returns nothing for a ticket that never failed', () => {
    expect(groupRunFailures([])).toEqual([]);
  });
});

describe('summarizeDispatchers', () => {
  it('attributes runs to the subsystem that started them, busiest first', () => {
    const rows = summarizeDispatchers([
      { status: 'failed', submittedBy: 'system:coordinator', at: '2026-07-11T14:00:00.000Z' },
      { status: 'failed', submittedBy: 'system:coordinator', at: '2026-07-11T14:05:00.000Z' },
      { status: 'completed', submittedBy: 'system:lane-auto', at: '2026-06-30T06:32:00.000Z' },
    ]);
    expect(rows[0]).toMatchObject({
      submittedBy: 'system:coordinator', runs: 2, failed: 2, completed: 0,
      firstAt: '2026-07-11T14:00:00.000Z', lastAt: '2026-07-11T14:05:00.000Z',
    });
    expect(rows[1]).toMatchObject({ submittedBy: 'system:lane-auto', runs: 1, completed: 1 });
  });

  it('buckets an unattributed run explicitly instead of hiding it', () => {
    expect(summarizeDispatchers([{ status: 'failed', submittedBy: '  ', at: '2026-07-11T14:00:00.000Z' }])[0])
      .toMatchObject({ submittedBy: '(not recorded)', runs: 1 });
  });
});

describe('toGateSnapshot', () => {
  const evaluation: AutoRunEvaluation = {
    status: 'in_review',
    assignedAgentRef: 'owner-1',
    laneResolved: true,
    isTerminalLane: false,
    laneGate: 'human',
    staffedAgentRefs: ['a1'],
    decision: { autoRun: false, capabilityMismatches: [{ agentRef: 'a1', missing: ['coding-agent'] }] },
    candidate: { agentRef: 'a1', model: 'claude-opus-5' },
    liveExecution: null,
    canRunNow: false,
    reason: 'human_gate',
    cooldownRemainingMs: 0,
    consecutiveFailures: 134,
    failureBreakerAt: 3,
    tenantTokens: null,
    lifecycleManaged: false,
    managedRole: null,
    unfilledRoleKeys: [],
  };

  it('carries the EVIDENCE behind the reason, not just the reason', () => {
    const g = toGateSnapshot(evaluation);
    expect(g).toMatchObject({
      reason: 'human_gate',
      laneGate: 'human',
      candidateAgentRef: 'a1',
      staffedAgentRefs: ['a1'],
      consecutiveFailures: 134,
      failureBreakerAt: 3,
    });
    // The plain sentence travels with the code so a non-UI consumer needs no catalog.
    expect(g.reasonText).toContain('human-gated');
    expect(g.capabilityMismatches).toEqual([{ agentRef: 'a1', missing: ['coding-agent'] }]);
  });

  it('defaults an absent mismatch list to empty rather than undefined', () => {
    expect(toGateSnapshot({ ...evaluation, decision: { autoRun: true } }).capabilityMismatches).toEqual([]);
  });

  // The workspace token block is the one gate that leaves NO trace on the ticket (the
  // sweep skips a blocked tenant above the trigger), so the snapshot carrying the
  // usage/limit pair is the only place a reader can see it.
  it('carries the workspace token verdict that explains a ticket nothing ever dispatches', () => {
    const g = toGateSnapshot({
      ...evaluation,
      canRunNow: false,
      reason: 'tenant_token_limit',
      tenantTokens: {
        hasTokens: false, reason: 'monthly_exhausted',
        usageToday: 40_000, dailyLimit: 200_000,
        usageMonth: 1_050_000, monthlyLimit: 1_000_000,
        effectivePlan: 'free',
      },
    });
    expect(g.tenantTokens).toMatchObject({ hasTokens: false, reason: 'monthly_exhausted', usageMonth: 1_050_000 });
    expect(g.reasonText).toContain('EVERY ticket');
  });
});
