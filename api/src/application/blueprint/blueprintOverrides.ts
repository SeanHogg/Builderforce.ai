/**
 * W2: Blueprint overrides
 *
 * Lays a repo's `builderforce.json` (collected as `overrides` by `builderforceJsonDetector`)
 * over the detected blueprint. An override REPLACES the detected value — arrays included,
 * never concatenated — because the file is the owner saying "this is what it is", not
 * "add this". Identity and provenance (`id`, `projectId`, `commitSha`, `detectedAt`,
 * `sources`, `overrides`) are never overridable: they describe the detection itself.
 */

import type { AppBlueprint } from '@builderforce/creation-canvas-contract';

const OVERRIDABLE_KEYS = [
  'services',
  'bindings',
  'database',
  'secrets',
  'vars',
  'domains',
  'isMonorepo',
  'workspaces',
] as const satisfies readonly (keyof AppBlueprint)[];

type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];
type OverridableFields = Partial<Pick<AppBlueprint, OverridableKey>>;

function copyField<K extends OverridableKey>(to: OverridableFields, from: Partial<AppBlueprint>, key: K): void {
  to[key] = from[key];
}

/** The blueprint with every overridable field `overrides` sets replaced. Pure. */
export function applyOverrides(bp: AppBlueprint, overrides: Partial<AppBlueprint> | null): AppBlueprint {
  if (!overrides) return bp;
  const picked: OverridableFields = {};
  for (const key of OVERRIDABLE_KEYS) {
    // `null` is a real override (e.g. `"database": null` clears a mis-detected database).
    if (overrides[key] !== undefined) copyField(picked, overrides, key);
  }
  return { ...bp, ...picked };
}
