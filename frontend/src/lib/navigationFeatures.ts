import type { NavGroup } from './navGroups';

/** Optional workspace modules. Core routes are deliberately absent. */
export const NAVIGATION_FEATURE_IDS = [
  'challenges',
  'projects',
  'workforce',
  'insights',
  'growth',
  'quality',
  'reliability',
  'knowledge',
  // The RUN group: each business seat's domain is independently optional, so a
  // workspace that does not raise money can switch Investors off without losing
  // Finance. `seat` is gone — it was one toggle for a door labelled *door*.
  'finance',
  'revenue',
  'people',
  'hiring',
  'investor',
  'governance',
  'support',
] as const;

export type NavigationFeatureId = (typeof NAVIGATION_FEATURE_IDS)[number];

const OPTIONAL_NAVIGATION_GROUPS = new Set<string>(NAVIGATION_FEATURE_IDS);

export function isNavigationFeatureId(value: string): value is NavigationFeatureId {
  return OPTIONAL_NAVIGATION_GROUPS.has(value);
}

/** One filter used by the sidebar, palette and Brain destination catalog. */
export function filterNavigationGroups(
  groups: readonly NavGroup[],
  enabled: ReadonlySet<NavigationFeatureId>,
): NavGroup[] {
  return groups.filter((group) => !isNavigationFeatureId(group.id) || enabled.has(group.id));
}

export function navigationFeatureForPath(pathname: string): NavigationFeatureId | undefined {
  const group = pathname.split('?')[0];
  if (group === '/projects' || group.startsWith('/projects/')) return 'projects';
  if (group === '/workforce' || group.startsWith('/workforce/')) return 'workforce';
  if (group === '/insights' || group.startsWith('/insights/')) return 'insights';
  return undefined;
}
