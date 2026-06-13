import { describe, expect, it } from 'vitest';
import { rankCandidates, type Candidate, type CandidateProfile } from './assigneeRecommender';

/**
 * Locks the pure assignee-ranking math (planner consumption of member profiles).
 * Covers availability gating, spare-WIP capacity, skill match, ramp factor, and
 * ordering — no DB.
 */
const cands: Candidate[] = [
  { memberKind: 'human', memberRef: 'u1', memberName: 'Ann' },
  { memberKind: 'human', memberRef: 'u2', memberName: 'Bob' },
  { memberKind: 'cloud_agent', memberRef: 'agent-x', memberName: 'Agent X' },
];

function profiles(m: Record<string, CandidateProfile>): Map<string, CandidateProfile> {
  return new Map(Object.entries(m));
}

describe('rankCandidates', () => {
  it('ranks an available, high-spare, skilled member top', () => {
    const out = rankCandidates(
      cands,
      profiles({
        'human:u1': { availabilityStatus: 'available', maxConcurrentWip: 5, skills: [{ tag: 'react', proficiency: 5 }], experienceLevel: 'senior' },
        'human:u2': { availabilityStatus: 'busy', maxConcurrentWip: 5 },
        'cloud_agent:agent-x': { availabilityStatus: 'available', maxConcurrentWip: 2 },
      }),
      new Map([['human:u1', 1], ['human:u2', 1], ['cloud_agent:agent-x', 0]]),
      ['react'],
    );
    expect(out[0]!.memberRef).toBe('u1');
    expect(out[0]!.skillMatchPct).toBe(100);
    expect(out[0]!.available).toBe(true);
  });

  it('sinks an out-of-office member to the bottom with available=false', () => {
    const out = rankCandidates(
      cands.slice(0, 2),
      profiles({
        'human:u1': { availabilityStatus: 'ooo', maxConcurrentWip: 5 },
        'human:u2': { availabilityStatus: 'available', maxConcurrentWip: 5 },
      }),
      new Map(),
      [],
    );
    expect(out[0]!.memberRef).toBe('u2');
    const ann = out.find((o) => o.memberRef === 'u1')!;
    expect(ann.available).toBe(false);
    expect(ann.fitScore).toBe(0);
  });

  it('penalizes an at-capacity member (no spare WIP)', () => {
    const out = rankCandidates(
      [cands[0]!, cands[1]!],
      profiles({
        'human:u1': { availabilityStatus: 'available', maxConcurrentWip: 3 },
        'human:u2': { availabilityStatus: 'available', maxConcurrentWip: 3 },
      }),
      new Map([['human:u1', 3], ['human:u2', 0]]), // u1 is full
      [],
    );
    expect(out[0]!.memberRef).toBe('u2');
    const full = out.find((o) => o.memberRef === 'u1')!;
    expect(full.spareCapacity).toBe(0);
    expect(full.reasons.some((r) => r.includes('capacity'))).toBe(true);
  });

  it('defaults max WIP and treats no-profile as available', () => {
    const out = rankCandidates([cands[0]!], new Map(), new Map(), []);
    expect(out[0]!.available).toBe(true);
    expect(out[0]!.spareCapacity).toBe(5); // DEFAULT_MAX_WIP
  });
});
