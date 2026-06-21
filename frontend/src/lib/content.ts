/**
 * Canonical content module — single source of truth for marketing copy,
 * features, pricing, stats, and comparison data used across all surfaces.
 *
 * Import from here instead of hardcoding copy in page components.
 */

/* ════════════════════ BRAND ════════════════════ */

export const BRAND = {
  name: 'Builderforce.ai',
  legalName: 'Builderforce',
  tagline: 'Your AI CTO, CIO & Security Officer',
  url: 'https://builderforce.ai',
  founder: { name: 'Sean Hogg', url: 'https://myvideoresu.me/resumes/seanhogg' },
  year: 2026,
  ogImage: '/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  /** ISO 8601 — update on each content deploy */
  dateModified: '2026-06-21T00:00:00Z',
} as const;

/* ════════════════════ STATS ════════════════════ */

export const STATS = {
  /** Consumer-facing stats shown on landing/marketing pages */
  marketing: [
    { value: '2B+', label: 'Parameters\nin-browser' },
    { value: '<30s', label: 'Dataset\ngeneration' },
    { value: 'WebGPU', label: 'Hardware\naccelerated' },
    { value: '100%', label: 'Private — runs\nin your browser' },
  ],
  /** Quotable one-liners for AI citability */
  quotable: {
    humanInLoopAgentic: 'Builderforce.ai is a human-in-the-loop, fully agentic cloud: train your own AI agents and put them to work inside your own agent, running a whole workforce from a Kanban board — all without ever leaving VS Code.',
    trainAndUseLoop: 'Train a custom agent, publish it to the Workforce Registry, then hire it and call it from inside your own agent — your trained specialists become tools your main agent delegates to.',
    neverLeaveVsCode: 'The BuilderForce VS Code extension runs the whole platform in your editor — chat with agents, assign and run tasks, review and validate their work, and approve actions without leaving VS Code.',
    aiExecutiveTeam: 'Builderforce.ai acts as your AI CTO, CIO and Security Officer — building your AI agent workforce, connecting your systems, and governing every action with approvals and an audit trail.',
    freeForever: 'Free plan is $0/month forever, no credit card required.',
    zeroGpuBills: 'All training runs on your local WebGPU device — zero cloud GPU bills.',
    browserNative: 'Fine-tune models up to 2 billion parameters directly in Chrome with WebGPU.',
    datasetSpeed: 'Generate an instruction-tuning dataset in under 30 seconds from a single capability prompt.',
    privacy: '100% private — your data and models never leave your browser during training.',
  },
} as const;

/* ════════════════════ FEATURES ════════════════════ */

export interface Feature {
  icon: string;
  title: string;
  shortDesc: string;
  longDesc: string;
}

export const FEATURES: Feature[] = [
  {
    icon: '▦',
    title: 'Kanban Board & Project Management',
    shortDesc: 'Plan, assign & track work on a live agent Kanban board.',
    longDesc: 'A full project-management surface: organize work into projects, then plan, assign, and track every task on a live Kanban board — swimlanes per status or per agent, plus table, calendar, and Gantt views. Humans and AI agents sit on the same board, and work flows from backlog to done in real time.',
  },
  {
    icon: '🔁',
    title: 'Train Your Own Agents — Then Use Them Inside Your Agent',
    shortDesc: 'Train custom agents and call them from inside your agent.',
    longDesc: 'Close the loop: train a custom agent (in-browser WebGPU LoRA + AI evaluation), publish it to the Workforce Registry, then hire it and call it from inside your own agent. Your trained specialists become tools your main agent delegates to — a fully agentic workforce you own and orchestrate.',
  },
  {
    icon: '🧩',
    title: 'Never Leave VS Code',
    shortDesc: 'Run your whole workforce from the VS Code extension.',
    longDesc: 'The BuilderForce VS Code extension brings the entire platform into your editor: chat with agents, assign and run tasks, review and validate their work, and manage your whole agent workforce — all without leaving VS Code. Human-in-the-loop approvals happen right where you code.',
  },
  {
    icon: '🧠',
    title: 'AI CTO',
    shortDesc: 'Builds, trains & deploys your AI workforce.',
    longDesc: 'Your AI CTO builds, trains and deploys your AI agent workforce — in-browser WebGPU LoRA fine-tuning, AI evaluation, and one-click publish to the Workforce Registry.',
  },
  {
    icon: '🔗',
    title: 'AI CIO',
    shortDesc: 'Connects & orchestrates your systems.',
    longDesc: 'Your AI CIO connects to your systems — GitHub, Jira, Confluence and more via encrypted credentials — and orchestrates work through the Brain assistant’s tool registry.',
  },
  {
    icon: '🛡️',
    title: 'AI Security Officer',
    shortDesc: 'Governs every action with approvals & audit.',
    longDesc: 'Your AI Security Officer governs every action: human-in-the-loop approval gates, a full audit trail, per-tenant isolation, and AES-256-GCM encrypted credentials.',
  },
  {
    icon: '🗂️',
    title: 'AI Dataset Generation',
    shortDesc: 'Generate datasets from a single prompt.',
    longDesc: 'Generate instruction-tuning datasets from a single capability prompt using any OpenRouter model. Export as JSONL, stored in R2.',
  },
  {
    icon: '🧠',
    title: 'In-Browser LoRA Training',
    shortDesc: 'Fine-tune up to 2B params with WebGPU.',
    longDesc: 'Fine-tune models up to 2B parameters directly in Chrome with WebGPU. No cloud GPU bills, zero round-trips, total privacy.',
  },
  {
    icon: '🔬',
    title: 'AI Evaluation Engine',
    shortDesc: 'Score outputs with an AI judge.',
    longDesc: 'Score your model outputs with an independent AI judge. Get structured quality metrics: correctness, reasoning, hallucination rate.',
  },
  {
    icon: '🤖',
    title: 'Agent Registry',
    shortDesc: 'Publish agents to the Workforce Registry.',
    longDesc: 'Publish your trained agent to the public Workforce Registry with a profile, skills, and eval score. Others can hire it instantly.',
  },
  {
    icon: '💾',
    title: 'R2 Artifact Storage',
    shortDesc: 'Persist LoRA weights to Cloudflare R2.',
    longDesc: 'LoRA adapter weights are serialised from WebGPU buffers and automatically persisted to Cloudflare R2 with signed URLs.',
  },
  {
    icon: '♻️',
    title: 'Semantic Response Cache',
    shortDesc: 'Reuse answers across paraphrases — slash token spend.',
    longDesc: 'An embedding-keyed cache reuses a prior answer when a new prompt means the same thing as one already answered, so the frontier model is never billed twice for the same work. Two tiers: a free on-device layer (SSM embeddings, in your browser and in each agent) plus a shared gateway layer — so a cache hit in the web app saves tokens for your agents too.',
  },
  {
    icon: '⚡',
    title: 'Full IDE Workspace',
    shortDesc: 'Monaco editor, terminal, AI chat — all-in-one.',
    longDesc: 'Monaco editor, terminal, AI chat, file explorer — everything you need in one collaborative project workspace.',
  },
  {
    icon: '🔐',
    title: 'Secure Multi-Tenant',
    shortDesc: 'JWT auth with tenant isolation.',
    longDesc: 'JWT auth with tenant isolation. Projects, datasets, models, and agents are private and scoped per tenant by default.',
  },
  {
    icon: '🌐',
    title: 'Cloudflare Edge',
    shortDesc: 'Zero cold-start global distribution.',
    longDesc: 'Zero cold-start Worker API with global distribution. COOP/COEP headers enable SharedArrayBuffer for Transformers.js.',
  },
];

/* ════════════════════ AGENT CAPABILITIES (BuilderForce Agents marketing surface) ════════════════════ */

/**
 * Single source of truth for the agent-runtime capability copy shown on the
 * public `/agents` page. Kept here (not hardcoded in the page) so a new
 * capability appears everywhere at once — same DRY contract as `FEATURES`.
 *
 * This is pure data: the SVG glyph is referenced by a stable `iconKey` and
 * resolved to JSX in the rendering surface (content.ts stays JSX-free). Any
 * inline-code spans in a description are written as `backtick` text and styled
 * by the renderer.
 */
export interface AgentCapability {
  /** Where the card links to (FeatureCard derives external/docs/internal from this). */
  href: string;
  title: string;
  /** Plain text; `backtick`-wrapped tokens are rendered as inline <code>. */
  description: string;
  /** Stable glyph key resolved to an SVG by the rendering surface. */
  iconKey: string;
}

export const AGENT_CAPABILITIES: AgentCapability[] = [
  { href: '/docs/getting-started', iconKey: 'cpu', title: 'Agent & Sub-agent Manager', description: 'BuilderForce Agents runs and coordinates independent coding agents and sub-agents. Delegate work autonomously across your entire workflow.' },
  { href: '/', iconKey: 'mesh', title: 'Mesh Orchestration', description: 'Builderforce.ai is the project management and mesh orchestrator — coordinating agents, tasks, and outcomes across your entire team.' },
  { href: '/docs/getting-started', iconKey: 'trending', title: 'Business Outcome Focus', description: 'Transition from writing code to managing business outcomes. Let the agents handle execution while you focus on strategy.' },
  { href: '/docs/agents-overview', iconKey: 'pulse', title: 'Self-Healing Runtime', description: 'Agents detect failures, fix themselves, and adapt over time. Persistent memory means context survives restarts — no re-explaining your codebase.' },
  { href: '/workforce?tab=approvals', iconKey: 'users', title: 'Human-in-the-Loop Control', description: 'Approval gates block agent execution until a manager approves in the Builderforce.ai portal. Workflow visibility, auditability, and human sign-off — enforced, not optional.' },
  { href: '/docs/agents-link', iconKey: 'bolt', title: 'AgentHost-to-AgentHost Mesh', description: 'Distribute work across a fleet of AgentHosts. Use `remote:auto[caps]` to route tasks to the best-matched peer. All dispatch is HMAC-signed and Bearer-authenticated.' },
  { href: '/docs/browser', iconKey: 'globe', title: 'Full Automation', description: 'Agents can browse the web, control your browser, run shell commands, and interact with any tool or service on your behalf.' },
  { href: '/docs/bash', iconKey: 'terminal', title: 'Full System Access', description: 'Read and write files, run shell commands, execute scripts. Full access or sandboxed — your choice.' },
  { href: '/agents/skills', iconKey: 'gear', title: 'Skills & Plugins', description: 'Extend with community skills or build your own. Skills assigned in the Builderforce.ai portal are loaded automatically at startup.' },
  { href: '/docs/deep-understanding', iconKey: 'layers', title: 'Deep Codebase Understanding', description: 'AST parsing, semantic maps, dependency graphs and git history give agents real comprehension of your project.' },
  { href: '/agents/workflow-builder', iconKey: 'flow', title: 'Agentic Workflow Builder', description: 'Drag-and-drop, IPAAS-style canvas for composing your own LLM logic — memory, knowledge-base and training nodes — wired to your agents and run on your agentHosts.' },
  { href: '/docs/agents-workflows', iconKey: 'activity', title: 'Multi-Agent Workflows', description: 'Built-in patterns for planning, feature dev, bug fixes, refactors and adversarial reviews keep work moving.' },
  { href: '/security', iconKey: 'shield', title: 'Security & RBAC', description: 'Role-based access control, device trust, and complete audit trails. HMAC-signed inter-AgentHost dispatch with Bearer authentication.' },
  { href: '/workforce?tab=logs', iconKey: 'bars', title: 'Workflow Telemetry', description: 'Every task and workflow emits structured JSONL spans locally and forwards to the Builderforce.ai portal timeline in real time.' },
  { href: '/docs/agents-workflows', iconKey: 'swimlane', title: 'Autonomous Swimlane Execution', description: 'Assign any agent — Cloud or On-Premise — to a kanban swimlane. Tickets are dispatched automatically and the board advances on its own as agents finish, stopping only at the approval gates you choose.' },
  { href: '/docs/getting-started', iconKey: 'git', title: 'Agents That Ship Code', description: 'A Cloud agent clones the bound repo through a secure server-side git proxy (your Git token never leaves the server), writes the change, pushes a branch and opens a pull request — headless, no browser open. On-Premise agents do the same on your own machine.' },
  { href: 'https://github.com/seanhogg/agents', iconKey: 'globe', title: 'Self-Hosted & Open Source', description: 'Run on your infrastructure under the MIT license — no vendor lock-in or subscription ceilings.' },
];

/* ════════════════════ PRICING ════════════════════ */

export interface PricingPlan {
  name: string;
  price: string;
  priceNumeric: number;
  period: string;
  description: string;
  features: string[];
  excluded: string[];
  cta: string;
  ctaHref: string;
  highlighted: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    priceNumeric: 0,
    period: '/month',
    description: 'Everything you need to start building AI agents — free forever, no credit card required.',
    features: [
      'WebGPU LoRA training',
      'Dataset generation wizard',
      'AI evaluation engine',
      'Public Workforce browsing',
      '1 AgentHost (BuilderForce Agents instance)',
      '5 projects',
      '10K tokens/day',
      'Community support',
    ],
    excluded: [
      'Approval workflows',
      'Fleet mesh + remote dispatch',
      'Full telemetry + audit trail',
      'Custom agent roles',
    ],
    cta: 'Get Started Free',
    ctaHref: '/register',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    priceNumeric: 29,
    period: '/seat/month',
    description: 'Unlimited agents, private models, and priority support for professional teams.',
    features: [
      'Everything in Free',
      'Up to 3 AgentHosts',
      'Unlimited projects',
      '1M tokens/day',
      'Approval workflows',
      'Fleet mesh + remote dispatch',
      'Full telemetry + audit trail',
      'Custom agent roles',
      'Priority support',
    ],
    excluded: [
      'Shared team approval inbox',
      'Per-seat cost controls',
    ],
    cta: 'Upgrade to Pro',
    ctaHref: '/pricing?upgrade=pro',
    highlighted: true,
  },
  {
    name: 'Teams',
    price: '$20',
    priceNumeric: 20,
    period: '/seat/month',
    description: 'Enterprise-grade controls with shared approval inbox and per-seat billing.',
    features: [
      'Everything in Pro',
      'Unlimited AgentHosts',
      '5M tokens/day',
      'Shared team approval inbox',
      'Per-seat cost controls',
    ],
    excluded: [],
    cta: 'Upgrade to Teams',
    ctaHref: '/pricing?upgrade=teams',
    highlighted: false,
  },
];

/* ════════════════════ COMPARISON ════════════════════ */

export interface ComparisonRow {
  feature: string;
  builderforce: string;
  genericNotebooks: string;
  cloudTraining: string;
}

export const COMPARISON: ComparisonRow[] = [
  { feature: 'In-browser LoRA training', builderforce: '✅', genericNotebooks: '❌', cloudTraining: '⚠️' },
  { feature: 'Dataset generation wizard', builderforce: '✅', genericNotebooks: '⚠️', cloudTraining: '❌' },
  { feature: 'AI evaluation engine', builderforce: '✅', genericNotebooks: '❌', cloudTraining: '❌' },
  { feature: 'Agent registry & skills', builderforce: '✅', genericNotebooks: '❌', cloudTraining: '❌' },
  { feature: 'Global Workforce marketplace', builderforce: '✅', genericNotebooks: '❌', cloudTraining: '❌' },
  { feature: 'Zero GPU bills', builderforce: '✅', genericNotebooks: '❌', cloudTraining: '⚠️' },
];

/* ════════════════════ COMPETITIVE COMPARISON (vs other AI coding tools) ════════════════════ */

export interface CompetitorCol {
  /** Stable column key — must match the keys used in CompetitiveRow.values. */
  key: string;
  label: string;
}

/** Rival tools in display order. Builderforce.ai is always the first, highlighted column. */
export const COMPETITORS: CompetitorCol[] = [
  { key: 'copilot', label: 'GitHub Copilot' },
  { key: 'cursor', label: 'Cursor / Windsurf' },
  { key: 'claudeCode', label: 'Claude Code' },
  { key: 'devin', label: 'Devin' },
  { key: 'openhands', label: 'OpenHands' },
  { key: 'aider', label: 'Aider' },
  { key: 'continueDev', label: 'Continue.dev' },
];

export interface CompetitiveRow {
  feature: string;
  /** Optional Builderforce-only qualifier shown under the feature name. */
  note?: string;
  /** Cell value per column key — `builderforce` plus every COMPETITORS key (✅ / ⚠️ / ❌ or short text). */
  values: Record<string, string>;
}

export interface CompetitiveCategory {
  id: string;
  title: string;
  blurb: string;
  rows: CompetitiveRow[];
}

/**
 * The full "Builderforce.ai vs the field" matrix, grouped into decision-driving
 * themes. Single source of truth for the /compare page and homepage teaser.
 */
export const COMPETITIVE_COMPARISON: CompetitiveCategory[] = [
  {
    id: 'ownership',
    title: 'Ownership & Deployment',
    blurb: 'Where the platform runs and who controls it determines cost, data residency, and lock-in.',
    rows: [
      { feature: 'Price', values: { builderforce: 'Free (MIT)', copilot: '$19/user/mo', cursor: '$20/user/mo', claudeCode: 'Usage-based', devin: '$500/mo', openhands: 'Free (MIT)', aider: 'Free (MIT)', continueDev: 'Free (MIT)' } },
      { feature: 'Self-hosted / open source', note: 'MIT, fully self-hosted', values: { builderforce: '✅', copilot: '❌ MS cloud', cursor: '❌ Vendor cloud', claudeCode: '❌ Anthropic cloud', devin: '❌ Cloud only', openhands: '✅', aider: '✅', continueDev: '✅' } },
      { feature: 'Air-gapped / private deployment', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '✅', aider: '✅', continueDev: '✅' } },
      { feature: 'RBAC + audit trails', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '⚠️ Basic', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
  {
    id: 'model-flexibility',
    title: 'Model & Tooling Flexibility',
    blurb: 'Freedom to choose any model, run offline, and integrate with the open MCP ecosystem.',
    rows: [
      { feature: 'Any model provider', note: '30+ providers', values: { builderforce: '✅', copilot: '❌ GPT/Claude', cursor: '⚠️ Limited', claudeCode: '❌ Anthropic only', devin: '❌ Proprietary', openhands: '✅', aider: '✅', continueDev: '✅' } },
      { feature: 'Local / offline models (Ollama)', values: { builderforce: '✅', copilot: '❌', cursor: '⚠️', claudeCode: '❌', devin: '❌', openhands: '✅', aider: '✅', continueDev: '✅' } },
      { feature: 'IDE-independent', note: 'Any channel / CLI', values: { builderforce: '✅', copilot: '❌ VS Code', cursor: '❌ VS Code fork', claudeCode: '⚠️ Terminal', devin: '✅ Web UI', openhands: '✅ Web/CLI', aider: '✅ CLI', continueDev: '❌ Extension' } },
      { feature: 'MCP — consume', values: { builderforce: '✅', copilot: '❌', cursor: '✅ Native', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '✅ Native' } },
      { feature: 'MCP — expose as server', note: '/mcp endpoint', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
  {
    id: 'orchestration',
    title: 'Multi-Agent Orchestration',
    blurb: 'Coordinating specialized agents across structured workflows, not single-pass prompts.',
    rows: [
      { feature: 'Multi-agent orchestration', note: '7 roles + dependency DAG', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Planning workflow', note: 'PRD → Arch → Tasks via /spec', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '⚠️ Basic plan', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Bug-fix workflow', note: 'Analyzer → Creator → Reviewer', values: { builderforce: '✅', copilot: '⚠️ Inline', cursor: '⚠️ Inline', claudeCode: '⚠️ Inline', devin: '✅', openhands: '⚠️ Single-pass', aider: '⚠️ Single-pass', continueDev: '⚠️ Inline' } },
      { feature: 'Refactor workflow', note: 'Reviewer → Refactor → Tests', values: { builderforce: '✅', copilot: '❌', cursor: '⚠️ Single-pass', claudeCode: '⚠️ Single-pass', devin: '⚠️ Single-pass', openhands: '⚠️ Single-pass', aider: '⚠️ Single-pass', continueDev: '❌' } },
      { feature: 'Adversarial review pass', note: 'Built-in workflow', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Custom agent personas / roles', note: 'YAML in .builderforce/personas/', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
  {
    id: 'governance',
    title: 'Governance & Reliability',
    blurb: 'Approval gates, recovery, and automation that make agents safe to run in production.',
    rows: [
      { feature: 'Human-in-the-loop approval gates', note: 'Suspend + approve via portal', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '⚠️ Basic', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Self-healing / error recovery', note: 'Auto-detect + rerun', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '⚠️ Retry only', openhands: '⚠️ Retry only', aider: '❌', continueDev: '❌' } },
      { feature: 'Scheduled automation (cron)', note: 'Builderforce-synced', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'CI/CD pipeline integration', note: 'CLI + webhook triggers', values: { builderforce: '✅', copilot: '⚠️ PR suggest', cursor: '❌', claudeCode: '⚠️ CLI only', devin: '⚠️ API', openhands: '⚠️ API', aider: '⚠️ CLI', continueDev: '❌' } },
    ],
  },
  {
    id: 'codebase-context',
    title: 'Codebase Understanding & Editing',
    blurb: 'How deeply the tool reads your repo and how cleanly it stages changes for review.',
    rows: [
      { feature: 'Codebase semantic search', values: { builderforce: '✅', copilot: '⚠️', cursor: '✅', claudeCode: '⚠️ Basic RAG', devin: '✅', openhands: '⚠️ Basic', aider: '⚠️ Git-aware', continueDev: '✅' } },
      { feature: 'Deep AST + git-history analysis', values: { builderforce: '✅', copilot: '❌', cursor: '⚠️ Basic RAG', claudeCode: '⚠️ Basic RAG', devin: '⚠️ Basic RAG', openhands: '⚠️ Basic RAG', aider: '⚠️ Git-aware', continueDev: '⚠️ Basic RAG' } },
      { feature: 'Staged diff / accept-reject', note: '/diff, /accept, /reject', values: { builderforce: '✅', copilot: '❌', cursor: '✅ Composer', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '✅ Git diff', continueDev: '✅ ⌘K diff' } },
      { feature: 'Bundled skills', note: '53 built-in + marketplace', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
  {
    id: 'memory-fleet',
    title: 'Memory & Fleet',
    blurb: 'Persistent knowledge across sessions and coordination across machines.',
    rows: [
      { feature: 'Persistent project knowledge', note: '.builderforce/', values: { builderforce: '✅', copilot: '❌', cursor: '⚠️ In-session', claudeCode: '⚠️ In-session', devin: '⚠️ In-session', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Session handoffs', note: '/handoff + auto-load', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Workflow persistence across restarts', note: 'YAML checkpoint + resume', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '⚠️ Session-based', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Post-task knowledge loop', note: '.builderforce/memory/ auto-updated', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Agent-to-agent distributed delegation', note: 'remote:<id> dispatch', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Fleet / multi-machine coordination', note: 'Builderforce fleet registry', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
  {
    id: 'reach',
    title: 'Channels & Reach',
    blurb: 'Meeting your team where they already work, on any device.',
    rows: [
      { feature: 'Works in WhatsApp / Telegram / Slack', note: '15+ channels', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Voice + Talk mode', note: 'macOS / iOS / Android', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Mobile companion apps', note: 'iOS + Android', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
];

/* ════════════════════ COMPARE PAGE COPY ════════════════════ */

export interface ComparePillar {
  /** Emoji icon. */
  icon: string;
  title: string;
  desc: string;
}

export interface CompareTeaser {
  title: string;
  blurb: string;
  ctaLabel: string;
  /** Differentiating capability names for the condensed homepage teaser. */
  highlightFeatures: string[];
}

/** Narrative copy for the /compare page (and the homepage teaser). */
export const COMPARE = {
  seo: {
    title: 'Builderforce.ai vs the Field: Multi-Agent Delivery Compared | Builderforce.ai',
    description:
      'See how Builderforce.ai compares to GitHub Copilot, Cursor, Windsurf, Claude Code, Devin, OpenHands, Aider and Continue.dev. Self-hosted, MIT-licensed, model-agnostic multi-agent orchestration with governance, audit and persistent memory.',
    ogTitle: 'Builderforce.ai vs GitHub Copilot, Cursor, Claude Code, Devin & more',
  },
  hero: {
    eyebrow: 'Builderforce.ai vs the field',
    title: 'Purpose-built for multi-agent delivery, not file-level autocomplete',
    subtitle:
      'GitHub Copilot finishes your line. Cursor rewrites your function. Builderforce.ai plans the feature, coordinates a team of specialist agents to build, review and test it, governs every action with approvals and an audit trail, and remembers what your project decided last sprint. Self-hosted, MIT-licensed, and model-agnostic.',
  },
  intro:
    'Most AI coding tools are powerful autocomplete engines that stop at the file boundary. Builderforce.ai operates one level up: it builds, trains and deploys an AI agent workforce, connects to your systems, and governs every action like an AI CTO, CIO and Security Officer. The tables below compare Builderforce.ai against the tools teams evaluate most often, focused on the capabilities that separate shipping a feature from finishing a line.',
  pillars: [
    {
      icon: '🛡️',
      title: 'Self-hosted, MIT-licensed, air-gapped',
      desc: 'Your code and your agents run on your own machines. MIT-licensed with no subscription ceiling and a full air-gapped deployment path, so security and compliance teams keep control. Most rivals are closed SaaS that send your code to their cloud.',
    },
    {
      icon: '🔀',
      title: 'True multi-agent orchestration',
      desc: 'Seven specialist roles coordinated through a dependency DAG run planning, bug-fix, refactor and adversarial-review workflows end to end. Copilot, Cursor, Claude Code, Devin and the rest drive a single agent making one suggestion at a time.',
    },
    {
      icon: '🎛️',
      title: 'Model freedom, no vendor lock-in',
      desc: 'Route any task to any of 30+ providers, including fully local models via Ollama and self-managed Bedrock. Copilot is tied to GPT and Claude; Devin is proprietary. Builderforce.ai is IDE-independent and never tethered to one vendor.',
    },
    {
      icon: '✅',
      title: 'Governance, memory and fleet reach',
      desc: 'Human-in-the-loop approval gates and a full audit trail wrap every action, persistent project memory lives in .builderforce/, and agent-to-agent distributed delegation spans machines and 15+ chat channels with voice and mobile companion apps.',
    },
  ] as ComparePillar[],
  quotable:
    'Builderforce.ai is the only one of these tools purpose-built for multi-agent delivery: self-hosted, MIT-licensed, model-agnostic across 30+ providers, and governed by approvals and an audit trail, where the others optimize a single agent inside a single editor.',
  teaser: {
    title: 'Built for delivery, not just completion',
    blurb:
      'GitHub Copilot, Cursor, Claude Code and Devin drive a single agent. Builderforce.ai orchestrates a self-hosted, model-agnostic agent workforce with governance, audit and persistent memory. See the full comparison.',
    ctaLabel: 'Compare Builderforce.ai vs the field',
    highlightFeatures: [
      'Train your own agents — then call them inside your agent',
      'Kanban board + project management for your workforce',
      'Manage your whole workforce without leaving VS Code',
      'Multi-agent orchestration (7 roles + DAG)',
      'Human-in-the-loop approval gates + audit trail',
      '30+ model providers incl. local Ollama',
    ],
  } as CompareTeaser,
} as const;

/* ════════════════════ GETTING STARTED ════════════════════ */

export const GETTING_STARTED_STEPS = [
  { num: '01', title: 'Create an account', desc: 'Sign up with your email and start a free workspace. 14-day Pro trial, no credit card required.' },
  { num: '02', title: 'Generate a dataset', desc: 'Use the wizard to author an instruction-tuning dataset from a single capability prompt.' },
  { num: '03', title: 'Train & publish', desc: 'Run LoRA training in your browser, evaluate results, and publish your agent to the Workforce Registry.' },
];

/* ════════════════════ FAQ ════════════════════ */

export interface FaqItem {
  question: string;
  answer: string;
}

/** Homepage FAQ — 10 Q&As for rich snippet coverage */
export const HOMEPAGE_FAQ: FaqItem[] = [
  {
    question: 'What is Builderforce.ai?',
    answer: 'Builderforce.ai is a human-in-the-loop, fully agentic cloud that acts as your AI CTO, CIO and Security Officer. You train your own AI agents and put them to work inside your own agent, manage the whole workforce from a Kanban board, and review and approve every action — all without leaving VS Code. It builds, trains and deploys a custom AI agent workforce in the browser (dataset generation, WebGPU LoRA training, AI evaluation, and the Workforce Registry), connects to your systems and data, and governs every action with approval gates and an audit trail.',
  },
  {
    question: 'Can I train my own agents and use them inside my own agent?',
    answer: 'Yes — that is the core loop. Train a custom agent in the browser with WebGPU LoRA fine-tuning and the AI evaluation engine, publish it to the Workforce Registry, then hire it and call it from inside your own agent. Your trained specialists become tools your main agent delegates to, so you build and orchestrate a fully agentic workforce you own.',
  },
  {
    question: 'Do I have to leave VS Code to manage my agents?',
    answer: 'No. The BuilderForce VS Code extension brings the whole platform into your editor: chat with agents, assign and run tasks on the Kanban board, review and validate their work, and approve human-in-the-loop actions — all without leaving VS Code.',
  },
  {
    question: 'Does Builderforce have a Kanban board and project management?',
    answer: 'Yes. Projects organize your work, and the task board tracks it on a live Kanban board with swimlanes per status or per agent, plus table, calendar, and Gantt views. Humans and AI agents share the same board, so you plan, assign, and watch work flow from backlog to done in real time.',
  },
  {
    question: 'Can the Kanban board run itself with AI agents?',
    answer: 'Yes — that is Autonomous Swimlane Execution. Assign an agent (Cloud or On-Premise) to a board lane and tickets in that lane are dispatched to it automatically; the board advances from lane to lane as agents finish, pausing only at the approval gates you choose. You manage outcomes on a board instead of issuing prompts one at a time.',
  },
  {
    question: 'How does Builderforce keep LLM token costs down?',
    answer: 'A cross-surface semantic cache reuses a prior answer when a new prompt means the same thing as one already answered, so the frontier model is never billed twice for the same work. It runs in two tiers — a free on-device layer using SSM embeddings (in the browser and in each agent) and a shared tenant-scoped gateway layer — and is combined with model routing that exhausts cheaper models before reaching premium ones.',
  },
  {
    question: 'Is Builderforce free?',
    answer: 'Yes — the Free tier is $0/month forever with no credit card required. It includes WebGPU training, dataset generation, AI evaluation, and public Workforce browsing. The Pro plan ($29/seat/month) unlocks private agents, unlimited training, and priority support.',
  },
  {
    question: 'How do I train a model in my browser?',
    answer: 'Start a project, generate or upload a dataset, then launch the in-browser LoRA training wizard. Training runs entirely on your local WebGPU device — no cloud GPUs are required, and your data never leaves your browser.',
  },
  {
    question: 'What is the Workforce Registry?',
    answer: 'The Workforce Registry is a public marketplace where trained AI agents can be listed with profiles, skills, and evaluation scores. Other teams and applications can discover and hire agents instantly.',
  },
  {
    question: 'What is WebGPU LoRA fine-tuning?',
    answer: 'LoRA (Low-Rank Adaptation) is a parameter-efficient fine-tuning technique that trains a small set of adapter weights instead of the full model. Builderforce runs LoRA training directly in your browser using the WebGPU API, supporting models up to 2 billion parameters with zero cloud GPU costs.',
  },
  {
    question: 'How does the AI evaluation engine work?',
    answer: 'After training, an independent AI judge scores your model\'s outputs on structured quality metrics including correctness, reasoning quality, and hallucination rate. This gives you objective eval scores before publishing to the Workforce Registry.',
  },
  {
    question: 'What models can I fine-tune?',
    answer: 'Builderforce supports LoRA fine-tuning of transformer and SSM (State Space Model) architectures up to 2 billion parameters. Training runs on your local GPU via the WebGPU API in Chrome, Edge, or any WebGPU-capable browser.',
  },
  {
    question: 'Is my data private during training?',
    answer: 'Yes — 100% private. All training computation happens locally on your device using WebGPU. Your datasets, model weights, and training artifacts are never sent to external servers during training. Finished LoRA adapters are persisted to encrypted Cloudflare R2 storage.',
  },
  {
    question: 'How does Builderforce compare to cloud training platforms?',
    answer: 'Unlike cloud training platforms that charge per GPU-hour, Builderforce runs training on your local WebGPU device at zero cost. It also includes built-in dataset generation, AI evaluation, and a marketplace for publishing agents — features typically requiring multiple separate tools.',
  },
  {
    question: 'Can I integrate Builderforce agents with BuilderForce Agents?',
    answer: 'Yes — agents trained on Builderforce can be exported and deployed as BuilderForce Agents hippocampus models. The platform supports the full pipeline from training custom SSM models to pushing them to your self-hosted BuilderForce Agents gateway.',
  },
];

/** Pricing page FAQ */
export const PRICING_FAQ: FaqItem[] = [
  {
    question: 'Is Builderforce really free?',
    answer: 'Yes — the Free plan costs $0/month forever with no credit card required. You get WebGPU training, dataset generation, AI evaluation, and public Workforce browsing.',
  },
  {
    question: 'What is included in the Pro plan?',
    answer: 'Pro ($29/seat/month) includes everything in Free plus up to 3 AgentHosts, unlimited projects, 1M tokens/day, approval workflows, fleet mesh, full telemetry, custom agent roles, and priority support.',
  },
  {
    question: 'Can I change plans at any time?',
    answer: 'Yes — you can upgrade or downgrade at any time from the Pricing & Billing page. Upgrades take effect immediately; downgrades apply at the end of your current billing period.',
  },
  {
    question: 'What is a Managed AgentHost?',
    answer: 'A Managed AgentHost ($49/month) is a hosted BuilderForce Agents instance that Builderforce runs for you — no Docker, no DevOps. It connects to your workspace and runs your deployed agents.',
  },
  {
    question: 'Do you offer yearly billing?',
    answer: 'Yes — yearly billing is available for both Pro and Teams plans with savings of up to 20%. Select the yearly option during checkout.',
  },
];

/** Compare page FAQ — competitor-intent Q&As for "vs" search capture */
export const COMPARE_FAQ: FaqItem[] = [
  {
    question: 'Is Builderforce.ai an alternative to GitHub Copilot?',
    answer:
      'Yes, but they solve different scopes. GitHub Copilot is single-agent autocomplete inside VS Code, tied to GPT and Claude models. Builderforce.ai is a self-hosted, MIT-licensed multi-agent platform that orchestrates seven specialist roles through full planning, bug-fix, refactor and adversarial-review workflows, runs on 30+ model providers including local Ollama, and adds approvals, audit and persistent memory. Teams that have outgrown line completion adopt Builderforce.ai for end-to-end delivery.',
  },
  {
    question: 'How does Builderforce.ai compare to Cursor and Windsurf?',
    answer:
      'Cursor and Windsurf are excellent AI-native editors, but they are still single-agent and IDE-bound. Builderforce.ai is IDE-independent and works from any channel or CLI, coordinates multiple agents on one task through a dependency DAG, and is fully self-hosted with model freedom across 30+ providers. You can even connect Cursor or Windsurf to Builderforce.ai over MCP and use it as your orchestration and memory layer.',
  },
  {
    question: 'Builderforce.ai vs Claude Code and Aider, what is the difference?',
    answer:
      'Claude Code is locked to Anthropic models and Aider runs a single CLI agent. Builderforce.ai runs a team of specialist agents with a built-in adversarial review pass, human approval gates, an audit trail, and persistent project memory in .builderforce/. It is model-agnostic across 30+ providers and adds fleet mesh, remote:<id> dispatch and 15+ chat channels, so it scales from one developer to an orchestrated fleet.',
  },
  {
    question: 'Builderforce.ai vs Devin and OpenHands, which should I pick for autonomous engineering?',
    answer:
      'Devin is a proprietary hosted autonomous agent and OpenHands is an open single-agent runtime. Builderforce.ai differs by being self-hosted and MIT-licensed with true multi-agent orchestration and governance built in: approval gates, audit trails and self-healing recovery that auto-detects failures and reruns affected steps. You keep your code on your own infrastructure and choose any model, including local ones.',
  },
  {
    question: 'Can Builderforce.ai run fully offline or air-gapped?',
    answer:
      'Yes. Builderforce.ai is self-hosted and supports air-gapped deployment. With local models via Ollama you can run the entire agent workforce without any code or prompt leaving your network, which most closed competitors cannot offer. Project memory persists locally in .builderforce/ so context survives across sessions without a cloud dependency.',
  },
  {
    question: 'Does Builderforce.ai lock me into one model or IDE?',
    answer:
      'No. Builderforce.ai is model-agnostic across 30+ providers, including Anthropic, OpenAI, Bedrock and local Ollama, and it is IDE-independent, reachable from any CLI or chat channel. There is no editor fork to adopt and no single-vendor model requirement, which is a core difference from Copilot, Cursor, Windsurf and Claude Code.',
  },
];

/** Login page FAQ */
export const LOGIN_FAQ: FaqItem[] = [
  {
    question: 'What sign-in methods are available?',
    answer: 'Builderforce supports email/password, magic link (passwordless email), and OAuth with Google, GitHub, LinkedIn, and Microsoft.',
  },
  {
    question: 'What is a magic link?',
    answer: 'A magic link is a one-time sign-in URL sent to your email. Click it and you are signed in — no password needed. Magic links expire after 15 minutes.',
  },
  {
    question: 'I forgot my password. How do I reset it?',
    answer: 'Use the magic link option on the sign-in page. Enter your email and click "Email me a magic link instead" to sign in without a password, then update your password in Settings.',
  },
];

/** Register page FAQ */
export const REGISTER_FAQ: FaqItem[] = [
  {
    question: 'Is it free to create an account?',
    answer: 'Yes — creating an account is free and includes a 14-day Pro trial. No credit card required. After the trial you stay on the Free plan with WebGPU training, dataset tools, and Workforce browsing.',
  },
  {
    question: 'How long does setup take?',
    answer: 'Under 60 seconds. Sign up with email or OAuth, and you land in your workspace immediately. No installation, no configuration — everything runs in your browser.',
  },
  {
    question: 'What do I need to get started?',
    answer: 'A modern browser with WebGPU support (Chrome 113+, Edge 113+). No GPU server, no Python environment, no Docker — Builderforce runs entirely in the browser.',
  },
  {
    question: 'Does Builderforce charge any commission?',
    answer: 'No — Builderforce charges zero commission on agents you publish to the Workforce Registry. You keep 100% of any revenue from your published agents.',
  },
];

/** Blog index FAQ */
export const BLOG_FAQ: FaqItem[] = [
  {
    question: 'What topics does the Builderforce blog cover?',
    answer: 'The blog covers AI agent training, WebGPU LoRA fine-tuning, dataset generation, multi-agent orchestration, autonomous Kanban (swimlane) execution, cross-surface semantic caching for token savings, BuilderForce Agents integration, and product development best practices.',
  },
  {
    question: 'Does the blog compare Builderforce.ai to other AI coding tools?',
    answer: 'Yes. The blog includes head-to-head comparisons of Builderforce.ai versus GitHub Copilot, Cursor and Windsurf, Claude Code, and Devin, plus a criteria-first roundup of the best AI coding agents in 2026. Each comparison explains where single-agent tools stop and where a self-hosted, model-agnostic, multi-agent workforce begins.',
  },
  {
    question: 'Who writes the articles?',
    answer: 'Articles are written by Sean Hogg, founder of Builderforce.ai, covering practical guides and deep dives into the platform\'s architecture and capabilities.',
  },
];

/** BuilderForce Agents (/agents) FAQ — rich-snippet + GEO coverage for the agent-runtime surface. */
export const AGENTS_FAQ: FaqItem[] = [
  {
    question: 'What is BuilderForce Agents?',
    answer: 'BuilderForce Agents is the self-hosted agent runtime behind Builderforce.ai. It runs and coordinates independent coding agents and sub-agents on your own infrastructure under the MIT license, with deep codebase understanding, a skills system, multi-agent workflows, and human-in-the-loop approval gates — orchestrated from the Builderforce.ai portal.',
  },
  {
    question: 'Is BuilderForce Agents open source and self-hosted?',
    answer: 'Yes. It is MIT-licensed and runs on your own infrastructure — no vendor lock-in or subscription ceiling. You can run it fully air-gapped, and with local models via Ollama no code or prompt has to leave your network.',
  },
  {
    question: 'How do agents coordinate across machines?',
    answer: 'Agents form an AgentHost-to-AgentHost mesh. Work is distributed across a fleet of hosts and routed to the best-matched peer with remote:auto[caps] dispatch; every dispatch is HMAC-signed and Bearer-authenticated, and the portal shows a live telemetry timeline of every action.',
  },
  {
    question: 'Can agents ship code on their own?',
    answer: 'Yes. A Cloud agent clones the bound repo through a secure server-side git proxy (your Git token never leaves the server), writes the change, pushes a branch, and opens a pull request — headless, no browser open. On-Premise agents do the same on your own machine, and approval gates can require human sign-off before any high-impact step.',
  },
];

/** Projects / Tasks domain FAQ — rich-snippet + GEO coverage for the work-management surface. */
export const PROJECTS_TASKS_FAQ: FaqItem[] = [
  {
    question: 'What is the Projects / Tasks workspace in Builderforce.ai?',
    answer: 'Projects / Tasks is the single work-management surface where you organize everything your AI workforce builds. A project is a collaborative workspace with its own IDE, files, assigned agents, and workflows; the Tasks tab is a task board where work is planned, assigned to agents, and tracked through every status. Projects and Tasks live on one page with two tabs so you can move between organizing the work and tracking it without leaving the surface.',
  },
  {
    question: 'How do AI agents pick up and run tasks?',
    answer: 'Create a task on a project board, set its priority, and assign it to an AgentHost (a connected agent runtime). The agent picks up the task, runs it through your approval gates, and the board updates live as the task flows from backlog to in-progress to done — across local agents and a remote mesh of AgentHosts.',
  },
  {
    question: 'What views does the task board support?',
    answer: 'Tasks can be viewed as a kanban board (swimlanes per status or per agent), a sortable table, a calendar, or a Gantt timeline. Projects share the same card, table, calendar, and Gantt views, so you can plan delivery dates and dependencies the same way for both.',
  },
  {
    question: 'Can I scope tasks to a single project?',
    answer: 'Yes. Open a project and use its Task board action to jump straight to the Tasks tab filtered to that project, or browse all tasks across every project and filter by project, status, or priority. The project scope is preserved in the URL so the view is shareable.',
  },
  {
    question: 'How are projects and tasks connected to workflows and agents?',
    answer: 'Each project can have assigned agents and repeatable, approval-gated workflows. Tasks are the unit of work that flows to those agents; workflows orchestrate multi-step task execution. Together they form the loop from planning work to running it on your agent workforce, with full observability and an audit trail.',
  },
];

/* ════════════════════ DEFINED TERMS (GEO) ════════════════════ */

export interface DefinedTermEntry {
  name: string;
  description: string;
}

export const DEFINED_TERMS: DefinedTermEntry[] = [
  {
    name: 'WebGPU LoRA Fine-Tuning',
    description: 'A browser-native approach to fine-tuning AI models using Low-Rank Adaptation (LoRA) powered by the WebGPU API. Enables training models up to 2 billion parameters directly in Chrome without cloud GPUs.',
  },
  {
    name: 'Workforce Registry',
    description: 'A public marketplace where trained AI agents are listed with profiles, skills, and evaluation scores. Teams and applications can discover and hire agents instantly from the registry.',
  },
  {
    name: 'AI Evaluation Engine',
    description: 'An automated scoring system that uses an independent AI judge to evaluate model outputs on structured metrics including correctness, reasoning quality, and hallucination rate.',
  },
  {
    name: 'Instruction-Tuning Dataset',
    description: 'A structured collection of prompt-response pairs used to fine-tune language models for specific tasks. Builderforce generates these from a single capability prompt in under 30 seconds.',
  },
  {
    name: 'Agent Orchestration',
    description: 'The coordination of multiple AI agents working together on complex tasks. Includes workflow sequencing, approval gates, fleet mesh networking, and remote dispatch across BuilderForce Agents instances.',
  },
  {
    name: 'Multi-agent orchestration',
    description: 'Coordinating several specialist AI agents, each with a defined role, across a single body of work through a dependency DAG, rather than driving one agent that produces a single suggestion at a time. Builderforce.ai uses seven roles to run planning, bug-fix, refactor and adversarial-review workflows end to end.',
  },
  {
    name: 'Human-in-the-loop governance',
    description: 'An operating model in which AI agents pause at approval gates for a person to approve or reject high-impact actions, with every action recorded in an audit trail. Builderforce.ai applies this across its agent workforce so teams keep control and meet compliance requirements.',
  },
  {
    name: 'Agent-in-agent delegation',
    description: 'A pattern where a custom agent you train and publish becomes a callable tool your main agent delegates work to. On Builderforce.ai you train an agent (in-browser WebGPU LoRA + evaluation), publish it to the Workforce Registry, then hire and invoke it from inside your own agent — closing the loop from training to use.',
  },
  {
    name: 'Agent Kanban board',
    description: 'A live task board where work is planned, assigned, and tracked across both human team members and AI agents. Builderforce.ai supports swimlanes per status or per agent plus table, calendar, and Gantt views, with tasks flowing from backlog to done in real time as agents pick them up.',
  },
  {
    name: 'Autonomous Swimlane Execution',
    description: 'A self-driving Kanban model where an AI agent (Cloud or On-Premise) is assigned to a board lane. Tickets in that lane are dispatched to the agent automatically and the board advances from lane to lane as work finishes, pausing only at the approval gates you configure — so you manage outcomes on a board instead of issuing prompts one at a time.',
  },
  {
    name: 'Cross-surface semantic cache',
    description: 'An embedding-keyed cache that reuses a prior answer when a new prompt is a paraphrase of one already answered, so the frontier model is never billed twice for the same work. Builderforce.ai runs it in two tiers — a free on-device layer (SSM embeddings, in the browser and in each agent) and a shared tenant-scoped gateway layer — so a cache hit in the web app saves tokens for agents too.',
  },
];

/* ════════════════════ PRODUCT SURFACES (public capability tour) ════════════════════ */

export interface ProductSurface {
  icon: string;
  title: string;
  desc: string;
  /** Where the authenticated surface lives (deep link after sign-in). */
  href: string;
}

export interface ProductSection {
  id: string;
  /** Emoji used as the section's icon in the sidebar product map. */
  icon: string;
  title: string;
  blurb: string;
  surfaces: ProductSurface[];
}

/**
 * The actual in-app surfaces, described for logged-out visitors. Mirrors the
 * authenticated Sidebar groupings (MAIN / MESH / EXTENSIONS / SYSTEM) so the
 * public /product page stays in lock-step with what the app really ships —
 * fixing the "the menu is hidden so nobody knows what the product consists of"
 * gap. Keep this aligned with components/Sidebar.tsx.
 */
export const PRODUCT_SECTIONS: ProductSection[] = [
  {
    id: 'build',
    icon: '🛠',
    title: 'Build & Train',
    blurb: 'Go from an idea to a trained, evaluated AI agent — all in the browser.',
    surfaces: [
      { icon: '🏠', title: 'Dashboard', desc: 'Your command center: workspace health, recent runs, and what your AI workforce is doing right now.', href: '/dashboard' },
      { icon: '💡', title: 'Brain Storm', desc: 'Describe what you need in plain language; the Brain turns it into projects, datasets, and agents.', href: '/brainstorm' },
      { icon: '💻', title: 'IDE Workspace', desc: 'Monaco editor, terminal, AI chat, and file explorer in one collaborative project workspace.', href: '/ide' },
      { icon: '🎓', title: 'Training', desc: 'In-browser WebGPU LoRA fine-tuning up to 2B parameters with a live evaluation engine — zero GPU bills. Train a custom agent, then call it from inside your own agent.', href: '/training' },
      { icon: '🧩', title: 'VS Code Extension', desc: 'Run the whole platform from your editor — chat with agents, assign and run tasks, review and validate their work, and approve actions without leaving VS Code.', href: 'https://marketplace.visualstudio.com/items?itemName=builderforce.builderforce-vscode' },
    ],
  },
  {
    id: 'orchestrate',
    icon: '🔀',
    title: 'Orchestrate',
    blurb: 'Coordinate work across agents, workflows, and a mesh of remote AgentHosts.',
    surfaces: [
      { icon: '🔀', title: 'Workflow Builder', desc: 'Compose agents and tools into repeatable, approval-gated workflows.', href: '/workflows/builder' },
      { icon: '▦', title: 'Projects / Tasks', desc: 'Organize work into project workspaces — each with a full IDE, agents, and a task board — then plan, assign, and watch tasks flow across your agent workforce in board, table, calendar, or Gantt views.', href: '/projects' },
      { icon: '🕸️', title: 'Workforce Mesh', desc: 'Discover and dispatch work across local and remote AgentHosts — capacity sharing across machines and tenants.', href: '/workforce' },
      { icon: '💬', title: 'Chats', desc: 'Talk to your agents directly, or watch them collaborate in shared conversations.', href: '/workforce?tab=chats' },
    ],
  },
  {
    id: 'extend',
    icon: '🧩',
    title: 'Extend',
    blurb: 'A marketplace of skills, personas, prompts, and content to supercharge agents.',
    surfaces: [
      { icon: '⭐', title: 'Skills', desc: 'Install or publish reusable agent skills from the Workforce marketplace.', href: '/skills' },
      { icon: '👤', title: 'Personas', desc: 'Give agents a voice and behavior profile with reusable personas.', href: '/personas' },
      { icon: '📚', title: 'Prompt Library', desc: 'Browse, use, and share community prompt templates with variables.', href: '/prompts' },
      { icon: '✎', title: 'Content Manager', desc: 'Author and share content blocks your agents and marketplace can reuse.', href: '/content-manager' },
    ],
  },
  {
    id: 'govern',
    icon: '🛡',
    title: 'Govern & Operate',
    blurb: 'Approvals, security, and full observability — your AI Security Officer.',
    surfaces: [
      { icon: '✅', title: 'Approvals', desc: 'Human-in-the-loop approval gates on every sensitive action your agents take.', href: '/workforce?tab=approvals' },
      { icon: '🔒', title: 'Security', desc: 'Per-tenant isolation and AES-256-GCM encrypted credentials for every integration.', href: '/security' },
      { icon: '📊', title: 'Observability', desc: 'Full telemetry and an audit trail of every agent action, token, and tool call.', href: '/workforce?tab=logs' },
      { icon: '🏢', title: 'Tenants & Workspaces', desc: 'Multi-tenant workspaces with per-seat roles, members, and cost controls.', href: '/tenants' },
    ],
  },
];

/* ════════════════════ NAV LINKS ════════════════════ */

export interface NavLink {
  href: string;
  label: string;
}

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

/**
 * Grouped footer navigation, rendered as columns on desktop and collapsed to
 * stacked sections on mobile. `Home` is reached via the footer brand mark, so it
 * is intentionally omitted from the columns.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Product' },
      { href: '/compare', label: 'Compare' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Platform',
    links: [
      { href: '/marketplace', label: 'Workforce Registry' },
      { href: '/agents', label: 'BuilderForce Agents' },
      { href: '/blog', label: 'Blog' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { href: '/login', label: 'Sign In' },
      { href: '/register', label: 'Get Started' },
    ],
  },
];

/* ════════════════════ PROGRAMMATIC SEO — COMPETITOR LEAF PAGES ════════════════════ */

/**
 * Per-competitor SEO copy for the statically-generated `/compare/{slug}` leaf
 * pages. Keyed by the `COMPETITORS` column key so the comparison matrix
 * (`COMPETITIVE_COMPARISON`) can be filtered to that single rival. `slug` is the
 * public URL segment; one entry per row captures "{competitor} alternative" /
 * "Builderforce vs {competitor}" long-tail search intent without thin pages.
 */
export interface CompetitorSeo {
  /** URL segment, e.g. 'github-copilot'. */
  slug: string;
  /** Marketing label for the rival (may differ from the short matrix label). */
  name: string;
  /** One-line page subtitle. */
  tagline: string;
  /** 1-2 sentence intro paragraph (used in copy + meta description). */
  summary: string;
  /** Plain-language bottom-line for the page + JSON-LD. */
  verdict: string;
}

export const COMPETITOR_SEO: Record<string, CompetitorSeo> = {
  copilot: {
    slug: 'github-copilot',
    name: 'GitHub Copilot',
    tagline: 'A self-hosted, multi-agent alternative to single-agent autocomplete',
    summary:
      'GitHub Copilot is single-agent autocomplete inside VS Code, tied to GPT and Claude. Builderforce.ai is a self-hosted, MIT-licensed multi-agent platform that plans, builds, reviews and tests features across 30+ model providers with approvals, audit and persistent memory.',
    verdict:
      'Choose Builderforce.ai over GitHub Copilot when you have outgrown line completion and need orchestrated, governed, model-agnostic delivery you can self-host.',
  },
  cursor: {
    slug: 'cursor',
    name: 'Cursor & Windsurf',
    tagline: 'Orchestrate a self-hosted agent workforce, not one IDE-bound agent',
    summary:
      'Cursor and Windsurf are AI-native editors, but still single-agent and IDE-bound. Builderforce.ai is IDE-independent, coordinates multiple agents on one task through a dependency DAG, is fully self-hosted, and can even sit behind Cursor over MCP as your orchestration and memory layer.',
    verdict:
      'Choose Builderforce.ai over Cursor or Windsurf when you want IDE-independent multi-agent orchestration, model freedom, and self-hosting rather than a single editor fork.',
  },
  claudeCode: {
    slug: 'claude-code',
    name: 'Claude Code',
    tagline: 'Model-agnostic, multi-agent delivery beyond a single-vendor CLI',
    summary:
      'Claude Code is locked to Anthropic models and drives a single terminal agent. Builderforce.ai runs a team of specialist agents with a built-in adversarial review pass, approval gates, an audit trail, and persistent project memory - model-agnostic across 30+ providers including local Ollama.',
    verdict:
      'Choose Builderforce.ai over Claude Code when you need multi-agent workflows, governance, and freedom from a single model vendor.',
  },
  devin: {
    slug: 'devin',
    name: 'Devin',
    tagline: 'Self-hosted, MIT-licensed autonomous engineering with governance',
    summary:
      'Devin is a proprietary hosted autonomous agent at $500/mo. Builderforce.ai delivers true multi-agent orchestration that you self-host and own, MIT-licensed, with approval gates, audit trails and self-healing recovery - keeping your code on your own infrastructure with any model.',
    verdict:
      'Choose Builderforce.ai over Devin when you want self-hosted, auditable, model-agnostic autonomous engineering without a proprietary cloud or a $500/mo floor.',
  },
  openhands: {
    slug: 'openhands',
    name: 'OpenHands',
    tagline: 'Multi-agent orchestration and governance on top of open runtimes',
    summary:
      'OpenHands is an open single-agent runtime. Builderforce.ai adds true multi-agent orchestration (seven roles + dependency DAG), human approval gates, an audit trail, persistent memory and fleet mesh - all self-hosted and MIT-licensed.',
    verdict:
      'Choose Builderforce.ai over OpenHands when you need coordinated multi-agent workflows and governance, not a single-agent loop.',
  },
  aider: {
    slug: 'aider',
    name: 'Aider',
    tagline: 'From a single CLI agent to an orchestrated, governed agent workforce',
    summary:
      'Aider runs one git-aware CLI agent. Builderforce.ai coordinates a team of specialist agents with adversarial review, approval gates, persistent project memory, fleet mesh and 15+ chat channels - model-agnostic across 30+ providers and self-hosted.',
    verdict:
      'Choose Builderforce.ai over Aider when one CLI agent is no longer enough and you need orchestration, governance and memory at team scale.',
  },
  continueDev: {
    slug: 'continue-dev',
    name: 'Continue.dev',
    tagline: 'Beyond an IDE extension - orchestration, governance and memory',
    summary:
      'Continue.dev is an open IDE extension for single-agent assistance. Builderforce.ai is IDE-independent and orchestrates multiple specialist agents through full planning, bug-fix, refactor and review workflows with approvals, audit and persistent memory.',
    verdict:
      'Choose Builderforce.ai over Continue.dev when you want IDE-independent multi-agent delivery and governance rather than an in-editor assistant.',
  },
};

/** Slug -> competitor column key, for `/compare/{slug}` route resolution. */
export const COMPETITOR_SLUG_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(COMPETITOR_SEO).map(([key, v]) => [v.slug, key]),
);

/* ════════════════════ PROGRAMMATIC SEO — INTEGRATION LEAF PAGES ════════════════════ */

/**
 * Bounded set of statically-generated `/integrations/{slug}` leaf pages that
 * capture "Builderforce + {tool}" search intent. Single source of truth - keep
 * this list curated (no thin auto-generated bloat); each entry must say
 * something specific about how the agent workforce uses that tool.
 */
export interface IntegrationSeo {
  slug: string;
  name: string;
  category: string;
  tagline: string;
  summary: string;
  useCases: string[];
  /** Optional deep link into docs/skills for the "Learn more" CTA. */
  docsHref?: string;
}

export const SEO_INTEGRATIONS: IntegrationSeo[] = [
  {
    slug: 'github',
    name: 'GitHub',
    category: 'Source control',
    tagline: 'Let your agent workforce open PRs, review code and run CI on GitHub',
    summary:
      'Connect Builderforce.ai to GitHub so agents read repositories, branch, commit, open pull requests and react to CI checks - with every action gated by approvals and recorded in the audit trail.',
    useCases: ['Autonomous PR creation from a task', 'Review-and-merge with human approval gates', 'CI-aware build/fix loops', 'Repo-wide semantic search and refactors'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'gitlab',
    name: 'GitLab',
    category: 'Source control',
    tagline: 'Self-hosted agent delivery against GitLab merge requests',
    summary:
      'Builderforce.ai drives the full GitLab repo loop - read, branch, commit, and open merge requests - so a self-hosted agent workforce ships changes on your GitLab without leaving your infrastructure.',
    useCases: ['Merge-request automation', 'Cross-repo task execution', 'Air-gapped GitLab deployments'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'slack',
    name: 'Slack',
    category: 'Chat channels',
    tagline: 'Run and govern your agents straight from Slack',
    summary:
      'Reach the agent workforce from any Slack workspace: assign tasks, stream progress, and respond to human-in-the-loop approval prompts without leaving chat.',
    useCases: ['Assign tasks from a channel', 'Approve agent actions inline', 'Stream run status to a thread'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'discord',
    name: 'Discord',
    category: 'Chat channels',
    tagline: 'Command your agent workforce across Discord servers and DMs',
    summary:
      'Builderforce.ai connects to Discord servers, channels and DMs so your community or team can dispatch agents and receive results in real time.',
    useCases: ['Server-wide agent commands', 'DM-based private tasks', 'Live run notifications'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'whatsapp',
    name: 'WhatsApp',
    category: 'Chat channels',
    tagline: 'Direct your AI agents from WhatsApp',
    summary:
      'Pair a WhatsApp number to Builderforce.ai and run agent tasks, get summaries, and approve actions from your phone - useful for on-call and mobile-first workflows.',
    useCases: ['Mobile task dispatch', 'On-call approvals', 'Run summaries on the go'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'ollama',
    name: 'Ollama',
    category: 'Model providers',
    tagline: 'Run the entire agent workforce on local, offline models',
    summary:
      'With Ollama, Builderforce.ai routes any task to local models so the full multi-agent workforce runs air-gapped - no code or prompt leaves your network and there are zero cloud GPU bills.',
    useCases: ['Air-gapped / offline delivery', 'Zero-cost local inference', 'Data-residency compliance'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'anthropic',
    name: 'Anthropic Claude',
    category: 'Model providers',
    tagline: 'Use Claude models inside a governed, multi-agent workflow',
    summary:
      'Builderforce.ai routes tasks to Anthropic Claude alongside 30+ other providers, so you get Claude strengths within orchestrated workflows, approvals and persistent memory - without single-vendor lock-in.',
    useCases: ['Best-model-per-task routing', 'Claude + local-model fallback', 'Governed Claude usage with audit'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'mcp',
    name: 'Model Context Protocol (MCP)',
    category: 'Protocols',
    tagline: 'Consume MCP tools and expose Builderforce.ai as an MCP server',
    summary:
      'Builderforce.ai both consumes MCP servers and exposes its own /mcp endpoint, so other tools (Cursor, Claude Desktop, and more) can use it as an orchestration and memory layer over the open protocol.',
    useCases: ['Connect external MCP tools', 'Expose projects/tasks over MCP', 'Use Builderforce.ai as a memory backend'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'notion',
    name: 'Notion',
    category: 'Knowledge & docs',
    tagline: 'Give your agents read/write access to Notion knowledge',
    summary:
      'Connect Notion so agents ground their work in your team docs and write results back - turning living documentation into agent context.',
    useCases: ['Doc-grounded task execution', 'Auto-update specs and notes', 'Knowledge-base Q&A'],
    docsHref: '/agents/integrations',
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    category: 'Productivity',
    tagline: 'Let agents triage and act on email',
    summary:
      'With Gmail connected, agents can read, summarize and draft email as part of a workflow - useful for support triage, follow-ups and inbound-to-task flows.',
    useCases: ['Inbox triage to tasks', 'Drafted replies for approval', 'Email-driven workflow triggers'],
    docsHref: '/agents/integrations',
  },
];

/** Slug -> integration record, for `/integrations/{slug}` route resolution. */
export const INTEGRATION_SLUG_MAP: Record<string, IntegrationSeo> = Object.fromEntries(
  SEO_INTEGRATIONS.map((it) => [it.slug, it]),
);

/* ════════════════════ RELATED ARTICLES (associated blog content per surface) ════════════════════ */

/**
 * Single source of truth mapping a marketing surface to the blog posts that
 * back it as "associated content". Keys are stable surface ids (the page path
 * minus its leading slash, or a `compare:<competitorKey>` key for the per-rival
 * leaf pages). Values are ordered blog slugs resolved against `BLOG_POSTS`.
 *
 * The reusable <RelatedArticles> component reads this via `getPostsBySlugs`, so
 * adding a post to a page is a one-line data edit — no per-page JSX. Keep slugs
 * in sync with src/content/blog/*.md (a missing slug is silently skipped).
 */
export const RELATED_ARTICLES: Record<string, string[]> = {
  product: [
    'autonomous-swimlane-execution',
    'semantic-response-cache',
    'task-execution-and-observability',
  ],
  compare: [
    'best-ai-coding-agents-compared',
    'builderforce-vs-github-copilot',
    'builderforce-vs-cursor-windsurf',
  ],
  pricing: [
    'semantic-response-cache',
    'best-ai-coding-agents-compared',
    'getting-started-with-ai-agents',
  ],
  // Per-competitor leaf pages — keyed by the COMPETITORS column key. Each points
  // at its dedicated head-to-head post first, then the roundup for context.
  'compare:copilot': ['builderforce-vs-github-copilot', 'best-ai-coding-agents-compared'],
  'compare:cursor': ['builderforce-vs-cursor-windsurf', 'best-ai-coding-agents-compared'],
  'compare:claudeCode': ['builderforce-vs-claude-code', 'best-ai-coding-agents-compared'],
  'compare:devin': ['builderforce-vs-devin', 'best-ai-coding-agents-compared'],

  // Feature routes — associated blog content shown on each logged-out feature
  // teaser (RouteMarketing). Keyed by the route path minus its leading slash.
  brainstorm: ['product-ideation-with-builderforce', 'specs-and-planning-with-ai', 'getting-started-with-ai-agents'],
  ide: ['in-browser-ide-and-collaboration', 'product-ideation-with-builderforce', 'getting-started-with-ai-agents'],
  training: ['webgpu-lora-explained', 'ai-dataset-generation-best-practices', 'getting-started-with-ai-agents'],
  workflows: ['multi-agent-orchestration', 'autonomous-swimlane-execution', 'specs-and-planning-with-ai'],
  projects: ['autonomous-swimlane-execution', 'task-execution-and-observability', 'product-ideation-with-builderforce'],
  workforce: ['fleet-management-and-agent-routing', 'autonomous-swimlane-execution', 'multi-agent-orchestration'],
  skills: ['skills-assignment-and-the-marketplace', 'builderforce-agents-and-agent-integration', 'best-ai-coding-agents-compared'],
  personas: ['builderforce-agents-and-agent-integration', 'multi-agent-orchestration', 'skills-assignment-and-the-marketplace'],
  'content-manager': ['skills-assignment-and-the-marketplace', 'product-ideation-with-builderforce'],
  security: ['security-and-multi-tenant-architecture', 'approval-gates-and-human-oversight'],
  contributors: ['task-execution-and-observability', 'multi-agent-orchestration'],
  dashboard: ['introduction-and-overview', 'task-execution-and-observability', 'autonomous-swimlane-execution'],
  agents: ['builderforce-agents-and-agent-integration', 'fleet-management-and-agent-routing', 'multi-agent-orchestration'],
  prompts: ['specs-and-planning-with-ai', 'product-ideation-with-builderforce', 'getting-started-with-ai-agents'],
};
