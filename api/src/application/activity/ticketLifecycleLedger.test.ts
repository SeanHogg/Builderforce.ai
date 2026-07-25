import { describe, it, expect } from 'vitest';
import {
  classifyTicketAutonomy,
  classifyTicketOrigin,
  type TicketAutonomySignals,
} from './ticketLifecycleLedger';

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
