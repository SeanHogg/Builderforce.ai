/**
 * Shared Evermind brain-region taxonomy — the single source of truth for the
 * region keys, their group, their themed hue variable, and how recent learning
 * contributions map onto a region. Imported by the Knowledge Map (which draws the
 * regions) AND the Learnings panel (which filters contributions to the clicked
 * region), so the two never drift.
 */
import type { ProjectEvermindRecentEntry } from './projectEvermindApi';

export type EvermindRegionKey =
  | 'neocortex' | 'hippocampus'
  | 'amygdala' | 'hypothalamus' | 'thalamus' | 'basalGanglia'
  | 'personality';

export type EvermindRegionGroup = 'memory' | 'limbic' | 'trait';

export const REGION_GROUP: Record<EvermindRegionKey, EvermindRegionGroup> = {
  neocortex: 'memory',
  hippocampus: 'memory',
  amygdala: 'limbic',
  hypothalamus: 'limbic',
  thalamus: 'limbic',
  basalGanglia: 'limbic',
  personality: 'trait',
};

/** CSS variable carrying each region's themed hue (defined in the Knowledge Map's
 *  scoped `<style>`; the same `.ev-brainmap` custom properties cascade to consumers). */
export const REGION_HUE_VAR: Record<EvermindRegionKey, string> = {
  neocortex: '--ev-neocortex',
  hippocampus: '--ev-hippocampus',
  amygdala: '--ev-amygdala',
  hypothalamus: '--ev-hypothalamus',
  thalamus: '--ev-thalamus',
  basalGanglia: '--ev-basal',
  personality: '--ev-personality',
};

/** Which recent-contribution kind (if any) accretes into a region: `delta` runs →
 *  Neocortex, `text` (taught / run / chat) → Hippocampus. Limbic + Personality carry
 *  affective state, not a per-contribution list. */
export function regionAccretes(key: EvermindRegionKey): ProjectEvermindRecentEntry['kind'] | null {
  if (key === 'neocortex') return 'delta';
  if (key === 'hippocampus') return 'text';
  return null;
}

/** The recent contributions that belong to a region (empty for non-accreting regions). */
export function recentForRegion(
  recent: readonly ProjectEvermindRecentEntry[],
  key: EvermindRegionKey,
): ProjectEvermindRecentEntry[] {
  const kind = regionAccretes(key);
  return kind ? recent.filter((e) => e.kind === kind) : [];
}
