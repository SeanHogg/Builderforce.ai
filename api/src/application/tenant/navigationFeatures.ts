/**
 * Workspace-controlled primary navigation modules.
 *
 * Core destinations (Dashboard, Canvas/Create and Settings) intentionally do not
 * appear here: a workspace can simplify its menu without hiding the controls
 * needed to turn modules back on.
 */
export const NAVIGATION_FEATURE_IDS = [
  'seat',
  'challenges',
  'projects',
  'workforce',
  'insights',
  'growth',
  'quality',
  'reliability',
  'knowledge',
] as const;

export type NavigationFeatureId = (typeof NAVIGATION_FEATURE_IDS)[number];

const NAVIGATION_FEATURE_SET = new Set<string>(NAVIGATION_FEATURE_IDS);

function parseSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Missing/invalid preferences mean every shipped module is enabled. */
export function readNavigationFeatures(raw: string | null | undefined): NavigationFeatureId[] {
  const value = parseSettings(raw).navigationFeatures;
  if (!Array.isArray(value)) return [...NAVIGATION_FEATURE_IDS];
  return NAVIGATION_FEATURE_IDS.filter((id) => value.includes(id));
}

/** Validate a client write without silently accepting misspelled module IDs. */
export function validateNavigationFeatures(value: unknown): NavigationFeatureId[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !NAVIGATION_FEATURE_SET.has(id))) {
    return null;
  }
  const selected = new Set(value);
  return NAVIGATION_FEATURE_IDS.filter((id) => selected.has(id));
}

/** Update only this settings slice and preserve every unrelated tenant setting. */
export function writeNavigationFeatures(
  raw: string | null | undefined,
  enabled: readonly NavigationFeatureId[],
): string {
  const settings = parseSettings(raw);
  settings.navigationFeatures = [...enabled];
  return JSON.stringify(settings);
}
