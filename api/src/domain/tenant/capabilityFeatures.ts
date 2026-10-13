import type { PlanFeature } from './planFeatures';

/**
 * MARKETPLACE CAPABILITIES → the plan features their licence grants (PRD 33 §4.2).
 *
 * A capability listing (`catalog_items.kind = 'capability'`, published by the
 * platform) is a product a workspace INSTALLS rather than a plan tier it buys. The
 * licence the install writes (`template_licenses`) IS the entitlement: the feature
 * gate asks which capability listings the tenant holds a live licence for and maps
 * their slugs through this table. No plan grants these features (`PlanLimits` has
 * them `false` everywhere), so there is one way in — the Marketplace — for every
 * workspace, Builderforce's own included (D17).
 *
 * Pure data + pure helpers. The DB read lives in
 * `application/tenant/heldCapabilities.ts`.
 */
export const CAPABILITY_FEATURES: Readonly<Record<string, readonly PlanFeature[]>> = {
  'session-replay': ['sessionReplay'],
};

/**
 * The only publisher whose capability listings grant anything. A capability row
 * with any other publisher (or a tenant owner) is ignored by the entitlement read,
 * so a seller cannot mint access by publishing a look-alike listing.
 */
export const CAPABILITY_PUBLISHER_REF = 'builderforce';

/** The `catalog_items.kind` capability listings carry. */
export const CAPABILITY_LISTING_KIND = 'capability';

/** Features granted by holding licences for these capability slugs (deduplicated). */
export function featuresForCapabilities(slugs: Iterable<string>): PlanFeature[] {
  const out = new Set<PlanFeature>();
  for (const slug of slugs) {
    for (const feature of CAPABILITY_FEATURES[slug] ?? []) out.add(feature);
  }
  return [...out];
}

/** The capability slug whose licence grants `feature`, or null for a plan feature. */
export function capabilityForFeature(feature: PlanFeature): string | null {
  for (const [slug, features] of Object.entries(CAPABILITY_FEATURES)) {
    if (features.includes(feature)) return slug;
  }
  return null;
}

/** True when `feature` is granted by a capability licence rather than by a plan. */
export function isCapabilityFeature(feature: PlanFeature): boolean {
  return capabilityForFeature(feature) !== null;
}

/**
 * The refusal for a capability feature the workspace has not installed.
 *
 * Deliberately NOT the upgrade envelope (`upgradeRequiredBody`): no plan unlocks a
 * capability, and "Upgrade to Teams" would send a person to the wrong door. The
 * answer names the listing to install instead.
 */
export interface CapabilityRequiredBody {
  error: string;
  code: 'capability_required';
  feature: PlanFeature;
  capability: string;
  installRequired: true;
}

export function capabilityRequiredBody(feature: PlanFeature, label: string): CapabilityRequiredBody {
  const capability = capabilityForFeature(feature) ?? '';
  return {
    error: `Install it from the Marketplace to unlock ${label}.`,
    code: 'capability_required',
    feature,
    capability,
    installRequired: true,
  };
}
