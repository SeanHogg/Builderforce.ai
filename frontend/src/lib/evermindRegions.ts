/**
 * Shared Evermind brain-region taxonomy — the single source of truth for the
 * region keys, their group, their themed hue variable, and how recent learning
 * contributions map onto a region. Imported by the Knowledge Map (which draws the
 * regions) AND the Learnings panel (which filters contributions to the clicked
 * region), so the two never drift.
 */
import type { ProjectEvermindContributions, ProjectEvermindRecentEntry } from './projectEvermindApi';

export type EvermindRegionKey =
  | 'neocortex' | 'hippocampus'
  | 'amygdala' | 'hypothalamus' | 'thalamus' | 'basalGanglia'
  | 'personality';

export type EvermindRegionGroup = 'memory' | 'limbic' | 'trait';

/** Every region, in the order a list of them reads: memory, trait, then limbic. */
export const EVERMIND_REGION_KEYS: readonly EvermindRegionKey[] = [
  'neocortex', 'hippocampus', 'personality', 'amygdala', 'hypothalamus', 'thalamus', 'basalGanglia',
];

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

/** How lit one region is right now, from the real payload — nothing fabricated. */
export interface EvermindRegionSignal {
  /** 0..1 — how strongly the region is charged. */
  charge: number;
  /** Learnings attributed to the region (memory regions only; 0 elsewhere). */
  count: number;
  /** Whether the region is learning right now (animates). */
  active: boolean;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Every region's signal from the contributions payload — the ONE derivation behind the
 * Studio's 2D Knowledge Map and the room's 3D brain, so the two readings of one model
 * can never light different regions. `null` (no project attached yet) is a dormant
 * brain: every region at the dormant charge, none active.
 *
 * Memory regions charge with what they hold; the limbic regions are driven by the
 * server's real affective state (the same limbic compiler the runtime runs), and
 * Personality by how many versions have settled its setpoints.
 */
export function evermindRegionSignals(
  data: ProjectEvermindContributions | null,
): Record<EvermindRegionKey, EvermindRegionSignal> {
  const seeded = !!data?.seeded;
  const learning = seeded && data?.mode === 'connected';
  const recent = data?.recent ?? [];
  const fitted = recentForRegion(recent, 'neocortex').length;
  const texts = recentForRegion(recent, 'hippocampus').length;
  const pending = data?.pending ?? 0;
  const version = data?.version ?? 0;
  const dim = seeded ? 1 : 0.08;
  const affect = data?.affect;
  const st = affect?.state;
  const driveAvg = st ? (st.driveCuriosity + st.driveCaution + st.driveEffort + st.driveSocial) / 4 : 0;
  const salience = st ? clamp01(Math.abs(st.valence) * 0.5 + st.arousal) : 0;
  const limbic = (value: number, floor: number): EvermindRegionSignal => ({ charge: seeded ? Math.max(floor, value) : dim, count: 0, active: learning });
  return {
    neocortex: { charge: seeded ? Math.max(0.3, clamp01(fitted / 12)) : dim, count: fitted, active: learning },
    hippocampus: { charge: seeded ? Math.max(0.3, clamp01((texts + pending) / 12)) : dim, count: texts, active: learning && (texts > 0 || pending > 0) },
    personality: { charge: seeded ? Math.max(0.5, clamp01(version / 8)) : dim, count: 0, active: false },
    amygdala: limbic(salience, 0.25),
    hypothalamus: limbic(driveAvg, 0.25),
    thalamus: affect ? limbic(affect.attentionGain, 0.2) : { charge: dim, count: 0, active: learning },
    basalGanglia: affect ? limbic(affect.exploreBias, 0.2) : { charge: dim, count: 0, active: learning },
  };
}
