/**
 * Shared active-link logic for the Sidebar (and any future nav surface). One
 * matcher so the "which item is active" rule can't drift.
 *
 * Consumers pass the current `usePathname()` value plus the nav item; the item
 * only needs an `href`, with two optional escape hatches:
 *   - `exactMatch`  — only the exact path is active (no prefix match)
 *   - `activePaths` — extra prefixes this item "owns" (e.g. Workflow Builder
 *     owning all of /workflows)
 */
export interface NavMatch {
  href: string;
  /** When true, only an exact path match is active (no prefix match). */
  exactMatch?: boolean;
  /** Extra path prefixes that should also light this item up. */
  activePaths?: string[];
}

/** Hrefs that must never greedy-match their sub-paths as a prefix. */
const NON_GREEDY_HREFS = new Set(['/', '/dashboard']);

export function isNavItemActive(pathname: string, item: NavMatch): boolean {
  const { href } = item;

  // Anchor / hash links (e.g. "#features", "/#pricing") are in-page jumps, not
  // routes — they never own an "active" state.
  if (href.startsWith('#') || href.includes('#')) return false;
  // External links are never active.
  if (/^https?:\/\//.test(href)) return false;

  if (item.exactMatch) return pathname === href;
  if (pathname === href) return true;
  if (!NON_GREEDY_HREFS.has(href) && pathname.startsWith(href)) return true;
  if (item.activePaths?.some((p) => pathname.startsWith(p))) return true;
  return false;
}
