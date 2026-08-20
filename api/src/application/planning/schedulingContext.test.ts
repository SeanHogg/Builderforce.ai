import { describe, expect, it } from 'vitest';
import {
  assigneeKeyOf, capacityFromMemberMetrics, MIN_AVAILABILITY, SATURATION_OPEN_ITEMS,
} from './schedulingContext';
import type { MemberScorecard } from '../metrics/workforceMetrics';

function card(partial: Partial<MemberScorecard> & Pick<MemberScorecard, 'memberKind' | 'memberRef'>): MemberScorecard {
  return {
    memberName: partial.memberRef,
    discipline: null,
    assignedCount: 0,
    completedCount: 0,
    redoCount: 0,
    reopenCount: 0,
    avgCycleTimeHours: null,
    avgPickupLatencyHours: null,
    avgIdleAfterDoneHours: null,
    boardHygieneScore: null,
    engagementScore: null,
    effectivenessScore: null,
    ...partial,
  } as MemberScorecard;
}

describe('assigneeKeyOf', () => {
  it('agrees with the member scorecard identity, or the capacity map matches nothing', () => {
    expect(assigneeKeyOf({ assignedUserId: 'u1' })).toBe('human:u1');
    expect(assigneeKeyOf({ assignedAgentHostId: 7 })).toBe('host_agent:7');
    expect(assigneeKeyOf({ assignedAgentRef: 'agent-a' })).toBe('cloud_agent:agent-a');
  });

  it('treats unowned work as constraining nobody', () => {
    expect(assigneeKeyOf({})).toBeNull();
    expect(assigneeKeyOf({ assignedUserId: null, assignedAgentHostId: null, assignedAgentRef: null })).toBeNull();
  });

  it('prefers the human owner when a row somehow carries more than one', () => {
    // A task is owned by EITHER a human OR an agent; if the data disagrees we pick
    // one deterministically rather than keying the same person two ways.
    expect(assigneeKeyOf({ assignedUserId: 'u1', assignedAgentRef: 'agent-a' })).toBe('human:u1');
  });
});

describe('capacityFromMemberMetrics', () => {
  it('keeps everyone at one ticket at a time — that is what makes work serialise', () => {
    const cap = capacityFromMemberMetrics([card({ memberKind: 'human', memberRef: 'u1' })]);
    expect(cap.get('human:u1')).toEqual({ concurrency: 1, availability: 1 });
  });

  it('scales availability down with OPEN load, not with total throughput', () => {
    // 10 assigned of which 8 are done = 2 open, not 10.
    const cap = capacityFromMemberMetrics([
      card({ memberKind: 'human', memberRef: 'u1', assignedCount: 10, completedCount: 8 }),
    ]);
    expect(cap.get('human:u1')?.availability).toBeCloseTo(1 - 2 / SATURATION_OPEN_ITEMS);
  });

  it('never drops a saturated owner to zero, which would mean an endless estimate', () => {
    const cap = capacityFromMemberMetrics([
      card({ memberKind: 'cloud_agent', memberRef: 'a1', assignedCount: 40, completedCount: 0 }),
    ]);
    expect(cap.get('cloud_agent:a1')?.availability).toBe(MIN_AVAILABILITY);
  });

  it('keys by the scorecard identity so a task lookup finds it', () => {
    const cap = capacityFromMemberMetrics([card({ memberKind: 'host_agent', memberRef: '7' })]);
    expect(cap.has(assigneeKeyOf({ assignedAgentHostId: 7 }) as string)).toBe(true);
  });
});
