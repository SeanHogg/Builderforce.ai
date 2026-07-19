/**
 * Single source of truth for the authenticated app navigation.
 *
 * The menu is organized as a small set of PRIMARY DESTINATIONS (the sidebar
 * links). Sub-views are NOT separate menu items — they are TABS inside their
 * destination, rendered by one shared <SectionTabs> bar in the app shell. So
 * e.g. Portfolio/PMO and Ceremonies are tabs of Projects, not top-level items;
 * every analytics/measurement lens (incl. Surveys, custom Dashboards and
 * DevFinOps) is a tab of the one "Insights" item, not its own sidebar entry.
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
import { ADMIN_GROUP_META } from './adminGroups';

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
    match: ['/projects', '/tasks', '/pmo', '/ceremonies', '/kanban-templates'],
    tabKind: 'query', basePath: '/projects',
    tabs: [
      { id: '', labelKey: 'tab.projects', icon: '▦', countKey: PROJECTS_COUNT_KEY },
      { id: 'tasks', labelKey: 'tab.tasks', icon: '✓' },
      { id: 'manager', labelKey: 'tab.manager', icon: '🧭' },
      { id: 'pm', labelKey: 'tab.planning', icon: '🗺' },
      { id: 'portfolio', labelKey: 'tab.portfolio', icon: '📊' },
      { id: 'ceremonies', labelKey: 'tab.ceremonies', icon: '🎯' },
      { id: 'templates', labelKey: 'tab.templates', icon: '🗂' },
      // Pre-sales: respond to an RFQ/RFP with a co-branded proposal grounded on the
      // portfolio + a fresh diagnostics scan (capability roster + P&L + plan).
      { id: 'rfp', labelKey: 'tab.rfp', icon: '📄' },
    ],
  },
  // IDE is one destination scoped to its project type. Each project IS typed by
  // modality (designer/video/llm/voice) at creation, so there are no modality
  // sub-tabs here — Voice opens as a Voice IDE project, not a separate menu item.
  { id: 'ide', labelKey: 'group.ide', icon: '💻', href: '/ide/dashboard', match: ['/ide'] },
  { id: 'workflows', labelKey: 'group.workflows', icon: '🔀', href: '/workflows', match: ['/workflows'] },
  {
    // "Talent / Workforce": people + agents (Workforce) AND the roster of roles and
    // external hires (Talent) share one destination. The Talent tab is the relocated
    // /hires surface; the Roles tab is the workspace role roster with assignment.
    // Live video/audio collaboration (Meetings) is a tab here too — schedule + join
    // standups, planning, retros, ad-hoc and direct calls; connect Google/Microsoft
    // calendars. `/meetings` redirects into ?tab=meetings.
    id: 'workforce', labelKey: 'group.workforce', icon: '👥', href: '/workforce',
    match: ['/workforce', '/hires', '/meetings'],
    tabKind: 'query', basePath: '/workforce',
    tabs: [
      { id: '', labelKey: 'tab.workforce', icon: '👥' },
      { id: 'roles', labelKey: 'tab.roles', icon: '🎭' },
      { id: 'teams', labelKey: 'tab.teams', icon: '🧑‍🤝‍🧑' },
      { id: 'meetings', labelKey: 'tab.meetings', icon: '📹' },
      { id: 'calendar', labelKey: 'tab.calendar', icon: '📅' },
      { id: 'talent', labelKey: 'tab.talent', icon: '🤝' },
      { id: 'performance', labelKey: 'tab.performance', icon: '📊' },
      { id: 'plan', labelKey: 'tab.plan', icon: '🧮' },
      { id: 'chats', labelKey: 'tab.chats', icon: '💬' },
      { id: 'approvals', labelKey: 'tab.approvals', icon: '✅' },
      { id: 'logs', labelKey: 'tab.logs', icon: '📜' },
      { id: 'qa', labelKey: 'tab.qa', icon: '🧪' },
    ],
  },
  {
    id: 'insights', labelKey: 'group.insights', icon: '📈', href: '/insights',
    // Surveys, custom Dashboards and DevFinOps are analytics/measurement surfaces,
    // so they live here as lenses of Insights rather than as their own top-level
    // sidebar items (keeping the "few primary destinations" rule above intact).
    match: ['/insights', '/alerts', '/surveys', '/dashboards', '/finops'],
    tabKind: 'route',
    tabs: [
      // The composed, out-of-box HOME dashboard: the widgets the user PINNED from
      // anywhere in the app. Every other tab is itself a dashboard whose cards can
      // be pinned here.
      { id: '/insights', labelKey: 'tab.home', icon: '🏠' },
      // One combined entry point for the AI reports (AI Impact, AI Effectiveness
      // and Recommendations) — each is now a drillable section of /insights/ai,
      // not its own tab, trimming the over-long tab bar. activePaths keeps the AI
      // tab highlighted on the retired routes while they redirect in.
      { id: '/insights/ai', labelKey: 'tab.ai', icon: '✨', activePaths: ['/insights/ai-impact', '/insights/engineering', '/insights/recommendations'] },
      // Delivery is a HUB: delivery + bottlenecks + DORA + SPACE + benchmarking +
      // funnel are drill-down slide-outs of this one tab (their old routes
      // redirect here with ?panel=). activePaths keeps the tab highlighted on the
      // retired routes while they redirect in. [insights consolidation]
      { id: '/insights/delivery', labelKey: 'tab.delivery', icon: '📦', activePaths: ['/insights/bottlenecks', '/insights/dora', '/insights/space', '/insights/benchmarking', '/insights/funnel'] },
      // Finance is a HUB: FinOps spend + Investment Allocation + DevFinOps (R&D /
      // SOC / audit) are drill-down slide-outs of this one tab (their old routes
      // redirect here with ?drill=). activePaths keeps the tab highlighted on the
      // retired routes while they redirect in. [insights consolidation]
      { id: '/insights/finance', labelKey: 'tab.finance', icon: '💰', activePaths: ['/finops', '/insights/allocation'] },
      // DevEx is a HUB: survey results + survey management (the retired /surveys
      // page) are drill-down slide-outs of this one tab. activePaths keeps the tab
      // highlighted on /surveys while it redirects in (?panel=surveys). [insights consolidation]
      { id: '/insights/devex', labelKey: 'tab.devex', icon: '🩺', activePaths: ['/surveys'] },
      { id: '/insights/compliance', labelKey: 'tab.compliance', icon: '🛡' },
      { id: '/alerts', labelKey: 'tab.alerts', icon: '🔔' },
      // Periodic lens review snapshots (monthly/quarterly/annual cadence).
      { id: '/insights/snapshots', labelKey: 'tab.snapshots', icon: '🗓' },
    ],
  },
  {
    id: 'quality', labelKey: 'group.quality', icon: '🐞', href: '/quality',
    match: ['/quality'],
    tabKind: 'query', basePath: '/quality',
    tabs: [
      { id: '', labelKey: 'tab.errors', icon: '🐞' },
      { id: 'collectors', labelKey: 'tab.collectors', icon: '🔌' },
    ],
  },
  {
    // Reliability: the detect→respond loop under ONE destination — active Monitoring
    // (diagram boards + monitor pins; a breach opens an incident) folded together with
    // Incident Management (war rooms + on-call + escalation + contacts). Sub-views are
    // ?tab= pills on the /incidents page; the retired /monitoring route redirects into
    // ?tab=monitors so old deep links still resolve (kept in `match` for highlighting).
    id: 'reliability', labelKey: 'group.reliability', icon: '🚨', href: '/incidents',
    match: ['/incidents', '/monitoring'],
    tabKind: 'query', basePath: '/incidents',
    tabs: [
      { id: '', labelKey: 'tab.incidents', icon: '🚨' },
      { id: 'monitors', labelKey: 'tab.monitors', icon: '📡' },
      { id: 'oncall', labelKey: 'tab.oncall', icon: '📟' },
      { id: 'escalation', labelKey: 'tab.escalation', icon: '⏫' },
      { id: 'contacts', labelKey: 'tab.contacts', icon: '📇' },
      { id: 'reporting', labelKey: 'tab.reporting', icon: '📊' },
    ],
  },
  // Knowledge is now ONE destination. SOPs / Processes / Documents / Training are
  // no longer separate tabs — they are a single template-driven library with the
  // training + compliance lens surfaced on the home. The former "Library" group is
  // folded in here: its reusable assets (Skills / Personas / Prompts) become tabs of
  // Knowledge, and "Content" is replaced by knowledge documents themselves.
  {
    id: 'knowledge', labelKey: 'group.knowledge', icon: '📖', href: '/knowledge',
    match: ['/knowledge', '/content-manager', '/skills', '/personas', '/prompts', '/facts'],
    tabKind: 'route',
    tabs: [
      { id: '/knowledge', labelKey: 'tab.knowledge', icon: '📖' },
      { id: '/skills', labelKey: 'tab.skills', icon: '⭐' },
      { id: '/personas', labelKey: 'tab.personas', icon: '👤' },
      { id: '/prompts', labelKey: 'tab.prompts', icon: '📚' },
      // Structured, queryable fact store (subject·predicate·object triples).
      { id: '/facts', labelKey: 'tab.facts', icon: '🧩' },
    ],
  },
  {
    id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings',
    match: ['/settings', '/security', '/pricing', '/tenants'],
    tabKind: 'route',
    tabs: [
      { id: '/settings', labelKey: 'tab.settings', icon: '⚙', activePaths: [] },
      // Lateral "lens persona" (CEO/CFO/CTO/CISO/PMO/EM) — reshapes insight lenses.
      { id: '/settings/persona', labelKey: 'tab.persona', icon: '🎯' },
      { id: '/security', labelKey: 'tab.security', icon: '🔒' },
      { id: '/settings/integrations', labelKey: 'tab.integrations', icon: '🔌' },
      { id: '/pricing', labelKey: 'tab.billing', icon: '💳' },
      { id: '/tenants', labelKey: 'tab.tenant', icon: '🏢' },
    ],
  },
  {
    // Platform Admin: superadmin-only. The 19 capabilities are consolidated into
    // 10 top-level GROUPS (ADMIN_GROUP_META — the single source of truth, shared
    // with the admin page). Each group is a TAB in the shared <SectionTabs> bar
    // (query kind, ?tab=…); a group's sub-views are an inner <AdminGroupNav>
    // (?sub=…) on the page. The default group (Overview) uses id '' so a bare
    // /admin highlights it.
    id: 'admin', labelKey: 'group.admin', icon: '⚙', href: '/admin', match: ['/admin'], superadminOnly: true,
    tabKind: 'query', basePath: '/admin',
    tabs: ADMIN_GROUP_META.map((g) => ({ id: g.id, labelKey: g.labelKey, icon: g.icon })),
  },
];

/**
 * The RESTRICTED navigation for a freelancer / gig account (users.account_type =
 * 'freelancer'). A for-hire worker never sees the IDE, Brain, projects, insights,
 * etc. — only their for-hire profile, the gigs they can bid on / are engaged with,
 * their timecard, and account settings. Kept as its own list (not a filter of the
 * builder nav) because it is a deliberately different, minimal destination set.
 */
/**
 * The for-hire WORKER destinations: profile / find work / timecard. Shared so both
 * the restricted freelancer shell AND an opted-in builder's nav surface the exact
 * same set — never re-inlined in two places.
 */
export const FOR_HIRE_NAV_GROUPS: NavGroup[] = [
  { id: 'freelancer-dashboard', labelKey: 'group.myDashboard', icon: '🏠', href: '/freelancer/dashboard', match: ['/freelancer/dashboard'] },
  { id: 'freelancer-profile', labelKey: 'group.myProfile', icon: '👤', href: '/freelancer/profile', match: ['/freelancer/profile'] },
  { id: 'freelancer-gigs', labelKey: 'group.findWork', icon: '🔎', href: '/marketplace?category=gigs', match: ['/marketplace', '/freelancer/gigs'] },
  { id: 'freelancer-workspace', labelKey: 'group.myWorkspace', icon: '🛠', href: '/freelancer/workspace', match: ['/freelancer/workspace'] },
  { id: 'freelancer-timecard', labelKey: 'group.timecard', icon: '⏱', href: '/freelancer/timecard', match: ['/freelancer/timecard'] },
];

export const FREELANCER_NAV_GROUPS: NavGroup[] = [
  ...FOR_HIRE_NAV_GROUPS,
  {
    // A gig account's personal settings live on /settings (Account / Personality /
    // Sessions sub-tabs) — the same place a builder manages their own account. The
    // Workspace sub-tab self-hides without a tenant, and the tenant-only sub-routes
    // (integrations / api-keys) are never linked here.
    id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings',
    match: ['/settings'],
    tabKind: 'route',
    tabs: [
      { id: '/settings', labelKey: 'tab.settings', icon: '⚙' },
    ],
  },
];

/** Route prefixes a freelancer account is allowed to reach in the app shell. Used
 *  by both the nav (which groups to show) and the route guard (redirect away from
 *  anything else). Public/marketing routes are handled separately by the shell. */
export const FREELANCER_ALLOWED_PREFIXES = ['/freelancer'];

/** Paths a freelancer may reach by EXACT match only — the settings root holds their
 *  personal account controls, but the tenant-scoped `/settings/*` sub-routes
 *  (integrations, api-keys) stay off-limits (they 401 for a tenantless account), so
 *  we intentionally do not allow the `/settings` prefix. `/security` is kept
 *  reachable for old deep links; it degrades to a "no workspace" state. */
export const FREELANCER_ALLOWED_EXACT = ['/settings', '/security'];

/** The nav destinations for the current account type — the ONE place the
 *  freelancer-vs-builder nav split is decided, so the Sidebar + SectionTabs and
 *  the route guard never drift. A dedicated freelancer gets the restricted shell; a
 *  builder who opted in to being hired (`availableForHire`) keeps the full builder
 *  nav PLUS the for-hire worker destinations. */
export function navGroupsForAccountType(isFreelancer: boolean, availableForHire = false): NavGroup[] {
  if (isFreelancer) return FREELANCER_NAV_GROUPS;
  return availableForHire ? [...NAV_GROUPS, ...FOR_HIRE_NAV_GROUPS] : NAV_GROUPS;
}

/** Whether a freelancer account may view this in-app path (else redirect). */
export function isFreelancerAllowedPath(pathname: string): boolean {
  if (FREELANCER_ALLOWED_EXACT.includes(pathname)) return true;
  return FREELANCER_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Longest-prefix match so /ide/dashboard resolves to IDE, /settings/api-keys to Settings, etc. */
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
