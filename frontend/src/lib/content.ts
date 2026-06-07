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
  dateModified: '2026-04-17T00:00:00Z',
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
    aiExecutiveTeam: 'Builderforce.ai acts as your AI CTO, CIO and Security Officer — building your AI agent workforce, connecting your systems, and governing every action with approvals and an audit trail.',
    freeForever: 'Free plan is $0/month forever, no credit card required.',
    zeroGpuBills: 'All training runs on your local WebGPU device — zero cloud GPU bills.',
    browserNative: 'Fine-tune models up to 2 billion parameters directly in Chrome with WebGPU.',
    datasetSpeed: 'Generate an instruction-tuning dataset in under 30 seconds from a single capability prompt.',
    privacy: '100% private — your data and models never leave your browser during training.',
    autonomousExecution: 'Assign any BuilderForce Agent — Cloud or On-Premise — to a kanban swimlane and it executes the task autonomously: cloning the repo, writing code, and opening a pull request, advancing the board with no manual hand-offs.',
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
    icon: '🚦',
    title: 'Autonomous Swimlane Execution',
    shortDesc: 'Assign any agent to a board lane — tickets advance themselves.',
    longDesc: 'Assign any BuilderForce Agent — Cloud or On-Premise — to a kanban swimlane. When a ticket enters the lane the agent is dispatched automatically; on success the board advances to the next lane (or stops at a human approval gate), with no manual hand-offs.',
  },
  {
    icon: '🔀',
    title: 'Agents That Ship Code',
    shortDesc: 'Cloud agents clone, code & open a PR — no browser open.',
    longDesc: 'A Cloud BuilderForce Agent picks up a task, clones the bound repo through a secure server-side git proxy (your Git token never leaves the server), writes the change, pushes a branch, and opens a pull request — then reports back so the ticket auto-advances. It runs headless in the cloud; an On-Premise agent does the same on your own machine.',
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
      'Multi-agent orchestration (7 roles + DAG)',
      'Self-hosted + MIT + air-gapped',
      '30+ model providers incl. local Ollama',
      'Approval gates + audit trail',
      'Persistent project memory in .builderforce/',
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
    answer: 'Builderforce.ai is an AI platform that acts as your AI CTO, CIO and Security Officer. It builds, trains and deploys a custom AI agent workforce entirely in the browser (dataset generation, WebGPU LoRA training, AI evaluation, and the Workforce Registry), connects to your systems and data, and governs every action with approval gates and an audit trail.',
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
    answer: 'The blog covers AI agent training, WebGPU LoRA fine-tuning, dataset generation, multi-agent orchestration, BuilderForce Agents integration, and product development best practices.',
  },
  {
    question: 'Who writes the articles?',
    answer: 'Articles are written by Sean Hogg, founder of Builderforce.ai, covering practical guides and deep dives into the platform\'s architecture and capabilities.',
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
      { icon: '🏛', title: 'Architect', desc: 'Plan multi-step solutions and system designs before a single line of code is written.', href: '/architect' },
      { icon: '💻', title: 'IDE Workspace', desc: 'Monaco editor, terminal, AI chat, and file explorer in one collaborative project workspace.', href: '/ide' },
      { icon: '🎓', title: 'Training', desc: 'In-browser WebGPU LoRA fine-tuning up to 2B parameters with a live evaluation engine — zero GPU bills.', href: '/training' },
    ],
  },
  {
    id: 'orchestrate',
    icon: '🔀',
    title: 'Orchestrate',
    blurb: 'Coordinate work across agents, workflows, and a mesh of remote AgentHosts.',
    surfaces: [
      { icon: '🔀', title: 'Workflow Builder', desc: 'Compose agents and tools into repeatable, approval-gated workflows.', href: '/workflows/builder' },
      { icon: '☑', title: 'Task Management', desc: 'Track, assign, and watch tasks flow through your agent workforce.', href: '/tasks' },
      { icon: '🕸️', title: 'Workforce Mesh', desc: 'Discover and dispatch work across local and remote AgentHosts — capacity sharing across machines and tenants.', href: '/workforce' },
      { icon: '💬', title: 'Chats', desc: 'Talk to your agents directly, or watch them collaborate in shared conversations.', href: '/chats' },
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
      { icon: '✅', title: 'Approvals', desc: 'Human-in-the-loop approval gates on every sensitive action your agents take.', href: '/approvals' },
      { icon: '🔒', title: 'Security', desc: 'Per-tenant isolation and AES-256-GCM encrypted credentials for every integration.', href: '/security' },
      { icon: '📊', title: 'Observability', desc: 'Full telemetry and an audit trail of every agent action, token, and tool call.', href: '/observability' },
      { icon: '🏢', title: 'Tenants & Workspaces', desc: 'Multi-tenant workspaces with per-seat roles, members, and cost controls.', href: '/tenants' },
    ],
  },
];

/* ════════════════════ NAV LINKS ════════════════════ */

export interface NavLink {
  href: string;
  label: string;
}

export const FOOTER_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/product', label: 'Product' },
  { href: '/compare', label: 'Compare' },
  { href: '/marketplace', label: 'Workforce Registry' },
  { href: '/agents', label: 'BuilderForce Agents' },
  { href: '/blog', label: 'Blog' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login', label: 'Sign In' },
  { href: '/register', label: 'Get Started' },
];
