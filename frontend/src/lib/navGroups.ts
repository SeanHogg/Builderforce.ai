/**
 * Single source of truth for the authenticated app navigation.
 *
 * The menu is organized as a small set of PRIMARY DESTINATIONS (the sidebar
 * links). Sub-views are NOT separate menu items — they are TABS inside their
 * destination, rendered by one shared <SectionTabs> bar in the app shell. So
 * e.g. Portfolio/PMO and Ceremonies are tabs of Projects, not top-level items;
 * the five insight lenses are tabs of one "Insights" item.
 *
 * Two tab flavors, unified here so the Sidebar + SectionTabs never drift:
 *   - kind:'route'  — each tab is its own route (e.g. /insights/dora). The tab
 *                     bar links between routes; each page renders its own body.
 *   - kind:'query'  — one page with a `?tab=` param (e.g. /projects?tab=pm). The
 *                     tab bar links with ?tab=; the page reads the param to pick
 *                     its body. Such pages drop their in-page tab bar (the shell
 *                     bar owns it).
 */

import { isNavItemActive } from './nav';

/** Count-badge key for the Projects tab (published by the Projects page, read by
 *  <SectionTabs>). Lives here so the config + publisher share one constant. */
export const PROJECTS_COUNT_KEY = 'projects';

export interface NavTab {
  /** For kind:'query' this is the `?tab=` value (default tab uses '' / omitted). */
  id: string;
  /** i18n key under the `nav` namespace. */
  labelKey: string;
  icon: string;
  /** Extra path prefixes that also activate this tab (route tabs only). */
  activePaths?: string[];
  /** Hidden from non-owners (e.g. API keys). */
  ownerOnly?: boolean;
  /** When set, the tab shows a count badge from the navCounts store under this key. */
  countKey?: string;
}

export interface NavGroup {
  id: string;
  /** i18n key under `nav`. */
  labelKey: string;
  icon: string;
  /** The primary-destination hyperlink (the grouping itself). */
  href: string;
  /** Path prefixes that belong to this group (drives sidebar-active + tab-bar). */
  match: string[];
  /** 'route' tabs link to distinct paths; 'query' tabs are ?tab= on `basePath`. */
  tabKind?: 'route' | 'query';
  /** Base path for kind:'query' tab hrefs. */
  basePath?: string;
  tabs?: NavTab[];
  /** Only shown to superadmins (Platform Admin). */
  superadminOnly?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  { id: 'dashboard', labelKey: 'group.dashboard', icon: '🏠', href: '/dashboard', match: ['/dashboard'] },
  { id: 'brainstorm', labelKey: 'group.brainstorm', icon: '💡', href: '/brainstorm', match: ['/brainstorm'] },
  {
    id: 'projects', labelKey: 'group.projects', icon: '▦', href: '/projects',
    match: ['/projects', '/tasks', '/pmo', '/ceremonies'],
    tabKind: 'query', basePath: '/projects',
    tabs: [
      { id: '', labelKey: 'tab.projects', icon: '▦', countKey: PROJECTS_COUNT_KEY },
      { id: 'tasks', labelKey: 'tab.tasks', icon: '✓' },
      { id: 'pm', labelKey: 'tab.planning', icon: '🗺' },
      { id: 'portfolio', labelKey: 'tab.portfolio', icon: '📊' },
      { id: 'ceremonies', labelKey: 'tab.ceremonies', icon: '🎯' },
    ],
  },
  {
    id: 'ide', labelKey: 'group.ide', icon: '💻', href: '/ide/dashboard',
    match: ['/ide'],
    tabKind: 'route',
    tabs: [
      { id: '/ide/dashboard', labelKey: 'tab.workspace', icon: '💻', activePaths: ['/ide/dashboard'] },
      { id: '/ide/voice', labelKey: 'tab.voice', icon: '🎙' },
    ],
  },
  { id: 'workflows', labelKey: 'group.workflows', icon: '🔀', href: '/workflows', match: ['/workflows'] },
  // Workforce keeps its own rich in-page tab bar (counts, sub-labels) — it is
  // already a single destination, so no shell tabs are declared for it.
  { id: 'workforce', labelKey: 'group.workforce', icon: '👥', href: '/workforce', match: ['/workforce'] },
  {
    id: 'insights', labelKey: 'group.insights', icon: '📈', href: '/insights/engineering',
    match: ['/insights', '/alerts'],
    tabKind: 'route',
    tabs: [
      { id: '/insights/ai-impact', labelKey: 'tab.aiImpact', icon: '✨' },
      { id: '/insights/delivery', labelKey: 'tab.delivery', icon: '📦' },
      { id: '/insights/bottlenecks', labelKey: 'tab.bottlenecks', icon: '⏳' },
      { id: '/insights/engineering', labelKey: 'tab.aiEffectiveness', icon: '🤖' },
      { id: '/insights/recommendations', labelKey: 'tab.recommendations', icon: '🧠' },
      { id: '/insights/dora', labelKey: 'tab.dora', icon: '🚀' },
      { id: '/insights/space', labelKey: 'tab.space', icon: '🛰' },
      { id: '/insights/finance', labelKey: 'tab.finops', icon: '💰' },
      { id: '/insights/allocation', labelKey: 'tab.allocation', icon: '🧭' },
      { id: '/insights/benchmarking', labelKey: 'tab.benchmarking', icon: '📊' },
      { id: '/insights/devex', labelKey: 'tab.devex', icon: '🩺' },
      { id: '/insights/funnel', labelKey: 'tab.funnel', icon: '💡' },
      { id: '/insights/compliance', labelKey: 'tab.compliance', icon: '🛡' },
      { id: '/alerts', labelKey: 'tab.alerts', icon: '🔔' },
    ],
  },
  { id: 'surveys', labelKey: 'group.surveys', icon: '🩺', href: '/surveys', match: ['/surveys'] },
  { id: 'dashboards', labelKey: 'group.dashboards', icon: '🧮', href: '/dashboards', match: ['/dashboards'] },
  { id: 'finops', labelKey: 'group.finops', icon: '🧾', href: '/finops', match: ['/finops'] },
  {
    id: 'quality', labelKey: 'group.quality', icon: '🐞', href: '/quality',
    match: ['/quality'],
    tabKind: 'query', basePath: '/quality',
    tabs: [
      { id: '', labelKey: 'tab.errors', icon: '🐞' },
      { id: 'sources', labelKey: 'tab.sources', icon: '🔌' },
    ],
  },
  {
    id: 'knowledge', labelKey: 'group.knowledge', icon: '📖', href: '/knowledge',
    match: ['/knowledge'],
    tabKind: 'query', basePath: '/knowledge',
    tabs: [
      { id: '', labelKey: 'tab.sops', icon: '📋' },
      { id: 'processes', labelKey: 'tab.processes', icon: '🔁' },
      { id: 'docs', labelKey: 'tab.docs', icon: '📄' },
      { id: 'training', labelKey: 'tab.training', icon: '🎓' },
    ],
  },
  {
    id: 'library', labelKey: 'group.library', icon: '🧩', href: '/content-manager',
    match: ['/content-manager', '/skills', '/personas', '/prompts'],
    tabKind: 'route',
    tabs: [
      { id: '/content-manager', labelKey: 'tab.content', icon: '✎' },
      { id: '/skills', labelKey: 'tab.skills', icon: '⭐' },
      { id: '/personas', labelKey: 'tab.personas', icon: '👤' },
      { id: '/prompts', labelKey: 'tab.prompts', icon: '📚' },
    ],
  },
  {
    id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings',
    match: ['/settings', '/security', '/pricing', '/tenants'],
    tabKind: 'route',
    tabs: [
      { id: '/settings', labelKey: 'tab.settings', icon: '⚙', activePaths: [] },
      { id: '/security', labelKey: 'tab.security', icon: '🔒' },
      { id: '/pricing', labelKey: 'tab.billing', icon: '💳' },
      { id: '/tenants', labelKey: 'tab.tenant', icon: '🏢' },
      { id: '/settings/api-keys', labelKey: 'tab.apiKeys', icon: '🔑', ownerOnly: true },
    ],
  },
  { id: 'admin', labelKey: 'group.admin', icon: '⚙', href: '/admin', match: ['/admin'], superadminOnly: true },
];

/** Longest-prefix match so /ide/voice resolves to IDE, /settings/api-keys to Settings, etc. */
export function findActiveGroup(pathname: string): NavGroup | undefined {
  let best: NavGroup | undefined;
  let bestLen = -1;
  for (const g of NAV_GROUPS) {
    for (const m of g.match) {
      if (pathname === m || pathname.startsWith(`${m}/`) || (m !== '/settings' && pathname.startsWith(m))) {
        if (m.length > bestLen) { best = g; bestLen = m.length; }
      }
    }
  }
  return best;
}

/** Resolve the active route-tab id within a group (longest matching href wins). */
export function activeRouteTabId(group: NavGroup, pathname: string): string | undefined {
  if (group.tabKind !== 'route' || !group.tabs) return undefined;
  let best: string | undefined;
  let bestLen = -1;
  for (const t of group.tabs) {
    const ok = isNavItemActive(pathname, { href: t.id, activePaths: t.activePaths, exactMatch: t.id === '/settings' });
    if (ok && t.id.length > bestLen) { best = t.id; bestLen = t.id.length; }
  }
  return best;
}

/** Build the href for a tab (query tabs append ?tab=, default tab omits it). */
export function tabHref(group: NavGroup, tab: NavTab): string {
  if (group.tabKind === 'query') {
    return tab.id ? `${group.basePath}?tab=${tab.id}` : (group.basePath ?? group.href);
  }
  return tab.id;
}
