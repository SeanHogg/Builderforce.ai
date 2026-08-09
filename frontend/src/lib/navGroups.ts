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
 */
export const STAGES = ['idea', 'make', 'run', 'measure', 'market', 'admin'] as const;
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

/**
 * A PUBLIC destination — a place a signed-out visitor can go (PRD 21 §11.4.5).
 *
 * One array for the whole public surface, because the alternative is what was
 * actually here: `REFERENCE_DESTINATIONS` for the Product menu, `content.ts`'s
 * `RESOURCE_NAV_LINKS` for the Learn menu and `FOOTER_COLUMNS` for the footer —
 * three lists, so the storefront was "Talent / Workforce" in the bar, "Workforce
 * Registry" in the footer and "Marketplace" in the app, and the footer still
 * advertised an `/agents` destination the product had stopped having.
 *
 * Two facts place a row, exactly as they do for an app destination above:
 *
 *  - `placement` — which column it renders in. `idea` / `make` / `run` are the
 *    Product ▾ menu (the same arc as the left panel, so the public menu and the
 *    signed-in rail teach one vocabulary); `read` / `prove` / `buildWith` are
 *    Learn ▾; `bar` is a flat top-level link; `account` is footer-only.
 *  - `seat` — the owner, which tints the row in its seat's hue everywhere.
 *
 * `panel` is the §11.4.5 property: signed out the row is an ordinary page with
 * an ordinary URL and ordinary SEO; signed in the SAME route mounts inside
 * `ShellPanel` over a board that stays mounted. It is declared per row rather
 * than assumed, because `/blog` genuinely wants the whole screen and `/soc2`
 * genuinely does not.
 */
export const PRODUCT_COLUMNS = ['idea', 'make', 'run'] as const;
export const LEARN_COLUMNS = ['read', 'prove', 'buildWith'] as const;
export type MenuColumn = (typeof PRODUCT_COLUMNS)[number] | (typeof LEARN_COLUMNS)[number];
/** `bar` = a flat header link; `account` = footer only (sign in, demo, media). */
export type Placement = MenuColumn | 'bar' | 'account';

/** A named section INSIDE a reference page, offered as the panel's index rail. */
export interface ReferenceSection {
  /** The page's own anchor id. */
  id: string;
  /** i18n key under `referencePanel.section`. */
  labelKey: string;
}

export interface PublicDestination {
  id: string;
  /**
   * Marketing copy key under `burnrateMarketing.domains.<copyId>`. Absent for a
   * row whose copy lives under `marketingNav.dest.<id>` — see `destTitleKey`.
   */
  copyId?: string;
  seat: SeatOrPlatform;
  icon: string;
  /** The public URL. Unique across the registry; also the panel route. */
  marketingHref: string;
  /** The in-app destination this explainer is about. */
  appHref: string;
  /** A domain sells to a buyer; a foundation is substrate every domain needs;
   *  a link is neither — a page the public menus and footer point at. */
  kind: 'domain' | 'foundation' | 'link';
  placement: Placement;
  /** Signed in, this route opens as a panel over the board instead of replacing it. */
  panel: boolean;
  /** The panel's index rail, when the page declares matching anchor ids. */
  sections?: ReferenceSection[];
}

/** Kept as an alias: a reference destination is a public one that explains a domain. */
export type ReferenceDestination = PublicDestination;

export const NAV_GROUPS: NavGroup[] = [
  // ── IDEA ─────────────────────────────────────────────────────────────────
  // Every creation mode lives in Canvas. Middleware redirects legacy entry URLs.
  { id: 'create', labelKey: 'group.create', icon: '✦', href: '/create', match: ['/create', '/brainstorm', '/workflows'], seat: 'Brain', stage: 'idea', rung: RUNG.PUBLIC },
  // Its own destination rather than a tab of Create: this is the front door for
  // "paste a brief, get a working system", which starts from a piece of text
  // rather than from a canvas, and ends in a project the other destinations then
  // operate on.
  { id: 'challenges', labelKey: 'group.challenges', icon: '🎯', href: '/challenges', match: ['/challenges'], seat: 'Brain', stage: 'idea', rung: RUNG.PUBLIC },
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
  // ── ADMIN ────────────────────────────────────────────────────────────────
  {
    id: 'settings', labelKey: 'group.settings', icon: '⚙', href: '/settings',
    seat: 'platform', stage: 'admin', rung: RUNG.SIGNED_IN,
    match: ['/settings', '/security', '/pricing', '/tenants'],
    tabKind: 'route',
    tabs: [
      { id: '/settings', labelKey: 'tab.settings', icon: '⚙', activePaths: [] },
      // The insight LENS (CEO/CFO/CTO/CISO/PMO/EM) — which role's view of the
      // dashboards you get. Named "Viewpoint" so it is not read as Settings'
      // "Personality", which is the user's psychometric profile (PRD 21 §7).
      { id: '/settings/viewpoint', labelKey: 'tab.viewpoint', icon: '🎯' },
      { id: '/security', labelKey: 'tab.security', icon: '🔒' },
      { id: '/settings/integrations', labelKey: 'tab.integrations', icon: '🔌' },
      { id: '/pricing', labelKey: 'tab.billing', icon: '💳' },
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
  { id: 'sales-admin', labelKey: 'group.sales', icon: '📈', href: '/sales', match: ['/sales'], superadminOnly: true, seat: 'CRO', stage: 'admin', rung: RUNG.WORKSPACE },
];

/**
 * The public explainer surfaces (§11.4.5) — the twelve rows that used to live in
 * `burnrateCatalog.ts` as a SECOND navigation list, plus the two standalone
 * reference pages.
 *
 * They are not left-panel rows. The marketing header's Product ▾ / Learn ▾ menus
 * and `/features` render them; signed in, opening one mounts it as a panel over
 * the board. `appHref` is where the explainer hands you when you are convinced —
 * and it deliberately points at a row above, so a marketing page can never
 * advertise a destination the product does not have.
 */
export const PUBLIC_DESTINATIONS: PublicDestination[] = [
  // ── Product ▾ · IDEA ─────────────────────────────────────────────────────
  // The canvas is the first row of the public menu for the same reason it is the
  // first row of the rail: it IS the product. `/create/new` is a guest app route
  // (`GUEST_APP_PATTERNS`), so this link opens a real, editable, local-first
  // board — which is why it is not a `panel` row. There is nothing to open it
  // over; it is the thing everything else opens over.
  { id: 'canvas', seat: 'Brain', icon: '✦', marketingHref: '/create/new', appHref: '/create', kind: 'link', placement: 'idea', panel: false },
  { id: 'ref.aiCoach', copyId: 'aiCoach', seat: 'Brain', icon: '✨', marketingHref: '/features/ai-coach', appHref: '/create', kind: 'foundation', placement: 'idea', panel: true },
  // ── Product ▾ · MAKE ─────────────────────────────────────────────────────
  { id: 'ref.productManagement', copyId: 'productManagement', seat: 'CPO', icon: '📦', marketingHref: '/product-management', appHref: '/projects?tab=pm', kind: 'domain', placement: 'make', panel: true },
  { id: 'ref.agileSurvival', copyId: 'agileSurvival', seat: 'CTO', icon: '⚡', marketingHref: '/survival-focused-agile', appHref: '/projects?tab=ceremonies', kind: 'domain', placement: 'make', panel: true },
  // ── Product ▾ · RUN — one row per business seat ──────────────────────────
  { id: 'ref.businessIntelligence', copyId: 'businessIntelligence', seat: 'CFO', icon: '📊', marketingHref: '/business-intelligence', appHref: '/seat/finance', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.salesRevenue', copyId: 'salesRevenue', seat: 'CRO', icon: '📈', marketingHref: '/sales-revenue', appHref: '/seat/revenue', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.marketingGrowth', copyId: 'marketingGrowth', seat: 'CMO', icon: '📣', marketingHref: '/marketing-growth', appHref: '/growth', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.operationalCadence', copyId: 'operationalCadence', seat: 'HR', icon: '🎯', marketingHref: '/operational-cadence', appHref: '/seat/people', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.investorIntelligence', copyId: 'investorIntelligence', seat: 'CEO', icon: '💼', marketingHref: '/investor-intelligence', appHref: '/seat/investor', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.governanceSecurity', copyId: 'governanceSecurity', seat: 'Security', icon: '🛡', marketingHref: '/governance-security', appHref: '/seat/governance', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.customerEngagement', copyId: 'customerEngagement', seat: 'Support', icon: '💬', marketingHref: '/customer-engagement', appHref: '/seat/support', kind: 'domain', placement: 'run', panel: true },
  { id: 'ref.companiesContacts', copyId: 'companiesContacts', seat: 'CMO', icon: '🏢', marketingHref: '/companies-contacts', appHref: '/seat/revenue', kind: 'foundation', placement: 'run', panel: true },
  // ── Learn ▾ · READ — long-form, and deliberately NOT panels: an article
  //    wants the whole screen, and nobody reads a tutorial over their own board.
  { id: 'blog', seat: 'CMO', icon: '📝', marketingHref: '/blog', appHref: '/blog', kind: 'link', placement: 'read', panel: false },
  { id: 'tutorials', seat: 'Support', icon: '🎓', marketingHref: '/tutorials', appHref: '/tutorials', kind: 'link', placement: 'read', panel: false },
  { id: 'compare', seat: 'CMO', icon: '⚖️', marketingHref: '/compare', appHref: '/compare', kind: 'link', placement: 'read', panel: false },
  // ── Learn ▾ · PROVE — evidence surfaces. These ARE panels: "can I show my
  //    auditor the controls" is a question you ask mid-turn, not instead of one.
  { id: 'diagnostics', seat: 'Manager', icon: '🩺', marketingHref: '/tools', appHref: '/insights/compliance', kind: 'link', placement: 'prove', panel: true },
  {
    id: 'soc2', seat: 'Security', icon: '🛡', marketingHref: '/soc2', appHref: '/seat/governance',
    kind: 'link', placement: 'prove', panel: true,
    // The page's own `<section id>`s, offered as the panel's index rail. Declared
    // beside the destination rather than inside the page so the rail cannot list
    // a section the page stopped having — `check-destinations` asserts the ids.
    sections: [
      { id: 'report', labelKey: 'report' },
      { id: 'criteria', labelKey: 'criteria' },
      { id: 'how', labelKey: 'how' },
      { id: 'audits', labelKey: 'audits' },
      { id: 'faq', labelKey: 'faq' },
    ],
  },
  { id: 'evermind', seat: 'Brain', icon: '🧠', marketingHref: '/evermind', appHref: '/create', kind: 'link', placement: 'prove', panel: true },
  // ── Learn ▾ · BUILD WITH ─────────────────────────────────────────────────
  { id: 'ref.integrations', copyId: 'integrations', seat: 'CTO', icon: '🔌', marketingHref: '/integrations', appHref: '/settings/integrations', kind: 'foundation', placement: 'buildWith', panel: true },
  // `/models` and `/prompts` are not panels: signed in they are already app
  // surfaces (Marketplace's asset family and Knowledge's Prompts tab), and a
  // route cannot be both a panel over the board and a destination in it.
  { id: 'models', seat: 'CTO', icon: '🧮', marketingHref: '/models', appHref: '/marketplace?family=asset&kind=model', kind: 'link', placement: 'buildWith', panel: false },
  { id: 'prompts', seat: 'Support', icon: '📚', marketingHref: '/prompts', appHref: '/prompts', kind: 'link', placement: 'buildWith', panel: false },
  // ── The flat bar ─────────────────────────────────────────────────────────
  { id: 'features', seat: 'platform', icon: '✨', marketingHref: '/features', appHref: '/create', kind: 'link', placement: 'bar', panel: true },
  // Talent, agents, models and assets are FAMILIES of the one storefront, not
  // four destinations — so one entry, and the families filter inside it. It is
  // "Marketplace" here, in the footer and in the rail: one place, one name.
  { id: 'marketplace', seat: 'platform', icon: '🛒', marketingHref: '/marketplace', appHref: '/marketplace', kind: 'link', placement: 'bar', panel: false },
  { id: 'pricing', seat: 'CFO', icon: '💳', marketingHref: '/pricing', appHref: '/pricing', kind: 'link', placement: 'bar', panel: false },
  { id: 'about', seat: 'CEO', icon: '🏛', marketingHref: '/about', appHref: '/about', kind: 'link', placement: 'bar', panel: false },
  // ── Footer only ──────────────────────────────────────────────────────────
  { id: 'demo', seat: 'CRO', icon: '▶', marketingHref: '/demo', appHref: '/create', kind: 'link', placement: 'account', panel: false },
  { id: 'sell', seat: 'CRO', icon: '🤝', marketingHref: '/sell-builderforce', appHref: '/sales', kind: 'link', placement: 'account', panel: false },
  { id: 'media', seat: 'CMO', icon: '🗂', marketingHref: '/media', appHref: '/media', kind: 'link', placement: 'account', panel: false },
  { id: 'signIn', seat: 'platform', icon: '🔑', marketingHref: '/login', appHref: '/create', kind: 'link', placement: 'account', panel: false },
];

/**
 * The explainer subset — the rows `/features` indexes. A `link` row is a public
 * page but not a story about a business domain, so it belongs in the menus and
 * the footer and not in the features index.
 */
export type ExplainerDestination = PublicDestination & { copyId: string };

export const REFERENCE_DESTINATIONS = PUBLIC_DESTINATIONS.filter(
  (entry): entry is ExplainerDestination => entry.kind !== 'link',
);
export const REFERENCE_DOMAINS = REFERENCE_DESTINATIONS.filter((entry) => entry.kind === 'domain');
export const REFERENCE_FOUNDATIONS = REFERENCE_DESTINATIONS.filter((entry) => entry.kind === 'foundation');

/** Public rows that mount as a panel over the board once you are signed in. */
export const PANEL_SURFACES = PUBLIC_DESTINATIONS.filter((entry) => entry.panel).map((entry) => entry.marketingHref);

export function publicById(id: string): PublicDestination | undefined {
  return PUBLIC_DESTINATIONS.find((entry) => entry.id === id);
}

/**
 * An EXPLAINER by its public href. Deliberately narrower than
 * `publicDestinationFor`: the domain-page route feeds the result straight into
 * `burnrateMarketing.domains.<copyId>`, so returning `/blog` here would render a
 * page of `domains.undefined`.
 */
export function referenceByHref(href: string): ExplainerDestination | undefined {
  return REFERENCE_DESTINATIONS.find((entry) => entry.marketingHref === href);
}

export function referenceBySlug(slug: string): ExplainerDestination | undefined {
  return referenceByHref(`/${slug}`);
}

/** The row a pathname belongs to, longest public href first (`/features/ai-coach`
 *  must beat `/features`). */
export function publicDestinationFor(pathname: string): PublicDestination | undefined {
  let best: PublicDestination | undefined;
  for (const entry of PUBLIC_DESTINATIONS) {
    const href = entry.marketingHref;
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (!best || href.length > best.marketingHref.length) best = entry;
  }
  return best;
}

/** The rows of one menu column, in declaration order. */
export function columnOf(column: Placement): PublicDestination[] {
  return PUBLIC_DESTINATIONS.filter((entry) => entry.placement === column);
}

/**
 * Where a row's title and one-line tagline live.
 *
 * Two homes rather than one because the nine domain explainers already own
 * translated copy under `burnrateMarketing.domains.*` in all five catalogs, and
 * re-keying it would have been a rename dressed up as a refactor. A row without
 * a `copyId` keys its own copy under `marketingNav.dest.<id>`.
 */
export function destTitleKey(entry: PublicDestination): string {
  return entry.copyId ? `burnrateMarketing.domains.${entry.copyId}.title` : `marketingNav.dest.${entry.id}.title`;
}

export function destTaglineKey(entry: PublicDestination): string {
  return entry.copyId ? `burnrateMarketing.domains.${entry.copyId}.tagline` : `marketingNav.dest.${entry.id}.tagline`;
}

/**
 * The site footer, as four projections of the array above (§11.4.7).
 *
 * Ids rather than rows so the ORDER a reader sees is editable without a second
 * declaration of the destination itself. The previous footer was that second
 * declaration: it called the storefront "Workforce Registry" and still offered
 * an `/agents` destination that had been folded into it.
 */
export interface FooterColumn {
  /** i18n key under `footer`. */
  titleKey: string;
  ids: string[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  { titleKey: 'colProduct', ids: ['canvas', 'marketplace', 'features', 'pricing', 'about'] },
  { titleKey: 'colPlatform', ids: ['evermind', 'ref.integrations', 'models', 'prompts'] },
  { titleKey: 'colLearn', ids: ['blog', 'tutorials', 'compare', 'diagnostics', 'soc2', 'media'] },
  { titleKey: 'colGetStarted', ids: ['demo', 'sell', 'signIn'] },
];

/** The footer's columns resolved to rows — unknown ids are a build-time failure
 *  in `check-destinations`, so this can drop them without hiding a typo. */
export const footerColumns = (): { titleKey: string; links: PublicDestination[] }[] =>
  FOOTER_COLUMNS.map((column) => ({
    titleKey: column.titleKey,
    links: column.ids.map(publicById).filter((entry): entry is PublicDestination => Boolean(entry)),
  }));

/**
 * The PUBLIC bar — the marketing header's flat links (§11.4.6).
 *
 * A projection of `PUBLIC_DESTINATIONS`, not a list: it was a list, living in
 * the header component as `FLAT_LINKS`, and that is how the storefront ended up
 * with three names. There is no `Home` row either — the logo is home, and a
 * separate entry was the second way to do the one thing every logo does.
 */
export const PUBLIC_NAV = columnOf('bar');

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
  { id: 'sales', labelKey: 'group.sales', icon: '📈', href: '/sales', match: ['/sales'], seat: 'CRO', stage: 'run', rung: RUNG.SIGNED_IN },
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
  return pathname === '/sales' || pathname.startsWith('/sales/') || pathname === '/create' || pathname.startsWith('/create/') || pathname === '/settings' || pathname === '/security';
}

/** Whether a freelancer account may view this in-app path (else redirect). */
export function isFreelancerAllowedPath(pathname: string): boolean {
  if (FREELANCER_ALLOWED_EXACT.includes(pathname)) return true;
  return FREELANCER_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Longest-prefix match so /create/build resolves to Canvas, /settings/api-keys to Settings, etc. */
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
