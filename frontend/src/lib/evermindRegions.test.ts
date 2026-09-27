import { describe, expect, it } from 'vitest';
import { EVERMIND_REGION_KEYS, evermindRegionSignals, recentForRegion, regionAccretes, type EvermindRegionKey } from './evermindRegions';
import type { ProjectEvermindContributions, ProjectEvermindRecentEntry } from './projectEvermindApi';

const entry = (over: Partial<ProjectEvermindRecentEntry>): ProjectEvermindRecentEntry => ({
  id: 1, kind: 'text', version: 2, at: 1_700_000_000_000, weight: 1, ...over,
});

describe('recentForRegion', () => {
  it('credits a fitted text contribution to BOTH memory regions', () => {
    // The regression this guards: the coordinator fits text server-side in its merge
    // alarm, so a taught memory IS neocortical weight movement. Attributing it only to
    // the Hippocampus left the Neocortex permanently empty ("Nothing learned yet")
    // while the training readout showed real loss and weights-moved.
    const recent = [entry({ id: 1, kind: 'text', fitted: true })];

    expect(recentForRegion(recent, 'neocortex')).toHaveLength(1);
    expect(recentForRegion(recent, 'hippocampus')).toHaveLength(1);
  });

  it('treats a legacy row with no `fitted` flag as fitted', () => {
    // Ring entries predate the flag; every one of them was fitted, so the read must be
    // `fitted !== false`. Reading `fitted === true` would re-empty the Neocortex for
    // every project whose contributions were merged before the flag shipped.
    const recent = [entry({ id: 1, kind: 'text' })];

    expect(recentForRegion(recent, 'neocortex')).toHaveLength(1);
  });

  it('excludes a contribution that was recorded without moving weights', () => {
    const recent = [entry({ id: 1, kind: 'text', fitted: false })];

    expect(recentForRegion(recent, 'neocortex')).toHaveLength(0);
    expect(recentForRegion(recent, 'hippocampus')).toHaveLength(1); // still an episodic memory
  });

  it('keeps a pre-diffed delta out of the Hippocampus', () => {
    // A delta carries no text, so there is no episodic memory to file — only weights.
    const recent = [entry({ id: 1, kind: 'delta', fitted: true })];

    expect(recentForRegion(recent, 'neocortex')).toHaveLength(1);
    expect(recentForRegion(recent, 'hippocampus')).toHaveLength(0);
  });

  it('lists nothing for regions that carry live state instead of contributions', () => {
    const recent = [entry({ id: 1, kind: 'text', fitted: true })];
    const stateRegions: EvermindRegionKey[] = [
      'amygdala', 'hypothalamus', 'thalamus', 'basalGanglia', 'personality',
    ];

    for (const key of stateRegions) {
      expect(recentForRegion(recent, key), key).toEqual([]);
      expect(regionAccretes(key), key).toBe(false);
    }
    expect(regionAccretes('neocortex')).toBe(true);
    expect(regionAccretes('hippocampus')).toBe(true);
  });
});

describe('evermindRegionSignals', () => {
  const payload = (over: Partial<ProjectEvermindContributions>): ProjectEvermindContributions => ({
    version: 3, seeded: true, mode: 'connected', contributions: 2, inferenceEnabled: true, teacherModel: null,
    lastLearnedAt: null, pending: 0, recent: [], training: [], eval: null,
    affect: {
      state: { valence: 0.4, arousal: 0.5, driveCuriosity: 0.8, driveCaution: 0.2, driveEffort: 0.6, driveSocial: 0.4, attention: 0.5, exploration: 0.3 },
      setpoints: { valence: 0, arousal: 0.3, driveCuriosity: 0.5, driveCaution: 0.5, driveEffort: 0.5, driveSocial: 0.5, attention: 0.5, exploration: 0.5 },
      attentionGain: 0.7,
      exploreBias: 0.35,
    },
    ...over,
  });

  it('stands a dormant brain for an Evermind with no project behind it', () => {
    const signals = evermindRegionSignals(null);
    for (const key of EVERMIND_REGION_KEYS) expect(signals[key]).toEqual({ charge: 0.08, count: 0, active: false });
  });

  it('counts memory regions from what was learned and drives the limbic ones from live affect', () => {
    const signals = evermindRegionSignals(payload({ recent: [entry({ id: 1 }), entry({ id: 2, kind: 'delta' })] }));
    expect(signals.neocortex.count).toBe(2);
    expect(signals.hippocampus.count).toBe(1);
    expect(signals.hippocampus.active).toBe(true);
    expect(signals.thalamus.charge).toBeCloseTo(0.7);
    expect(signals.basalGanglia.charge).toBeCloseTo(0.35);
    expect(signals.hypothalamus.charge).toBeCloseTo(0.5);
    expect(signals.amygdala.charge).toBeCloseTo(0.7);
    expect(signals.personality.active).toBe(false);
  });

  it('keeps a frozen model lit but still', () => {
    const signals = evermindRegionSignals(payload({ mode: 'offline-frozen' }));
    expect(EVERMIND_REGION_KEYS.some((key) => signals[key].active)).toBe(false);
    expect(signals.personality.charge).toBeGreaterThanOrEqual(0.5);
  });
});
