import { PRODUCT_SECTIONS, PROJECTS_TASKS_FAQ, type FaqItem } from './content';

/**
 * Marketing copy shown to logged-out visitors who land on an authenticated
 * route — so a deep link to /dashboard, /ide, /brainstorm, etc. renders a rich
 * feature page (hero + how-it-works + FAQ + related articles + JSON-LD) instead
 * of a blank gate, redirect, or one-line teaser.
 *
 * The base hero (icon/title/description) is derived from PRODUCT_SECTIONS
 * (single source of truth for the product surfaces); `extra` covers authed
 * routes that aren't a marketed surface. The per-route `DETAILS` overlay adds
 * the marketing body, FAQ, SEO description, and the RELATED_ARTICLES surface key
 * used to attach associated blog content. Lookup is longest-prefix so /ide/123
 * and /settings/members resolve.
 */
export interface RouteHighlight {
  title: string;
  desc: string;
}

export interface RouteMarketing {
  icon: string;
  title: string;
  description: string;
  /** "How it works" / benefit points rendered under the hero. */
  highlights?: RouteHighlight[];
  /** FAQ rendered on the teaser AND emitted as FAQPage JSON-LD for SEO/GEO. */
  faq?: FaqItem[];
  /** RELATED_ARTICLES surface key → associated blog posts shown on the teaser. */
  relatedSurface?: string;
  /** Longer description used for the document title's meta + JSON-LD app entity. */
  seoDescription?: string;
}

const fromSurfaces: Record<string, RouteMarketing> = {};
for (const section of PRODUCT_SECTIONS) {
  for (const s of section.surfaces) {
    fromSurfaces[s.href] = { icon: s.icon, title: s.title, description: s.desc };
  }
}

const extra: Record<string, RouteMarketing> = {
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
      'Brain Storm is the plain-language front door to Builderforce.ai — describe what you want to build and the Brain turns it into projects, tasks, datasets, and agents, then orchestrates the work across your AI workforce.',
    highlights: [
      { title: 'Describe it in plain language', desc: 'Say what you want to build. The Brain assistant turns the idea into structured projects, tasks, and a plan — no forms, no setup.' },
      { title: 'It calls real platform tools', desc: 'The Brain is wired to a tool registry: it can create projects, draft specs, generate datasets, and assign work to agents — not just chat about it.' },
      { title: 'Grounded in your workspace', desc: 'Pin a project and the Brain answers with that context, so ideation continues exactly where your work already lives.' },
    ],
    faq: [
      { question: 'What is Brain Storm on Builderforce.ai?', answer: 'Brain Storm is the full-page Brain assistant — a plain-language interface where you describe what you want to build and the Brain turns it into projects, tasks, datasets, and agent work. It is the same Brain available as a docked drawer everywhere in the app, given a full-page canvas.' },
      { question: 'Does the Brain actually do things, or just chat?', answer: 'It acts. The Brain is connected to a platform tool registry and your tenant\'s MCP extensions, so it can create projects, draft specs and PRDs, kick off dataset generation, and assign tasks to agents — every tool call governed by your approval gates.' },
      { question: 'Do I need to set anything up to start brainstorming?', answer: 'No. Sign in, open Brain Storm, and type. You can optionally pin a project so answers are grounded in that codebase and context, but a blank prompt is enough to start turning an idea into a plan.' },
    ],
  },
  '/ide': {
    relatedSurface: 'ide',
    seoDescription:
      'The Builderforce.ai in-browser IDE runs a full Node.js runtime via WebContainers with a Monaco editor, terminal, AI chat, and real-time collaboration — pair-program with agents without a local setup.',
    highlights: [
      { title: 'A full IDE in the browser', desc: 'Monaco editor, a real xterm.js terminal on a WebContainer Node.js runtime, file explorer, and live preview — run npm install and dev servers with no local setup.' },
      { title: 'Pair-program with agents', desc: 'A streaming AI chat with full project file context can apply changes and create files directly, so humans and agents co-author in the same workspace.' },
      { title: 'Real-time collaboration', desc: 'Multi-file collaborative editing via Yjs CRDT and a shared terminal mean your team and your agents work the same project live.' },
    ],
    faq: [
      { question: 'Is the Builderforce.ai IDE really running in my browser?', answer: 'Yes. It uses WebContainers to run a full Node.js runtime client-side, with a Monaco editor and a real xterm.js terminal. You can run npm install, start a Vite dev server, and use an interactive shell without installing anything locally.' },
      { question: 'Can AI agents edit code in the IDE?', answer: 'Yes. The IDE\'s AI chat panel has full project file context and can apply code changes and create files directly. It is built for human-AI co-authorship — you and your agents work in the same files in real time.' },
      { question: 'Does it support real-time collaboration?', answer: 'Yes. Multi-file editing is collaborative via Yjs CRDT and the terminal is shared across collaborators, so a team — and its agents — can work on one project simultaneously.' },
    ],
  },
  '/training': {
    relatedSurface: 'training',
    seoDescription:
      'Train custom AI agents in your browser with WebGPU LoRA fine-tuning up to 2B parameters, an AI evaluation engine, and zero cloud GPU bills — then publish them to the Workforce Registry and call them from inside your own agent.',
    highlights: [
      { title: 'Fine-tune in the browser', desc: 'WebGPU LoRA training on instruction datasets, up to 2 billion parameters, entirely client-side — zero cloud GPU bills and total privacy.' },
      { title: 'Generate datasets in seconds', desc: 'Author an instruction-tuning dataset from a single capability prompt with streaming progress, then train on it without leaving the page.' },
      { title: 'Evaluate, then publish', desc: 'An independent AI judge scores correctness, reasoning, and hallucination rate. Publish the trained agent to the Workforce Registry and call it from inside your own agent.' },
    ],
    faq: [
      { question: 'How does in-browser training work without a GPU server?', answer: 'Training runs on your local device through the WebGPU API. Builderforce.ai fine-tunes LoRA adapters on transformer and SSM models up to 2 billion parameters entirely client-side, so there are no cloud GPU bills and your data never leaves your browser during training.' },
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
      { title: 'Approval-gated by design', desc: 'Insert human-in-the-loop approval gates anywhere in the flow, so high-impact steps wait for sign-off and every run is audited.' },
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
      { title: 'Full observability', desc: 'Every task and workflow emits structured telemetry to a live timeline, so you always know what each agent is doing, costing, and calling.' },
    ],
    faq: [
      { question: 'What is the Workforce mesh?', answer: 'The Workforce is where you discover and coordinate your agent hosts. It dispatches work across local and remote AgentHosts — capacity sharing across machines and even tenants — using HMAC-signed, Bearer-authenticated dispatch, with smart routing to the best-matched peer.' },
      { question: 'Can I see and approve what agents are doing?', answer: 'Yes. The Workforce surface has tabs for approvals (human-in-the-loop sign-off), chats (talk to agents or watch them collaborate), and logs (a live telemetry timeline of every action, token, and tool call).' },
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
      { title: 'Zero commission to publish', desc: 'Publish a skill and keep 100% of any revenue — Builderforce charges no commission on what you list in the marketplace.' },
    ],
    faq: [
      { question: 'What are skills on Builderforce.ai?', answer: 'Skills are reusable capabilities you can give your agents. There are 53 built-in skills plus a marketplace where you browse, install, or publish more. A skill assigned at tenant or agentHost scope is loaded automatically into running agents at startup.' },
      { question: 'Can I publish my own skills?', answer: 'Yes — and Builderforce charges zero commission. You publish a skill to the Workforce marketplace and keep 100% of any revenue from it.' },
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
      'Builderforce.ai is your AI Security Officer — per-tenant isolation, AES-256-GCM encrypted credentials, role-based access control, device trust, human-in-the-loop approval gates, and a complete audit trail on every agent action.',
    highlights: [
      { title: 'Govern every action', desc: 'Human-in-the-loop approval gates suspend high-impact actions until a person signs off, with every decision recorded in an audit trail.' },
      { title: 'Encrypted and isolated', desc: 'Per-tenant isolation and AES-256-GCM encrypted credentials keep every integration and workspace private and scoped by default.' },
      { title: 'RBAC and device trust', desc: 'Role-based access control, device trust, and HMAC-signed inter-host dispatch mean only the right people and machines can act.' },
    ],
    faq: [
      { question: 'How does Builderforce.ai govern what agents can do?', answer: 'Through human-in-the-loop approval gates: agents request approval before high-impact actions, execution suspends until a person approves or rejects, and every outcome is recorded in a full audit trail. Auto-approval rules let low-risk actions through automatically.' },
      { question: 'How are my credentials and data protected?', answer: 'Integration credentials are encrypted with AES-256-GCM and scoped per tenant. All resources — projects, datasets, models, and agents — are isolated per tenant with no cross-tenant access, and inter-host dispatch is HMAC-signed and Bearer-authenticated.' },
      { question: 'Can Builderforce.ai run air-gapped?', answer: 'Yes. It is self-hosted and supports air-gapped deployment, and with local models via Ollama the entire agent workforce can run without any code or prompt leaving your network.' },
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
      'Your Builderforce.ai dashboard is the command center for your AI workforce — workspace health, recent runs, and what every agent is doing right now, in one place.',
    highlights: [
      { title: 'Your command center', desc: 'See workspace health, recent runs, and what your AI workforce is doing right now the moment you sign in.' },
      { title: 'From idea to action', desc: 'A "what should we build?" prompt routes straight into Brain Storm, turning a thought into projects, tasks, and agent work.' },
      { title: 'Everything one click away', desc: 'Jump to projects, training, the workforce mesh, and approvals from a single home surface.' },
    ],
    faq: [
      { question: 'What is on the Builderforce.ai dashboard?', answer: 'The dashboard is your workspace command center: workspace health, recent runs, and a live view of what your AI workforce is doing. From here you can jump into Brain Storm, projects, training, and the workforce mesh.' },
      { question: 'How do I go from an idea to work getting done?', answer: 'Type what you want to build into the dashboard prompt and it routes into Brain Storm, which turns the idea into projects and tasks and assigns the work to your agents under your approval gates.' },
    ],
  },
};

/** Default copy for any authed route without a specific entry. */
const DEFAULT: RouteMarketing = {
  icon: '🔒',
  title: 'This is part of Builderforce.ai',
  description: 'Sign in to access your AI workforce — build, train, orchestrate, and govern custom AI agents.',
};

const REGISTRY: Record<string, RouteMarketing> = { ...fromSurfaces, ...extra };

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

export function getRouteMarketing(pathname: string): RouteMarketing {
  const base = REGISTRY[pathname] ?? longestPrefixMatch(pathname, REGISTRY)?.val ?? DEFAULT;
  const details = DETAILS[pathname] ?? longestPrefixMatch(pathname, DETAILS)?.val;
  return details ? { ...base, ...details } : base;
}
