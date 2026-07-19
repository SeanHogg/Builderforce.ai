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

/** Whether a region accretes a per-contribution list at all. Limbic + Personality
 *  carry live affective state instead, so they list nothing. */
export function regionAccretes(key: EvermindRegionKey): boolean {
  return key === 'neocortex' || key === 'hippocampus';
}

/**
 * The recent contributions that belong to a region (empty for non-accreting regions).
 *
 * Attribution is MANY-TO-MANY, because one contribution genuinely lands in both
 * memory regions — mirroring hippocampal→neocortical consolidation:
 *
 *  - **Hippocampus** = the episodic record of what was taught (`kind: 'text'`).
 *  - **Neocortex** = every contribution whose weights were actually fitted into the
 *    merge, which the coordinator stamps as `fitted` at the moment it pushes the
 *    checkpoint diff. Text contributions qualify: the fit runs server-side in the
 *    coordinator's merge alarm, so a taught memory IS neocortical weight movement.
 *
 * Filtering Neocortex to `kind: 'delta'` alone was the bug behind "Nothing learned in
 * Neocortex yet." appearing next to a live training readout with real loss and
 * weights-moved — every real learning path is the text path.
 *
 * `fitted !== false` (not `=== true`) is deliberate: ring entries written before the
 * flag existed carry no value, and every one of them was fitted.
 */
export function recentForRegion(
  recent: readonly ProjectEvermindRecentEntry[],
  key: EvermindRegionKey,
): ProjectEvermindRecentEntry[] {
  if (key === 'hippocampus') return recent.filter((e) => e.kind === 'text');
  if (key === 'neocortex') return recent.filter((e) => e.fitted !== false);
  return [];
}
