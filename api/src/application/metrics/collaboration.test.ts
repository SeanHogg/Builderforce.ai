import { describe, expect, it } from 'vitest';
import { scoreCollaboration } from './collaboration';

const member = (ref: string, name: string, signals: { prsReviewed: number; reviewComments: number; handoffs: number; avgReviewTurnaroundHours: number | null }) =>
  [`human:${ref}`, { kind: 'human' as const, ref, name, ...signals }] as const;

describe('scoreCollaboration', () => {
  it('weights reviews and handoffs heaviest and caps each dimension', () => {
    const [row] = scoreCollaboration(new Map([
      member('u1', 'Ada', { prsReviewed: 20, reviewComments: 20, handoffs: 20, avgReviewTurnaroundHours: 0 }),
    ]));
    expect(row!.breakdown).toEqual({ reviewsPts: 40, commentsPts: 20, handoffPts: 25, latencyPts: 15 });
    expect(row!.collaborationScore).toBe(100);
  });

  it('gives no latency bonus without a turnaround and none past three days', () => {
    const rows = scoreCollaboration(new Map([
      member('u1', 'Ada', { prsReviewed: 1, reviewComments: 0, handoffs: 0, avgReviewTurnaroundHours: null }),
      member('u2', 'Grace', { prsReviewed: 1, reviewComments: 0, handoffs: 0, avgReviewTurnaroundHours: 96 }),
      member('u3', 'Linus', { prsReviewed: 1, reviewComments: 0, handoffs: 0, avgReviewTurnaroundHours: 36 }),
    ]));
    const byRef = new Map(rows.map((r) => [r.memberRef, r]));
    expect(byRef.get('u1')?.breakdown.latencyPts).toBe(0);
    expect(byRef.get('u2')?.breakdown.latencyPts).toBe(0);
    expect(byRef.get('u3')?.breakdown.latencyPts).toBe(8);
    expect(rows[0]!.memberRef).toBe('u3');
  });

  it('sorts by score and breaks ties on name', () => {
    const rows = scoreCollaboration(new Map([
      member('u2', 'Grace', { prsReviewed: 1, reviewComments: 0, handoffs: 0, avgReviewTurnaroundHours: null }),
      member('u1', 'Ada', { prsReviewed: 1, reviewComments: 0, handoffs: 0, avgReviewTurnaroundHours: null }),
    ]));
    expect(rows.map((r) => r.name)).toEqual(['Ada', 'Grace']);
  });
});
