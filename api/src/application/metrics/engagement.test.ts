import { describe, expect, it } from 'vitest';
import { scoreEngagement, type EngagementSignals } from './engagement';

/**
 * Locks the pure composite engagement math (no DB). Each signal contributes up to
 * a capped ceiling (activity 40, platform 25, tooling 20, delivery 15 = 100); the
 * level bands derive from the total.
 */
const signals = (over: Partial<EngagementSignals> = {}): EngagementSignals => ({
  activityEvents: over.activityEvents ?? 0,
  platformActions: over.platformActions ?? 0,
  vscodeActive: over.vscodeActive ?? false,
  completedTasks: over.completedTasks ?? 0,
});

describe('scoreEngagement', () => {
  it('scores zero signals as inactive', () => {
    const r = scoreEngagement(signals());
    expect(r.score).toBe(0);
    expect(r.level).toBe('inactive');
  });

  it('caps each dimension at its ceiling', () => {
    const r = scoreEngagement(signals({ activityEvents: 1000, platformActions: 1000, vscodeActive: true, completedTasks: 1000 }));
    expect(r.breakdown.activityPts).toBe(40);
    expect(r.breakdown.platformPts).toBe(25);
    expect(r.breakdown.toolingPts).toBe(20);
    expect(r.breakdown.deliveryPts).toBe(15);
    expect(r.score).toBe(100);
    expect(r.level).toBe('very_high');
  });

  it('weights dev activity strongest (2pts/event) and clamps to 100', () => {
    expect(scoreEngagement(signals({ activityEvents: 5 })).breakdown.activityPts).toBe(10);
    expect(scoreEngagement(signals({ activityEvents: 5 })).score).toBe(10);
  });

  it('vscode presence is a flat 20', () => {
    expect(scoreEngagement(signals({ vscodeActive: true })).breakdown.toolingPts).toBe(20);
    expect(scoreEngagement(signals({ vscodeActive: false })).breakdown.toolingPts).toBe(0);
  });

  it('bands the level by total score', () => {
    expect(scoreEngagement(signals({ activityEvents: 5 })).level).toBe('low');        // 10
    expect(scoreEngagement(signals({ activityEvents: 20 })).level).toBe('moderate');   // 40
    expect(scoreEngagement(signals({ activityEvents: 20, vscodeActive: true })).level).toBe('high'); // 60
  });
});
