import { NAV_GROUPS, tabHref, type NavGroup } from '@/lib/navGroups';

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
 * Deliberately NOT here: plan-feature locks. The client has no authoritative
 * entitlement snapshot — only `plan.effective` — and the standing rule is one
 * evaluator for paid-plan gates. A client-side plan→feature map would be a
 * second one. Role/ownership gating below is authoritative on the client and is
 * applied; plan locks wait for a server-provided entitlement payload.
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
}

/**
 * Destinations that are not nav groups or tabs — the canvas surfaces, which are
 * where the work actually happens and so must be searchable by name.
 */
const CANVAS_DESTINATIONS: Destination[] = [
  { id: 'canvas.library', labelKey: 'destination.canvasLibrary', groupLabelKey: 'group.create', href: '/create', icon: '✦', keywords: ['canvas', 'canvases', 'sessions', 'library', 'my work', 'recent'] },
  { id: 'canvas.new', labelKey: 'destination.newCanvas', groupLabelKey: 'group.create', href: '/create/new', icon: '＋', keywords: ['new', 'blank', 'start', 'create'] },
];

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

export interface RankedDestination extends Destination {
  label: string;
  groupLabel: string;
}

/**
 * Rank destinations for a query. `translate` resolves a `nav`-namespace key; it
 * is passed in so this stays a pure function that unit tests can drive without
 * mounting an i18n provider.
 */
export function rankDestinations(
  destinations: readonly Destination[],
  query: string,
  translate: (key: string) => string,
  limit = 12,
): RankedDestination[] {
  return destinations
    .map((destination) => {
      const label = translate(destination.labelKey);
      const groupLabel = translate(destination.groupLabelKey);
      return { ...destination, label, groupLabel, score: scoreDestination(destination, label, groupLabel, query) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}
