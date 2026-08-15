/**
 * THE destination registry (PRD 21 §11.2).
 *
 * One list of every place in the app you can go, placed by two facts each row
 * carries: its **owner** (`seat` — which decides the footer roster and the row's
 * colour) and its **stage** (`stage` — which decides the left panel's grouping,
 * Idea → Make → Run). Everything downstream is a projection of this array: the
 * left panel groups by stage, the ⌘K palette flattens it (`destinations/registry`),
 * the panel takes its crumb from it, and the public header and the features page
 * render the reference rows from it.
 *
 * It replaced a genuine mess. Before this, `BURNRATE_DOMAINS` was a SECOND
 * navigation list living in `burnrateCatalog.ts` whose rows pointed at marketing
 * pages, so the authenticated rail rendered nine C-suite domains that navigated
 * OUT of the product; the kernel's `DOMAINS` was a third; and the footer roster
 * a fourth. The CFO existed four times under four names. The rule that stops it
 * returning is `scripts/check-destinations.mjs`: exactly one array in the repo
 * may declare a navigable destination's label, icon and href, and it is this one.
 *
 * The menu is a small set of PRIMARY DESTINATIONS (the sidebar links). Sub-views
 * are NOT separate menu items — they are TABS inside their destination, rendered
 * by one shared <ShellIndex>. Two tab flavors, unified here so the shell's index
 * and the panel never drift:
 *   - kind:'route'  — each tab is its own route (e.g. /insights/dora). The tab
 *                     bar links between routes; each page renders its own body.
 *   - kind:'query'  — one page with a `?tab=` param (e.g. /projects?tab=pm). The
 *                     tab bar links with ?tab=; the page reads the param to pick
 *                     its body. Such pages drop their in-page tab bar (the shell
 *                     bar owns it).
 */

import { isNavItemActive } from './nav';
import { ADMIN_GROUP_META } from './adminGroups';
import type { SeatOrPlatform } from './seats';

/**
 * Where a destination sits in the arc — the operator's sentence ("one canvas,
 * idea to real") made into an information architecture. This is what the left
 * panel groups by, and it answers *where am I in the journey*, which is the only
 * question a first-time visitor can actually ask.
 *
 * `reference` is the odd one out and deliberately so: those rows are the public
 * explainer surfaces (`/soc2`, `/integrations`, the domain pages). They are NOT
 * left-panel rows — they appear in the marketing header and on `/features`, and
 * when a signed-in person opens one it mounts as a panel over the board rather
 * than throwing them out of their session (§11.4.5).
 *
 * `expand` is the arc's last productive step and the newest: MARKET is "put it
 * in front of people", EXPAND is "grow the business off the back of it" — the
 * referral and sales-associate programme, where somebody sells Builderforce
 * itself. It sat under RUN, which read as day-to-day operations and is the one
 * thing selling the product is not.
 */
export const STAGES = ['idea', 'make', 'run', 'measure', 'market', 'expand', 'admin'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Progressive disclosure (§11.4.4). A row is ALWAYS LISTED; the rung gates its
 * STATE. A dim row is an invitation; a missing row is a secret.
 *
 * Only three rungs are enforceable today, because the fourth ("claimed a
 * company") needs the company graph PRD 19 B0 brings. Run rows therefore sit at
 * WORKSPACE until then, which is honest: they need a workspace, and they do not
 * yet need a company because there is not yet a company to need.
 */
export const RUNG = { PUBLIC: 0, SIGNED_IN: 1, WORKSPACE: 2 } as const;
export type Rung = (typeof RUNG)[keyof typeof RUNG];

/** Count-badge key for the Projects tab (published by the Projects page, read by
 *  <ShellIndex>). Lives here so the config + publisher share one constant. */
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
  /**
   * PRD 20 §3 owner. Decides the footer chip this row corresponds to, and the
   * row's colour via `seatHue()`. `'platform'` means nobody sits behind it —
   * panel only, per PRD 21 §4, and no footer chip.
   */
  seat: SeatOrPlatform;
  /** Where in Idea → Make → Run this sits. Decides the LEFT PANEL grouping. */
  stage: Stage;
  /** The rung at which this row's STATE is earned. It is listed at every rung. */
  rung: Rung;
  /** 'route' tabs link to distinct paths; 'query' tabs are ?tab= on `basePath`. */
  tabKind?: 'route' | 'query';
  /** Base path for kind:'query' tab hrefs. */
  basePath?: string;
  tabs?: NavTab[];
  /** Only shown to superadmins (Platform Admin). */
  superadminOnly?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  // ── IDEA ─────────────────────────────────────────────────────────────────
  // Every creation mode lives in Canvas. Middleware redirects legacy entry URLs.
  { id: 'create', labelKey: 'group.create', icon: '✦', href: '/create', match: ['/create', '/brainstorm', '/workflows', '/challenges', '/realize'], seat: 'Brain', stage: 'idea', rung: RUNG.PUBLIC },
  // `challenges` is NOT a row. A challenge is something the CANVAS DOES — paste a
  // brief, get a working system — and a capability of a destination does not get
  // a door beside it. `/challenges` is still a route and the canvas still opens
  // it; what is gone is the menu item that made it look like a separate place.
  // `/realize` (choose what REAL means — a demo video, a demand test, a phone
  // line, the whole system) is the same class of thing and gets no row either,
  // but both are in `match` so the IDEA row stays lit while you are on them
  // rather than leaving the shell with nothing selected.
  // ── MAKE ─────────────────────────────────────────────────────────────────
  {
    id: 'projects', labelKey: 'group.projects', icon: '▦', href: '/projects',
    seat: 'Manager', stage: 'make', rung: RUNG.WORKSPACE,
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
  {
    // "Talent / Workforce": people + agents (Workforce) AND the roster of roles and
    // external hires (Talent) share one destination. The Talent tab is the relocated
    // /hires surface; the Roles tab is the workspace role roster with assignment.
    // Live video/audio collaboration (Meetings) is a tab here too — schedule + join
    // standups, planning, retros, ad-hoc and direct calls; connect Google/Microsoft
    // calendars. `/meetings` redirects into ?tab=meetings.
    id: 'workforce', labelKey: 'group.workforce', icon: '👥', href: '/workforce',
    seat: 'Manager', stage: 'make', rung: RUNG.WORKSPACE,
    match: ['/workforce', '/hires', '/meetings', '/agent-ops'],
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
      { id: 'qa', labelKey: 'tab.qa', icon: '🧪' },
      { id: 'coordination', labelKey: 'tab.coordination', icon: '🔗' },
      { id: 'memory', labelKey: 'tab.memory', icon: '🧠' },
      { id: 'rehearsal', labelKey: 'tab.rehearsal', icon: '🎬' },
    ],
  },
  {
    id: 'insights', labelKey: 'group.insights', icon: '📈', href: '/insights',
    seat: 'platform', stage: 'measure', rung: RUNG.WORKSPACE,
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
      // Autonomy Health — "are manager/agent-created tickets actually completing
      // their lifecycle autonomously?". Its own tab because it answers a question
      // no delivery metric does (per-ORIGIN funnel + the autonomous-vs-human hop
      // split); it is ALSO a Delivery-hub drill-down panel so the dashboard cards
      // and the Brain can open the same lens in a slide-out.
      { id: '/insights/autonomy', labelKey: 'tab.autonomy', icon: '🕹' },
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
    // Growth was built in 0412 and never linked from anywhere — the page existed
    // but no route in the app reached it, so the whole marketing surface was
    // dead. It is a destination in its own right now that it also owns connected
    // mailboxes and the campaign studio (0414).
    // The CMO's surface. It keeps `/growth` rather than resolving to
    // `/seat/growth`: where a real product surface already exists it wins over
    // the kernel's generic domain view, and one destination may not have two
    // hrefs.
    id: 'growth', labelKey: 'group.growth', icon: '📣', href: '/growth',
    seat: 'CMO', stage: 'run', rung: RUNG.WORKSPACE,
    match: ['/growth'],
  },
  {
    id: 'inbox', labelKey: 'group.inbox', icon: '✉', href: '/inbox',
    seat: 'CMO', stage: 'run', rung: RUNG.WORKSPACE,
    match: ['/inbox'],
  },
  // ── RUN — the business seats ─────────────────────────────────────────────
  // Each resolves to the kernel domain surface PRD 20 built (`/seat/<domain>`),
  // under its PRODUCT name with the seat as a trailing chip: "you are going to
  // Finance, which the CFO owns" reads correctly; "you are going to CFO" does
  // not. The `seat` nav group that used to sit here — a door labelled *door* —
  // is deleted; these rows and the footer chips are how you reach a seat now.
  { id: 'finance', labelKey: 'group.finance', icon: '💰', href: '/seat/finance', match: ['/seat/finance'], seat: 'CFO', stage: 'run', rung: RUNG.WORKSPACE },
  { id: 'revenue', labelKey: 'group.revenue', icon: '📈', href: '/seat/revenue', match: ['/seat/revenue'], seat: 'CRO', stage: 'run', rung: RUNG.WORKSPACE },
  { id: 'people', labelKey: 'group.people', icon: '🧑‍🤝‍🧑', href: '/seat/people', match: ['/seat/people'], seat: 'HR', stage: 'run', rung: RUNG.WORKSPACE },
  { id: 'hiring', labelKey: 'group.hiring', icon: '🤝', href: '/seat/hiring', match: ['/seat/hiring'], seat: 'Recruiter', stage: 'run', rung: RUNG.WORKSPACE },
  { id: 'investor', labelKey: 'group.investor', icon: '💼', href: '/seat/investor', match: ['/seat/investor'], seat: 'CEO', stage: 'run', rung: RUNG.WORKSPACE },
  { id: 'governance', labelKey: 'group.governance', icon: '🛡', href: '/seat/governance', match: ['/seat/governance'], seat: 'Security', stage: 'run', rung: RUNG.WORKSPACE },
  { id: 'support', labelKey: 'group.support', icon: '💬', href: '/seat/support', match: ['/seat/support'], seat: 'Support', stage: 'run', rung: RUNG.WORKSPACE },
  {
    // The bridge from a Canvas idea to a live customer-facing experience:
    // one install rail, independently consented capabilities, and host surfaces.
    id: 'embedded', labelKey: 'group.embedded', icon: '⌗', href: '/embedded',
    seat: 'CTO', stage: 'make', rung: RUNG.WORKSPACE,
    match: ['/embedded', '/embed'],
  },
  {
    id: 'quality', labelKey: 'group.quality', icon: '🐞', href: '/quality',
    seat: 'CTO', stage: 'make', rung: RUNG.WORKSPACE,
    match: ['/quality'],
    tabKind: 'query', basePath: '/quality',
    tabs: [
      { id: '', labelKey: 'tab.errors', icon: '🐞' },
      { id: 'collectors', labelKey: 'tab.collectors', icon: '🔌' },
      { id: 'feedback', labelKey: 'tab.feedback', icon: '💬' },
    ],
  },
  {
    // Reliability: the detect→respond loop under ONE destination — active Monitoring
    // (diagram boards + monitor pins; a breach opens an incident) folded together with
    // Incident Management (war rooms + on-call + escalation + contacts). Sub-views are
    // ?tab= pills on the /incidents page; the retired /monitoring route redirects into
    // ?tab=monitors so old deep links still resolve (kept in `match` for highlighting).
    id: 'reliability', labelKey: 'group.reliability', icon: '🚨', href: '/incidents',
    seat: 'CTO', stage: 'make', rung: RUNG.WORKSPACE,
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
    seat: 'Support', stage: 'make', rung: RUNG.WORKSPACE,
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
  // ── MARKET ───────────────────────────────────────────────────────────────
  // The second front door. Canvas is "I have an idea"; the marketplace is "I
  // have a business" — and both end in a company you run. Public, so rung 0.
  // Agents are a FAMILY inside it, never a destination of their own (§11.5).
  { id: 'marketplace', labelKey: 'group.marketplace', icon: '🛒', href: '/marketplace', match: ['/marketplace', '/talent'], seat: 'platform', stage: 'market', rung: RUNG.PUBLIC },
  // The SUPPLY side of that same door (PRD 24). `/marketplace` is where you buy
  // what the platform and its sellers made; `/developers` is where a vendor
  // becomes one of those sellers, and where an admin sees what this workspace has
  // installed. A separate destination rather than a marketplace tab because its
  // audience is a company that may not be a customer at all — which is the whole
  // premise of a publisher being distinct from a tenant.
  { id: 'developers', labelKey: 'group.developers', icon: '🧩', href: '/developers', match: ['/developers'], seat: 'platform', stage: 'market', rung: RUNG.SIGNED_IN },
  // ── ADMIN ────────────────────────────────────────────────────────────────
  {
    id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings',
    seat: 'platform', stage: 'admin', rung: RUNG.SIGNED_IN,
    match: ['/settings', '/security', '/billing', '/tenants'],
    tabKind: 'route',
    tabs: [
      { id: '/settings', labelKey: 'tab.settings', icon: '⚙', activePaths: [] },
      // The insight LENS (CEO/CFO/CTO/CISO/PMO/EM) — which role's view of the
      // dashboards you get. Named "Viewpoint" so it is not read as Settings'
      // "Personality", which is the user's psychometric profile (PRD 21 §7).
      { id: '/settings/viewpoint', labelKey: 'tab.viewpoint', icon: '🎯' },
      { id: '/security', labelKey: 'tab.security', icon: '🔒' },
      { id: '/settings/integrations', labelKey: 'tab.integrations', icon: '🔌' },
      // `/billing`, NOT `/pricing`. A signed-in customer clicking "Billing" is
      // asking what they are on and where their money goes — `/pricing` is the
      // marketing comparison for somebody deciding whether to buy, and it answers
      // none of those questions. The console links OUT to it.
      { id: '/billing', labelKey: 'tab.billing', icon: '💳', activePaths: ['/billing'] },
      { id: '/tenants', labelKey: 'tab.tenant', icon: '🏢' },
    ],
  },
  {
    // Platform Admin: superadmin-only. The 19 capabilities are consolidated into
    // 10 top-level GROUPS (ADMIN_GROUP_META — the single source of truth, shared
    // with the admin page). Each group is an entry in the shared <ShellIndex>
    // (query kind, ?tab=…); a group's sub-views are an inner <DestinationIndex>
    // (?sub=…) on the page. The default group (Overview) uses id '' so a bare
    // /admin highlights it.
    id: 'admin', labelKey: 'group.admin', icon: '⚙', href: '/admin', match: ['/admin'], superadminOnly: true,
    seat: 'platform', stage: 'admin', rung: RUNG.WORKSPACE,
    tabKind: 'query', basePath: '/admin',
    tabs: ADMIN_GROUP_META.map((g) => ({ id: g.id, labelKey: g.labelKey, icon: g.icon })),
  },
  // ── EXPAND ───────────────────────────────────────────────────────────────
  // The platform owner's view of the sales programme. `/admin/sales`, NOT
  // `/sales`: `/sales` is the ASSOCIATE's hub and a superadmin opening it would
  // be reading a hub with no referral link of their own in it. Same reports,
  // aggregated across every associate, filterable to one.
  {
    id: 'sales-admin', labelKey: 'group.salesProgramme', icon: '📈', href: '/admin/sales',
    match: ['/admin/sales'], superadminOnly: true, seat: 'CRO', stage: 'expand', rung: RUNG.WORKSPACE,
  },
];

/**
 * The public surface lives in `publicDestinations.ts` — the seam this file was
 * split along (the rail is where a SIGNED-IN person goes; that is which pages a
 * SIGNED-OUT one can reach). Import it FROM THERE.
 *
 * This file used to re-export it (`export * from './publicDestinations'`) so no
 * call site had to move, and that convenience closed a loop: the public half is
 * a PROJECTION over `NAV_GROUPS`, so it imports this file, and re-exporting it
 * back made the two mutually dependent. Nothing read across the loop at
 * module-evaluation time, so it never fired — but it is the same shape as the
 * one that took the whole site down from `aiInsightPanels`, and the six call
 * sites it was protecting were a one-line change each.
 *
 * A projection depends on its source. Never the reverse.
 */

/**
 * The mobile bottom bar — five high-traffic destinations per audience.
 *
 * A curated SUBSET, and it lives in the registry for the same reason everything
 * else does: it was a fifth list of hrefs and labels, and the ratchet found it.
 * `icon` is an id rather than a node so this file stays free of JSX; the one
 * non-emoji id (`mascot`) is resolved by the component that renders it.
 */
export interface BottomNavItem {
  href: string;
  /** i18n key under `nav`. */
  labelKey: string;
  icon: string;
  exactMatch?: boolean;
  /** Priority CTA treatment (e.g. Sign In when logged out). */
  accent?: boolean;
}

export const MASCOT_ICON = 'mascot';

export function bottomNavFor(
  isAuthenticated: boolean,
  isSuperadmin: boolean,
  isFreelancer = false,
  isSales = false,
): BottomNavItem[] {
  if (!isAuthenticated) {
    return [
      { href: '/', labelKey: 'tab.home', icon: '🏠', exactMatch: true },
      { href: '/features', labelKey: 'bottom.product', icon: '✨' },
      { href: '/marketplace', labelKey: 'group.marketplace', icon: MASCOT_ICON },
      { href: '/pricing', labelKey: 'bottom.pricing', icon: '💳' },
      { href: '/login', labelKey: 'bottom.signIn', icon: '🔑', accent: true },
    ];
  }
  // Shared final slot: superadmins manage the platform (Admin), everyone else
  // manages their own account (Settings). One definition, used by every bar.
  const accountSlot: BottomNavItem = isSuperadmin
    ? { href: '/admin', labelKey: 'group.admin', icon: '⚙' }
    : { href: '/settings', labelKey: 'group.settings', icon: '⚙', exactMatch: true };

  if (isFreelancer) {
    return [
      { href: '/freelancer/dashboard', labelKey: 'tab.home', icon: '🏠' },
      { href: '/freelancer/profile', labelKey: 'group.myProfile', icon: '👤' },
      { href: '/marketplace', labelKey: 'group.marketplace', icon: MASCOT_ICON },
      { href: '/freelancer/timecard', labelKey: 'group.timecard', icon: '⏱' },
      accountSlot,
    ];
  }
  if (isSales) {
    return [
      { href: '/sales', labelKey: 'group.sales', icon: '📈' },
      { href: '/media', labelKey: 'group.library', icon: '🗂' },
      accountSlot,
    ];
  }
  // Builder: the canvas leads, because the canvas is the front door — the bar's
  // first slot used to be `/dashboard`, which is the destination §6.8 exists to
  // stop landing people on.
  return [
    { href: '/create', labelKey: 'group.create', icon: '✦' },
    { href: '/projects', labelKey: 'group.projects', icon: '📁' },
    { href: '/workforce', labelKey: 'tab.workforce', icon: MASCOT_ICON },
    { href: '/insights', labelKey: 'group.insights', icon: '📈' },
    accountSlot,
  ];
}

/** The registry's rows for one stage, in declaration order. */
export function groupsForStage(groups: readonly NavGroup[], stage: Stage): NavGroup[] {
  return groups.filter((group) => group.stage === stage);
}

/**
 * The rung this visitor has reached (§11.4.4). ONE helper, so the left panel,
 * the roster and any preview state cannot each invent their own idea of what is
 * earned — and so the fourth rung has exactly one place to land when the company
 * graph arrives.
 */
export function earnedRung(isAuthenticated: boolean, hasWorkspace: boolean): Rung {
  if (!isAuthenticated) return RUNG.PUBLIC;
  return hasWorkspace ? RUNG.WORKSPACE : RUNG.SIGNED_IN;
}

/**
 * The RESTRICTED navigation for a freelancer / gig account (users.account_type =
 * 'freelancer'). A for-hire worker never sees Canvas, Brain, projects, insights,
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
  { id: 'freelancer-dashboard', labelKey: 'group.myDashboard', icon: '🏠', href: '/freelancer/dashboard', match: ['/freelancer/dashboard'], seat: 'platform', stage: 'make', rung: RUNG.SIGNED_IN },
  { id: 'freelancer-profile', labelKey: 'group.myProfile', icon: '👤', href: '/freelancer/profile', match: ['/freelancer/profile'], seat: 'platform', stage: 'make', rung: RUNG.SIGNED_IN },
  { id: 'freelancer-gigs', labelKey: 'group.findWork', icon: '🔎', href: '/marketplace?family=talent&kind=gig', match: ['/marketplace', '/freelancer/gigs'], seat: 'platform', stage: 'market', rung: RUNG.SIGNED_IN },
  { id: 'freelancer-workspace', labelKey: 'group.myWorkspace', icon: '🛠', href: '/freelancer/workspace', match: ['/freelancer/workspace'], seat: 'platform', stage: 'make', rung: RUNG.SIGNED_IN },
  { id: 'freelancer-timecard', labelKey: 'group.timecard', icon: '⏱', href: '/freelancer/timecard', match: ['/freelancer/timecard'], seat: 'platform', stage: 'make', rung: RUNG.SIGNED_IN },
];

export const FREELANCER_NAV_GROUPS: NavGroup[] = [
  ...FOR_HIRE_NAV_GROUPS,
  {
    // A gig account's personal settings live on /settings (Account / Personality /
    // Sessions sub-tabs) — the same place a builder manages their own account. The
    // Workspace sub-tab self-hides without a tenant, and the tenant-only sub-routes
    // (integrations / api-keys) are never linked here.
    id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings',
    seat: 'platform', stage: 'admin', rung: RUNG.SIGNED_IN,
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

/** Focused navigation for referral and sales-associate accounts. */
export const SALES_NAV_GROUPS: NavGroup[] = [
  // EXPAND, not RUN — selling Builderforce is growing the business, not running
  // day-to-day operations, and RUN is where the operational rows live.
  { id: 'sales', labelKey: 'group.sales', icon: '📈', href: '/sales', match: ['/sales'], seat: 'CRO', stage: 'expand', rung: RUNG.SIGNED_IN },
  { id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings', match: ['/settings'], seat: 'platform', stage: 'admin', rung: RUNG.SIGNED_IN },
];

/** The nav destinations for the current account type — the ONE place the
 *  freelancer-vs-builder nav split is decided, so the Sidebar + ShellIndex and
 *  the route guard never drift. A dedicated freelancer gets the restricted shell; a
 *  builder who opted in to being hired (`availableForHire`) keeps the full builder
 *  nav PLUS the for-hire worker destinations. */
export function navGroupsForAccountType(isFreelancer: boolean, availableForHire = false, isSales = false): NavGroup[] {
  if (isSales) return SALES_NAV_GROUPS;
  if (isFreelancer) return FREELANCER_NAV_GROUPS;
  return availableForHire ? [...NAV_GROUPS, ...FOR_HIRE_NAV_GROUPS] : NAV_GROUPS;
}

export function isSalesAllowedPath(pathname: string): boolean {
  return pathname === '/sales' || pathname.startsWith('/sales/')
    || pathname === '/create' || pathname.startsWith('/create/')
    || pathname === '/settings' || pathname.startsWith('/settings/')
    // An associate is paid through this product, so the payout console and the
    // connected mailbox their hub embeds have to be reachable — bouncing them
    // back to `/sales` was why "connect your bank account" had nowhere to land.
    || pathname === '/billing' || pathname.startsWith('/billing/')
    || pathname === '/inbox' || pathname === '/media'
    || pathname === '/security';
}

/** Whether a freelancer account may view this in-app path (else redirect). */
export function isFreelancerAllowedPath(pathname: string): boolean {
  if (FREELANCER_ALLOWED_EXACT.includes(pathname)) return true;
  return FREELANCER_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Longest-prefix match so /create/build resolves to Canvas, /settings/api-keys to
 * Settings, etc.
 *
 * `groups` defaults to the BUILDER registry, which is the right answer for a
 * question about the product's own routes (which public page carries in-app
 * tabs). It is a parameter because it is NOT the right answer for a question
 * about a VISITOR — a sales associate navigates `SALES_NAV_GROUPS` and a
 * freelancer `FREELANCER_NAV_GROUPS`, so resolving their route against the
 * builder registry returns nothing and every consumer of "which destination am I
 * on" degrades: the rail loses its highlight, the shell panel opens with the
 * generic "Panel" title, and the index column disappears. Callers that know the
 * account pass its groups (see `useNavGroups`).
 */
export function findActiveGroup(pathname: string, groups: readonly NavGroup[] = NAV_GROUPS): NavGroup | undefined {
  let best: NavGroup | undefined;
  let bestLen = -1;
  for (const g of groups) {
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
