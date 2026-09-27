import type { EvermindRegionKey } from '@/lib/evermindRegions';

/**
 * WHERE EACH LEARNING CENTRE SITS IN THE ROOM'S 3D BRAIN.
 *
 * Pure geometry, in metres, in the brain's own frame: +y up, +z forward (the face a
 * station turns toward the table), the midline at x = 0. The whole brain fits the
 * station body box (1.5 × 1.0 × 1.2), centred on the origin, with the brainstem
 * reaching down to the post.
 *
 * The placement follows the anatomy the runtime is named after, so the brain reads as
 * a brain and not a bubble chart: the prefrontal cortex (personality) at the front, the
 * paired hippocampi and amygdalae low in the temporal lobes, the thalamus as the
 * central relay every pathway runs through, the basal ganglia either side of it, the
 * hypothalamus just beneath. The neocortex is the cortex itself — the shell — with
 * its marker on the crown.
 */

export type Vec3 = [number, number, number];

/** One lobe of the cortex, as a scaled unit sphere. */
export const HEMISPHERE = { offsetX: 0.228, centreY: 0.05, radii: [0.22, 0.3, 0.46] as Vec3 } as const;
export const CEREBELLUM = { position: [0, -0.2, -0.34] as Vec3, radii: [0.28, 0.13, 0.15] as Vec3 } as const;
export const BRAINSTEM = { position: [0, -0.36, -0.14] as Vec3, radiusTop: 0.065, radiusBottom: 0.05, height: 0.28 } as const;

export interface BrainCentrePart {
  position: Vec3;
  /** Radii of the scaled unit sphere that draws this part. */
  radii: Vec3;
}

export interface BrainCentre {
  /** One part, or a left/right pair. */
  parts: readonly BrainCentrePart[];
  /** Where the centre's name floats — just outside the shell, so it is never buried. */
  label: Vec3;
}

const pair = (x: number, y: number, z: number, radii: Vec3): BrainCentrePart[] => [
  { position: [-x, y, z], radii },
  { position: [x, y, z], radii },
];

export const BRAIN_CENTRES: Readonly<Record<EvermindRegionKey, BrainCentre>> = {
  neocortex: { parts: [{ position: [0, 0.33, 0.02], radii: [0.07, 0.035, 0.1] }], label: [0, 0.47, 0.05] },
  personality: { parts: [{ position: [0, 0.12, 0.4], radii: [0.1, 0.08, 0.06] }], label: [0, 0.2, 0.58] },
  hippocampus: { parts: pair(0.21, -0.13, -0.06, [0.035, 0.035, 0.1]), label: [0.5, -0.12, -0.06] },
  amygdala: { parts: pair(0.21, -0.15, 0.1, [0.04, 0.04, 0.04]), label: [-0.5, -0.16, 0.12] },
  thalamus: { parts: pair(0.055, 0.0, -0.03, [0.055, 0.045, 0.075]), label: [0.12, 0.13, -0.2] },
  basalGanglia: { parts: pair(0.15, 0.04, 0.1, [0.05, 0.06, 0.08]), label: [0.5, 0.08, 0.2] },
  hypothalamus: { parts: [{ position: [0, -0.12, 0.08], radii: [0.04, 0.035, 0.04] }], label: [0, -0.3, 0.3] },
};

/** Every pathway runs through the thalamus — the relay the runtime gates attention at. */
export const PATHWAY_HUB: Vec3 = [0, 0, -0.03];

/** At most this many learned memories are drawn per memory centre. */
export const MAX_MEMORY_DOTS = 18;

const GOLDEN_ANGLE = 2.399963;

/**
 * Where the `index`-th of `count` fitted learnings sits on the cortex: an even golden-
 * angle spread over the upper cortex, alternating hemispheres. Deterministic, so a
 * memory keeps its place across polls.
 */
export function cortexMemorySpot(index: number, count: number): Vec3 {
  const side = index % 2 === 0 ? -1 : 1;
  const within = Math.floor(index / 2);
  const perSide = Math.max(1, Math.ceil(count / 2));
  const y = 0.95 - ((within + 0.5) / perSide) * 0.75;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = within * GOLDEN_ANGLE;
  const [rx, ry, rz] = HEMISPHERE.radii;
  const lift = 1.04;
  return [
    side * HEMISPHERE.offsetX + side * Math.abs(Math.cos(angle)) * ring * rx * lift,
    HEMISPHERE.centreY + y * ry * lift,
    Math.sin(angle) * ring * rz * lift,
  ];
}

/** Where the `index`-th taught memory orbits its hippocampus (alternating sides). */
export function hippocampalMemorySpot(index: number): Vec3 {
  const side = index % 2 === 0 ? -1 : 1;
  const within = Math.floor(index / 2);
  const angle = within * GOLDEN_ANGLE;
  const [hx, hy, hz] = BRAIN_CENTRES.hippocampus.parts[side < 0 ? 0 : 1]!.position;
  const reach = 0.07 + (within % 3) * 0.018;
  return [hx + Math.cos(angle) * reach * 0.7, hy + Math.sin(angle) * reach * 0.6, hz + ((within % 4) - 1.5) * 0.04];
}

/**
 * The cortex's folds: a smooth, deterministic ripple along each vertex normal of the
 * unit sphere, so the shell reads as gyri and sulci rather than a balloon.
 */
export function gyrusRipple(x: number, y: number, z: number): number {
  return 0.045 * (Math.sin(9 * x + 1.7) * Math.sin(9 * y + 0.3) * Math.sin(9 * z + 2.1))
    + 0.022 * (Math.sin(17 * x + 4 * y) * Math.sin(15 * z - 3 * y));
}
