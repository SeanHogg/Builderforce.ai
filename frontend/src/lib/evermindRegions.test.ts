import { describe, expect, it } from 'vitest';
import { recentForRegion, regionAccretes, type EvermindRegionKey } from './evermindRegions';
import type { ProjectEvermindRecentEntry } from './projectEvermindApi';

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
