import { describe, expect, it } from 'vitest';
import { assignTiers } from './performerTiers';

type Card = Parameters<typeof assignTiers>[0][number];

const card = (ref: string, name: string, discipline: string | null, effectiveness: number | null, engagement: number | null): Card => ({
  memberKind: 'human', memberRef: ref, memberName: name, discipline, effectivenessScore: effectiveness, engagementScore: engagement,
} as unknown as Card);

describe('assignTiers', () => {
  it('tiers a discipline of four or more by percentile within the discipline', () => {
    const rows = assignTiers([
      card('u1', 'Ada', 'backend', 90, null),
      card('u2', 'Grace', 'backend', 70, null),
      card('u3', 'Linus', 'backend', 60, null),
      card('u4', 'Ken', 'backend', 40, null),
    ]);
    const byRef = Object.fromEntries(rows.map((r) => [r.memberRef, r]));
    expect(byRef.u1).toMatchObject({ tier: 'high', percentile: 100 });
    expect(byRef.u2).toMatchObject({ tier: 'solid', percentile: 67 });
    expect(byRef.u4).toMatchObject({ tier: 'watch', percentile: 0 });
    expect(rows.map((r) => r.tier)).toEqual(['high', 'solid', 'solid', 'watch']);
  });

  it('uses absolute thresholds for a tiny group so one person is not auto-labelled', () => {
    const rows = assignTiers([card('u1', 'Ada', 'design', 80, null), card('u2', 'Grace', 'design', 45, null)]);
    expect(rows.map((r) => [r.name, r.tier, r.percentile])).toEqual([['Ada', 'high', 100], ['Grace', 'watch', 0]]);
  });

  it('blends engagement into the composite for humans and keeps discipline null when unassigned', () => {
    const [row] = assignTiers([card('u1', 'Ada', null, 100, 50)]);
    expect(row!.composite).toBe(85);
    expect(row!.discipline).toBeNull();
    expect(row!.percentile).toBe(100);
  });
});
