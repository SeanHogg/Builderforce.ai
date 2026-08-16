import { PRODUCT_SECTIONS, PROJECTS_TASKS_FAQ, type FaqItem } from './content';
import { FOR_HIRE_NAV_GROUPS, NAV_GROUPS, SALES_NAV_GROUPS, findActiveGroup, type NavGroup } from './navGroups';
import { classifyShell } from './shellRouting';

/**
 * Marketing copy shown to logged-out visitors who land on an authenticated
 * route — so a deep link to /dashboard, /create, /brainstorm, etc. renders a rich
 * feature page (hero + how-it-works + FAQ + related articles + JSON-LD) instead
 * of a blank gate, redirect, or one-line teaser.
 *
 * The base hero (icon/title/description) is derived from PRODUCT_SECTIONS
 * (single source of truth for the product surfaces); `extra` covers authed
 * routes that aren't a marketed surface. The per-route `DETAILS` overlay adds
 * the marketing body, FAQ, SEO description, and the RELATED_ARTICLES surface key
 * used to attach associated blog content. Lookup is longest-prefix so /create/123
 * and /settings/members resolve.
 *
 * ── THE THREE TIERS ─────────────────────────────────────────────────────────
 * There are 86 authenticated routes and this file hand-writes copy for 25 of
 * them, so "what does the OTHER route show" is the question that decides what a
 * visitor actually meets. It used to be one generic sentence — "This is part of
 * Builderforce.ai" — served identically at /inbox, /insights, /incidents and
 * every seat, which is the closest thing to a 404 a working page can be.
 *
 *   1. REGISTRY   — a hand-authored surface (below). Full hero, highlights, FAQ.
 *   2. DESTINATION — no entry here, but the route belongs to a NAV_GROUPS row.
 *                    The hero is the destination's own localized name, icon and
 *                    one-line pitch, and the "what's inside" band is its tabs.
 *                    Nothing is retyped: `nav.group.*` already names every row
 *                    in five languages, so a new destination is a marketing page
 *                    the day it is a menu row, in every locale, or it fails the
 *                    catalog ratchet in `routeMarketing.test.ts`.
 *   3. GENERIC    — neither. The method itself (Read → Prove → Build) rather
 *                  than a lock icon, and `noindex`, because a page with the same
 *                  body at forty URLs is duplicate content by definition.
 *
 * Tiers 2 and 3 carry no English in this file — their copy is i18n keys resolved
 * by `<RouteMarketing>`, which is what lets them exist at all: 28 destinations ×
 * five locales is a catalog entry each, not 28 hand-written pages.
 */
export interface RouteHighlight {
  title: string;
  desc: string;
}

/** A ground-visual figure (SVG in /public) rendered on the marketing teaser to
 *  make the case visually. The shared RouteMarketing component self-gates on
 *  presence, so adding figures to a route is a one-line data edit. */
export interface RouteFigure {
  src: string;
  alt: string;
  caption: string;
}

export interface RouteMarketing {
  icon: string;
  title: string;
  description: string;
  /** "How it works" / benefit points rendered under the hero. */
  highlights?: RouteHighlight[];
  /** Ground-visual figures rendered under the highlights to make the case. */
  figures?: RouteFigure[];
  /** FAQ rendered on the teaser AND emitted as FAQPage JSON-LD for SEO/GEO. */
  faq?: FaqItem[];
  /** RELATED_ARTICLES surface key → associated blog posts shown on the teaser. */
  relatedSurface?: string;
  /** Longer description used for the document title's meta + JSON-LD app entity. */
  seoDescription?: string;
}

/**
 * The marketed surfaces, keyed by PATH.
 *
 * Two corrections over the naive `fromSurfaces[s.href] = …`, both of which were
 * silently wrong. A surface's `href` is a LINK, so it may carry a query
 * (`/projects?tab=portfolio`) or point off-site (the VS Code extension) — and a
 * key with a `?` in it can never equal a pathname, so those rows registered
 * nothing while the extension row registered a marketplace.visualstudio.com key.
 * Stripping the query makes them match, and FIRST-WINS keeps the destination's
 * own row: four surfaces link into `/projects`, and last-wins had `/projects`
 * titled "Workforce Kanban & Templates".
 */
const fromSurfaces: Record<string, RouteMarketing> = {};
for (const section of PRODUCT_SECTIONS) {
  for (const s of section.surfaces) {
    if (!s.href.startsWith('/')) continue;
    const path = s.href.split('?')[0];
    if (fromSurfaces[path]) continue;
    fromSurfaces[path] = { icon: s.icon, title: s.title, description: s.desc };
  }
}

const extra: Record<string, RouteMarketing> = {
  // `/brainstorm` and `/training` carried a full DETAILS body (highlights, FAQ,
  // SEO copy) and no base, so the overlay landed on the generic default: a page
  // headed "This is part of Builderforce.ai" with three Brain Storm highlights
  // under it. A DETAILS key without a base row is now a test failure.
  '/brainstorm': { icon: '🧠', title: 'Brain Storm', description: 'Describe what you want to build in plain language and turn it into projects, tasks, datasets, and agent work.' },
  '/training': { icon: '🎓', title: 'Training', description: 'Generate a dataset, fine-tune a model, have an independent judge score it, then publish the result to your workforce.' },
  '/workflows': { icon: '🔀', title: 'Workflow Builder', description: 'Compose agents and tools into repeatable, approval-gated workflows.' },
  '/tasks': { icon: '▦', title: 'Tasks', description: 'A task board for your agent workforce — plan, prioritize, and assign tasks to agents, then watch them flow through every status.' },
  '/contributors': { icon: '📈', title: 'Contributors', description: 'Dev analytics and team intelligence — reconcile developer identity across tools, track activity and PR cycle time, and roll up engagement across your tenant.' },
  '/settings': { icon: '⚙', title: 'Settings', description: 'Manage your workspace, members, API keys, and preferences.' },
  '/tenants': { icon: '🏢', title: 'Workspaces', description: 'Create and switch between multi-tenant workspaces with per-seat roles.' },
  '/admin': { icon: '⚙', title: 'Platform Admin', description: 'Platform administration, LLM traces, and operator tooling.' },
  '/agent-worker': { icon: '🤖', title: 'Agent Worker', description: 'Run and monitor background agent workers executing your tasks.' },
};

/**
 * Per-route marketing body, FAQ, SEO copy, and related-article surface. This is
 * the content that turns a thin "sign in" gate into a real feature page for
 * logged-out visitors and crawlers. Keyed by route path (longest-prefix match).
 */
const DETAILS: Record<string, Omit<RouteMarketing, 'icon' | 'title' | 'description'>> = {
  '/brainstorm': {
    relatedSurface: 'brainstorm',
    seoDescription:
      'Brain Storm is a plain-language starting point inside Builderforce.ai: explore an idea, shape useful context, and turn it into connected canvas work, projects, tasks, datasets, or agent-assisted execution.',
    highlights: [
      { title: 'Describe it in plain language', desc: 'Say what you want to create, then develop the idea before deciding which artifacts, collaborators, or delivery structure it needs.' },
      { title: 'It calls real platform tools', desc: 'The Brain is wired to a tool registry: it can create projects, draft specs, generate datasets, and assign work to agents — not just chat about it.' },
      { title: 'Grounded in your workspace', desc: 'Pin a project and the Brain answers with that context, so ideation continues exactly where your work already lives.' },
    ],
    faq: [
      { question: 'What is Brain Storm on Builderforce.ai?', answer: 'Brain Storm is the full-page Brain assistant — a plain-language interface where you describe what you want to build and the Brain turns it into projects, tasks, datasets, and agent work. It is the same Brain available as a docked drawer everywhere in the app, given a full-page canvas.' },
      { question: 'Does the Brain actually do things, or just chat?', answer: 'It acts. The Brain is connected to a platform tool registry and your tenant\'s MCP extensions, so it can create projects, draft specs and PRDs, kick off dataset generation, and assign tasks to agents — every tool call governed by your approval gates.' },
      { question: 'Do I need to set anything up to start brainstorming?', answer: 'No. Sign in, open Brain Storm, and type. You can optionally pin a project so answers are grounded in that codebase and context, but a blank prompt is enough to start turning an idea into a plan.' },
    ],
  },
  '/training': {
    relatedSurface: 'training',
    seoDescription:
      'Use supported WebGPU LoRA fine-tuning on compatible devices, evaluate the result, and publish through the hosted workflow when required.',
    highlights: [
      { title: 'Fine-tune in the browser', desc: 'Supported WebGPU LoRA training runs on the local device. Hardware limits, remote evaluation, and publishing are disclosed separately.' },
      { title: 'Generate datasets in seconds', desc: 'Author an instruction-tuning dataset from a single capability prompt with streaming progress, then train on it without leaving the page.' },
      { title: 'Evaluate, then publish', desc: 'An independent AI judge scores correctness, reasoning, and hallucination rate. Publish the trained agent to the Workforce Registry and call it from inside your own agent.' },
    ],
    faq: [
      { question: 'How does in-browser training work without a GPU server?', answer: 'Supported training steps run on a compatible local device through WebGPU. Remote evaluation, collaboration, publishing, and connected services are separate operations with their own data boundaries.' },
      { question: 'What can I do with a trained agent?', answer: 'After the AI evaluation engine scores it, you publish the agent to the Workforce Registry with a profile, skills, and eval score. Then you hire it and call it from inside your own agent — your trained specialists become tools your main agent delegates to.' },
      { question: 'Do I need a dataset before I start?', answer: 'No. The dataset generation wizard creates an instruction-tuning dataset from a single capability prompt in under 30 seconds, which you can refine and then train on in the same workflow.' },
    ],
  },
  '/workflows': {
    relatedSurface: 'workflows',
    seoDescription:
      'The Builderforce.ai Workflow Builder is a drag-and-drop, IPAAS-style canvas for composing LLM logic — memory, knowledge-base, and training nodes — wired to your agents and run on your agentHosts with approval gates at every step.',
    highlights: [
      { title: 'Compose agents like a flowchart', desc: 'A drag-and-drop canvas wires agents, tools, memory, knowledge-base, and training nodes into repeatable, multi-step workflows.' },
      { title: 'Configurable approval gates', desc: 'Configured execution paths can pause for human sign-off. Policy resolution fails closed; audit coverage is stated for each instrumented path.' },
      { title: 'Built-in orchestration patterns', desc: 'Planning, feature-dev, bug-fix, refactor, and adversarial-review workflows coordinate seven specialist roles through a dependency DAG.' },
    ],
    faq: [
      { question: 'What is the Workflow Builder?', answer: 'It is a visual, IPAAS-style canvas for composing your own LLM logic. You drag and connect nodes — agents, tools, memory, knowledge-base, and training — into repeatable workflows that run on your agentHosts with approval gates wherever you choose.' },
      { question: 'How is this different from a single AI agent?', answer: 'A workflow coordinates multiple specialist agents across structured steps through a dependency DAG, instead of one agent producing a single suggestion. Built-in patterns run planning, bug-fix, refactor, and adversarial-review end to end.' },
      { question: 'Can I require human approval inside a workflow?', answer: 'Yes. Approval gates can suspend any step until a person approves or rejects it, with the decision recorded in the audit trail. Low-risk steps can pass automatically via auto-approval rules.' },
    ],
  },
  '/projects': {
    relatedSurface: 'projects',
    seoDescription:
      'Projects / Tasks is the work-management surface of Builderforce.ai — organize work into AI project workspaces, then plan, assign, and track tasks across your agent workforce with board, table, calendar, and Gantt views.',
    faq: PROJECTS_TASKS_FAQ,
  },
  '/tasks': {
    relatedSurface: 'projects',
    seoDescription:
      'The Tasks board is where your agent workforce gets work done on Builderforce.ai — plan, prioritize, and assign tasks to agents, then track them across board, table, calendar, and Gantt views with approval gates and full observability.',
    faq: PROJECTS_TASKS_FAQ,
  },
  '/workforce': {
    relatedSurface: 'workforce',
    seoDescription:
      'The Workforce mesh discovers and dispatches work across local and remote AgentHosts — capacity sharing across machines and tenants, with approvals, chats, and full telemetry in one place.',
    highlights: [
      { title: 'A mesh of agent hosts', desc: 'Discover and dispatch work across local and remote AgentHosts, sharing capacity across machines and tenants with HMAC-signed, Bearer-authenticated dispatch.' },
      { title: 'Approvals and chats together', desc: 'Approve human-in-the-loop actions, talk to agents directly, and watch them collaborate — all from the same Workforce surface.' },
      { title: 'Instrumented execution', desc: 'Supported task and workflow paths emit structured telemetry to the timeline, including available execution, usage, and tool-call records.' },
    ],
    faq: [
      { question: 'What is the Workforce mesh?', answer: 'The Workforce is where you discover and coordinate your agent hosts. It dispatches work across local and remote AgentHosts — capacity sharing across machines and even tenants — using HMAC-signed, Bearer-authenticated dispatch, with smart routing to the best-matched peer.' },
      { question: 'Can I see and approve what agents are doing?', answer: 'Yes. The Workforce surface brings together approval requests, agent conversations, and the execution telemetry captured by supported platform workflows.' },
      { question: 'Does it work across multiple machines?', answer: 'Yes. Fleet registration, heartbeats, and capability sync let you run a fleet of AgentHosts and route tasks across them, with remote dispatch to a specific host or auto-routing by capability.' },
    ],
  },
  '/skills': {
    relatedSurface: 'skills',
    seoDescription:
      'Install or publish reusable agent skills from the Builderforce.ai Workforce marketplace. Skills assigned at tenant or agentHost scope load automatically into running agents at startup — 53 built-in plus a growing marketplace.',
    highlights: [
      { title: 'A marketplace of capabilities', desc: 'Browse and install reusable agent skills, or publish your own. 53 skills ship built-in, with a growing community marketplace on top.' },
      { title: 'Assigned, then auto-loaded', desc: 'Assign a skill at tenant or agentHost scope and it loads automatically into running agents at startup — no manual wiring per agent.' },
      { title: 'Publish under clear terms', desc: 'Publish a skill under the seller terms shown at listing and checkout.' },
    ],
    faq: [
      { question: 'What are skills on Builderforce.ai?', answer: 'Skills are reusable capabilities you can give your agents. There are 53 built-in skills plus a marketplace where you browse, install, or publish more. A skill assigned at tenant or agentHost scope is loaded automatically into running agents at startup.' },
      { question: 'Can I publish my own skills?', answer: 'Yes. You can publish a skill to the Workforce marketplace; current fees and payout terms are shown before you list paid content.' },
      { question: 'How do skills get into a running agent?', answer: 'You assign skills at tenant or agentHost scope in the portal; the agent loads its assigned skills automatically when it starts, so capabilities follow your assignment rules without per-agent configuration.' },
    ],
  },
  '/personas': {
    relatedSurface: 'personas',
    seoDescription:
      'Personas give your agents a reusable voice and behavior profile on Builderforce.ai. Pro personas add a psychometric personality layer compiled into both prompt directives and execution parameters at run time.',
    highlights: [
      { title: 'Reusable voice and behavior', desc: 'Define a persona once — tone, behavior, and operating style — and apply it across agents so their output stays consistent.' },
      { title: 'Psychometric personality (Pro)', desc: 'Pro personas carry a trait vector compiled into both prompt directives and run-time execution parameters, for genuinely distinct agent behavior.' },
      { title: 'Shareable across the workforce', desc: 'Personas are reusable assets that travel with agents, so a behavior profile you craft once equips your whole workforce.' },
    ],
    faq: [
      { question: 'What is a persona on Builderforce.ai?', answer: 'A persona is a reusable voice and behavior profile you attach to agents, so their tone and operating style stay consistent across tasks and team members.' },
      { question: 'What does the Pro personality layer add?', answer: 'Pro personas include a psychometric profile — a trait vector compiled by the platform into both prompt directives and execution parameters (such as reasoning depth and temperature) at run time, giving each agent a genuinely distinct, controllable personality.' },
      { question: 'Can personas be reused across agents?', answer: 'Yes. Personas are reusable assets — define one and apply it to any number of agents across your workforce, instead of re-describing behavior every time.' },
    ],
  },
  '/content-manager': {
    relatedSurface: 'content-manager',
    seoDescription:
      'The Content Manager lets you author and share reusable content blocks your agents and the Workforce marketplace can reuse — a single source of truth for the copy and context your AI workforce draws on.',
    highlights: [
      { title: 'Author reusable content', desc: 'Create content blocks once and reuse them across agents, workflows, and the marketplace instead of duplicating copy.' },
      { title: 'Shared context for agents', desc: 'Content blocks become context your agents can draw on, keeping their output grounded in your canonical messaging and facts.' },
      { title: 'Marketplace-ready', desc: 'Share content your agents and the Workforce marketplace can reuse, so good context compounds across your workspace.' },
    ],
    faq: [
      { question: 'What is the Content Manager for?', answer: 'It is where you author and share reusable content blocks — copy and context that your agents and the Workforce marketplace can reuse — so your messaging and source material live in one canonical place.' },
      { question: 'How do agents use this content?', answer: 'Content blocks act as shared context agents can draw on, keeping their output consistent with your canonical facts and messaging rather than improvising each time.' },
    ],
  },
  '/security': {
    relatedSurface: 'security',
    seoDescription:
      'Builderforce.ai provides controls for agent-assisted work, including tenant isolation, encrypted integration credentials, role-based access, device trust, configurable approval gates, and retained execution records.',
    highlights: [
      { title: 'Keep people accountable', desc: 'Configure human approval gates for consequential actions and retain the resulting decisions as part of the execution record.' },
      { title: 'Scoped and encrypted', desc: 'Tenant-scoped access controls and AES-256-GCM encryption protect credentials stored for supported integrations.' },
      { title: 'RBAC and device trust', desc: 'Role-based access control, device trust, and HMAC-signed inter-host dispatch mean only the right people and machines can act.' },
    ],
    faq: [
      { question: 'How does Builderforce.ai govern what agents can do?', answer: 'Through human-in-the-loop approval gates: agents request approval before high-impact actions, execution suspends until a person approves or rejects, and every outcome is recorded in a full audit trail. Auto-approval rules let low-risk actions through automatically.' },
      { question: 'How are my credentials and data protected?', answer: 'Integration credentials are encrypted with AES-256-GCM and scoped per tenant. All resources — projects, datasets, models, and agents — are isolated per tenant with no cross-tenant access, and inter-host dispatch is HMAC-signed and Bearer-authenticated.' },
      { question: 'Can Builderforce.ai run air-gapped?', answer: 'The MIT-licensed BuilderForce Agents runtime can be deployed on private infrastructure and can use local models. A fully air-gapped environment requires disabling hosted collaboration, publishing, remote evaluation, and other connected services; validate the required workflow against the deployment guide before making a compliance commitment.' },
    ],
  },
  '/contributors': {
    relatedSurface: 'contributors',
    seoDescription:
      'Contributors brings dev analytics and team intelligence to Builderforce.ai — reconcile developer identity across GitHub, Jira, and Bitbucket, track activity and PR cycle time, and roll up engagement across your whole tenant.',
    highlights: [
      { title: 'One identity across tools', desc: 'Reconcile each developer\'s identity across GitHub, Jira, and Bitbucket, with reversible, tenant-wide contributor merge.' },
      { title: 'Activity and cycle time', desc: 'Ingest PR, commit, review, and issue events with weighted activity scoring and end-to-end PR cycle time.' },
      { title: 'Engagement, rolled up', desc: 'Fold external activity, platform usage, and delivery into one engagement score per member across every project.' },
    ],
    faq: [
      { question: 'What does the Contributors surface track?', answer: 'It reconciles developer identity across GitHub, Jira, and Bitbucket, ingests PR/commit/review/issue activity with weighted daily scoring and PR cycle time, and rolls engagement up across your whole tenant — so humans and agents are measured on the same board.' },
      { question: 'Can I merge duplicate contributor records?', answer: 'Yes. Contributor consolidation is tenant-wide and reversible — merge duplicates that represent the same person, with an undo snapshot, and re-point their activity automatically.' },
    ],
  },
  '/dashboard': {
    relatedSurface: 'dashboard',
    seoDescription:
      'Your Builderforce.ai dashboard brings recent creation sessions, active work, and workspace signals into one place so you can resume an idea or follow it into delivery.',
    highlights: [
      { title: 'Return to your creative context', desc: 'Resume recent canvas sessions and see the work, collaborators, and next decisions connected to them.' },
      { title: 'From idea to action', desc: 'Start with what you want to create, then turn the useful parts into artifacts, projects, tasks, or agent work.' },
      { title: 'Follow work into delivery', desc: 'Move from the canvas to projects, models, agents, approvals, and operating views without losing the original context.' },
    ],
    faq: [
      { question: 'What is on the Builderforce.ai dashboard?', answer: 'The dashboard is your workspace command center: workspace health, recent runs, and a live view of what your AI workforce is doing. From here you can jump into Brain Storm, projects, training, and the workforce mesh.' },
      { question: 'How do I go from an idea to work getting done?', answer: 'Type what you want to build into the dashboard prompt and it routes into Brain Storm, which turns the idea into projects and tasks and assigns the work to your agents under your approval gates.' },
    ],
  },
};

const REGISTRY: Record<string, RouteMarketing> = { ...fromSurfaces, ...extra };

/**
 * Every registry a signed-out visitor's path could belong to.
 *
 * `NAV_GROUPS` alone is the builder's menu, and the three restricted account
 * types navigate their own — so resolving `/freelancer/profile` or `/sales`
 * against the builder list returns nothing and those routes fall to the generic
 * page. `FREELANCER_NAV_GROUPS` is deliberately absent: it is `FOR_HIRE_NAV_GROUPS`
 * plus a Settings row that is already here.
 */
const TEASER_NAV_GROUPS: NavGroup[] = [...NAV_GROUPS, ...FOR_HIRE_NAV_GROUPS, ...SALES_NAV_GROUPS];

/**
 * The destination that owns this route, if any — tier 2 above.
 *
 * This is the SAME resolver the authenticated rail uses to decide which row is
 * lit (`findActiveGroup`), which is the point: a signed-out visitor and a
 * signed-in one are told they are in the same place, because one function
 * answers "where is this" for both.
 */
export function destinationForRoute(pathname: string): NavGroup | undefined {
  return findActiveGroup(pathname, TEASER_NAV_GROUPS);
}

/**
 * Destination teasers that must NOT be indexed: operator tooling and PERSONAL
 * consoles. Same reasoning as {@link NOINDEX_TEASER_ROUTES} — the page stays for
 * anyone holding the link, it just has nothing to rank for. Superadmin-only rows
 * are DERIVED rather than listed, so a new one is excluded by existing.
 */
const NOINDEX_DESTINATION_IDS = new Set([
  'settings',
  'sales',
  'freelancer-dashboard',
  'freelancer-profile',
  'freelancer-workspace',
  'freelancer-timecard',
  'freelancer-gigs',
]);

function isNoindexDestination(group: NavGroup): boolean {
  return group.superadminOnly === true || NOINDEX_DESTINATION_IDS.has(group.id);
}

/**
 * Destination rows that render a teaser of their own — a nav row whose href is a
 * plain path on an app route that no registry entry already covers.
 *
 * Filtered by `classifyShell` rather than by a second list: `/marketplace` and
 * `/knowledge` are nav rows AND public pages, and a public page does not need a
 * teaser (nor a second sitemap row pointing at the same URL).
 */
function destinationTeaserRoutes(): { route: string; group: NavGroup }[] {
  const seen = new Set<string>();
  const rows: { route: string; group: NavGroup }[] = [];
  for (const group of TEASER_NAV_GROUPS) {
    const route = group.href;
    if (route.includes('?') || seen.has(route)) continue;
    if (REGISTRY[route] || classifyShell(route) !== 'app') continue;
    seen.add(route);
    rows.push({ route, group });
  }
  return rows;
}

/**
 * Registry routes that must NOT be indexed.
 *
 * Every authenticated route renders a `RouteMarketing` teaser to a logged-out
 * visitor (see `ConditionalAppShell`), which makes it a real, crawlable page
 * whether or not anyone decided it should be. For a marketed surface — Canvas,
 * projects, workforce — that is the point: it is a demand-capture landing page.
 * For operator tooling it is not. A "Platform Admin" page in the index invites
 * exactly the traffic it should never receive, and a workspace switcher has
 * nothing to rank for.
 *
 * These four therefore keep their teaser (so a deep link is still not a dead
 * end) and are excluded from the sitemap.
 */
const NOINDEX_TEASER_ROUTES = new Set(['/admin', '/tenants', '/settings', '/agent-worker']);

/**
 * The teaser routes that belong in the sitemap, derived from the registry.
 *
 * Derived rather than hand-listed on purpose: the previous sitemap named twelve
 * of these by hand and silently omitted the rest, so adding a surface to the
 * registry left it unindexed and nobody found out. Now the two cannot drift —
 * a new marketed surface is indexed by existing, and a new internal one is
 * excluded by being named above.
 */
export function indexableTeaserRoutes(): string[] {
  const marketed = Object.keys(REGISTRY).filter((route) => !NOINDEX_TEASER_ROUTES.has(route));
  const destinations = destinationTeaserRoutes()
    .filter(({ group }) => !isNoindexDestination(group))
    .map(({ route }) => route);
  return [...new Set([...marketed, ...destinations])].sort();
}

/**
 * Should this route tell crawlers to stay away? Consumed by robots metadata.
 *
 * The generic tier is noindex BY DEFAULT, and that is the interesting half: its
 * body is identical at every route that reaches it, so indexing it would file
 * forty URLs of duplicate content under forty different names. A route earns its
 * place in the index by being a marketed surface or a named destination.
 */
export function isNoindexTeaserRoute(pathname: string): boolean {
  if (NOINDEX_TEASER_ROUTES.has(pathname)) return true;
  if (getRouteMarketing(pathname)) return false;
  const group = destinationForRoute(pathname);
  return group ? isNoindexDestination(group) : true;
}

/** Longest-prefix match of `pathname` against a `key → value` map. */
function longestPrefixMatch<T>(pathname: string, map: Record<string, T>): { key: string; val: T } | null {
  let best: { key: string; val: T } | null = null;
  for (const [key, val] of Object.entries(map)) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, val };
    }
  }
  return best;
}

/**
 * The hand-authored copy for this route, or `null` when it has none.
 *
 * Null rather than a default: a default returned here is a default nobody can
 * see coming, and the caller is the only place that knows whether it can fall
 * back to a destination (tier 2) before it falls back to the method (tier 3).
 */
export function getRouteMarketing(pathname: string): RouteMarketing | null {
  const base = REGISTRY[pathname] ?? longestPrefixMatch(pathname, REGISTRY)?.val ?? null;
  if (!base) return null;
  const details = DETAILS[pathname] ?? longestPrefixMatch(pathname, DETAILS)?.val;
  return details ? { ...base, ...details } : base;
}

/** i18n key for a destination's one-line marketing pitch, under `routeMarketing`. */
export function destinationPitchKey(groupId: string): string {
  return `destination.${groupId}.description`;
}

/** Every destination id that needs a pitch — the ratchet's input, and the reason
 *  a new nav row cannot ship as an unnamed page in four languages. */
export function teaserDestinationIds(): string[] {
  return [...new Set(TEASER_NAV_GROUPS.map((group) => group.id))].sort();
}

/** The routes carrying a DETAILS overlay. Exported for the ratchet that asserts
 *  each one has a base row — an overlay without a base used to render its
 *  highlights under the GENERIC hero, which is how /brainstorm and /training
 *  spent months titled "This is part of Builderforce.ai". */
export function detailRoutes(): string[] {
  return Object.keys(DETAILS);
}

/** Routes with hand-authored copy. Exported for the same ratchet. */
export function marketedRoutes(): string[] {
  return Object.keys(REGISTRY);
}
