/**
 * registry/dimensions.ts — every registered dimension (C4: all are present in a delta, measured or
 * not) and the built-in {@link DimensionRegistry}. A dimension with no rule row
 * (`ilities.functional-suitability`, `ilities.interaction-capability`, `ilities.reliability`,
 * `ilities.flexibility` in this pass) reports `not_measured` / `rule-not-built`.
 */

import type { DeltaRegistries, DimensionId, DimensionRegistry } from '../contract.js';
import { BUILT_IN_METRICS, BUILT_IN_RULES } from '../rules/index.js';
import { DEFAULT_REGISTRIES } from './defaults.js';

export const ALL_DIMENSIONS: readonly DimensionId[] = [
    'ilities.compatibility',
    'ilities.flexibility',
    'ilities.functional-suitability',
    'ilities.interaction-capability',
    'ilities.maintainability',
    'ilities.reliability',
    'ilities.safety',
    'performance',
    'quality',
    'security',
];

/** The built-in registry, with `registries` replaced when a repo's overrides were merged. */
export function defaultDimensionRegistry(registries: DeltaRegistries = DEFAULT_REGISTRIES): DimensionRegistry {
    return { dimensions: ALL_DIMENSIONS, rules: BUILT_IN_RULES, metrics: BUILT_IN_METRICS, registries };
}
