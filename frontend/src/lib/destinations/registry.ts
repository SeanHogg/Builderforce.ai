import { NAV_GROUPS, tabHref, type NavGroup } from '@/lib/navGroups';
import type { PlanFeatureKey } from '@/lib/builderforceApi';

/**
 * The destination registry — ONE list of every place in the app you can go, read
 * by all three navigation doors.
 *
 * Browsing a menu works at 78 routes. It does not work at the scale the two
 * consolidation programs are bringing (471 incoming pages against 78 surveyed
 * ones), and the failure mode is not "the menu is long" but "three surfaces each
 * grow their own idea of what exists": the rail, a search palette, and the Brain
 * (which already opens two drawers and should be able to open anything). Three
 * lists is how they start disagreeing about what the product can do.
 *
 * So this DERIVES from {@link NAV_GROUPS} rather than restating it. A group is a
 * destination; each of its tabs is a destination; adding a tab to the nav config
 * lights it up in search and for the Brain with no second registration. Ported
 * pages register by joining the nav config, which is the only reason this stays
 * maintainable as the merge lands.
 *
 * Plan locks are declared, never derived. A destination names the `PlanFeature`
 * its route actually enforces, and the answer comes from the entitlement set the
 * SERVER resolves (`ConsumptionSnapshot.features`) using the same evaluator the
 * route gates on. Deriving a lock from `plan.effective` on the client would be a
 * second evaluator, and it would disagree the first time a flag moved plans.
 * Only features with a verified server gate are mapped.
 */

export interface Destination {
  /** Stable, human-readable id — what the Brain names when it opens something. */
  id: string;
  /** i18n key under the `nav` namespace. */
  labelKey: string;
  /** The owning group's i18n key, shown as the palette's section header. */
  groupLabelKey: string;
  href: string;
  icon: string;
  /** Hidden from non-owners (matches the nav config's own tab gating). */
  ownerOnly?: boolean;
  /** Platform-operator destinations. */
  superadminOnly?: boolean;
  /** Extra match terms that are not in the label (synonyms, the old route name). */
  keywords?: string[];
  /**
   * The plan feature this destination's route ENFORCES server-side. Only set
   * where a gate genuinely exists — advertising a lock the API does not apply
   * would be worse than showing none.
   */
  feature?: PlanFeatureKey;
}

/**
 * Destinations that are not nav groups or tabs — the canvas surfaces, which are
 * where the work actually happens and so must be searchable by name.
 */
const CANVAS_DESTINATIONS: Destination[] = [
  { id: 'canvas.library', labelKey: 'destination.canvasLibrary', groupLabelKey: 'group.create', href: '/create', icon: '✦', keywords: ['canvas', 'canvases', 'sessions', 'library', 'my work', 'recent'] },
  { id: 'canvas.new', labelKey: 'destination.newCanvas', groupLabelKey: 'group.create', href: '/create/new', icon: '＋', keywords: ['new', 'blank', 'start', 'create'] },
];

/**
 * Route → the plan feature its API actually enforces. Verified against the
 * server: `/settings/viewpoint` is gated by `tenantHasFeature('psychometricPersona')`
 * in personaRoutes/personalityRoutes, and `/insights/finance` by
 * `requirePlanFeature('advancedInsights')` in insightsRoutes. Nothing else is
 * listed, because nothing else is gated.
 */
const FEATURE_BY_HREF: Record<string, PlanFeatureKey | undefined> = {
  '/settings/viewpoint': 'psychometricPersona',
  '/insights/finance': 'advancedInsights',
};

/** Flatten the nav config into destinations: every group, and every tab within it. */
export function listDestinations(groups: readonly NavGroup[] = NAV_GROUPS): Destination[] {
  const destinations: Destination[] = [];
  for (const group of groups) {
    destinations.push({
      id: group.id,
      labelKey: group.labelKey,
      groupLabelKey: group.labelKey,
      href: group.href,
      icon: group.icon,
      superadminOnly: group.superadminOnly,
      keywords: group.match,
    });
    for (const tab of group.tabs ?? []) {
      // The default tab IS the group's own destination — listing it twice would
      // put two identical rows in the palette.
      if (!tab.id || tab.id === group.href) continue;
      destinations.push({
        feature: FEATURE_BY_HREF[tab.id],
        id: `${group.id}.${tab.id.replace(/^\//, '').replace(/\//g, '.')}`,
        labelKey: tab.labelKey,
        groupLabelKey: group.labelKey,
        href: tabHref(group, tab),
        icon: tab.icon,
        ownerOnly: tab.ownerOnly,
        superadminOnly: group.superadminOnly,
        keywords: tab.activePaths,
      });
    }
  }
  return [...CANVAS_DESTINATIONS, ...destinations];
}

/**
 * Score one destination against a query. Higher is better; 0 means no match.
 *
 * Ranked rather than filtered so an exact label hit always outranks an incidental
 * substring in a route path — typing "delivery" must offer the Delivery tab
 * before it offers anything whose href merely contains the word.
 */
export function scoreDestination(destination: Destination, label: string, groupLabel: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;

  const name = label.toLowerCase();
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;
  // A hit at a word boundary reads as intentional; mid-word does not.
  if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) return 60;
  if (name.includes(needle)) return 40;
  if (groupLabel.toLowerCase().includes(needle)) return 30;
  if (destination.keywords?.some((keyword) => keyword.toLowerCase().includes(needle))) return 20;
  if (destination.href.toLowerCase().includes(needle)) return 10;
  return 0;
}

export type Ranked<T extends Destination> = T & { label: string; groupLabel: string };
export type RankedDestination = Ranked<Destination>;

/**
 * Rank destinations for a query. `translate` resolves a `nav`-namespace key; it
 * is passed in so this stays a pure function that unit tests can drive without
 * mounting an i18n provider.
 *
 * Generic in the destination type so a caller passing gated destinations gets
 * gated ones back — narrowing the result to the base `Destination` would make
 * the palette re-discover the lock it was already told about.
 */
export function rankDestinations<T extends Destination>(
  destinations: readonly T[],
  query: string,
  translate: (key: string) => string,
  limit = 12,
): Ranked<T>[] {
  // The score rides ALONGSIDE the entry rather than on it: spreading it in and
  // then Omit-ing it back out erases the generic, and the caller loses the gate
  // fields it passed in.
  return destinations
    .map((destination) => {
      const label = translate(destination.labelKey);
      const groupLabel = translate(destination.groupLabelKey);
      return {
        entry: { ...destination, label, groupLabel } as Ranked<T>,
        score: scoreDestination(destination, label, groupLabel, query),
      };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, limit)
    .map((scored) => scored.entry);
}
