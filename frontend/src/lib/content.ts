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
  tagline: 'Build · Train · Deploy AI Agents',
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
      '1 Claw (CoderClaw instance)',
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
      'Up to 3 Claws',
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
      'Unlimited Claws',
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
    answer: 'Builderforce.ai is an end-to-end platform for building, training, and deploying custom AI agents entirely in the browser. Generate datasets, run LoRA training with WebGPU, evaluate with AI judges, and publish agents to the Workforce Registry.',
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
    question: 'Can I integrate Builderforce agents with CoderClaw?',
    answer: 'Yes — agents trained on Builderforce can be exported and deployed as CoderClaw hippocampus models. The platform supports the full pipeline from training custom SSM models to pushing them to your self-hosted CoderClaw gateway.',
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
    answer: 'Pro ($29/seat/month) includes everything in Free plus up to 3 Claws, unlimited projects, 1M tokens/day, approval workflows, fleet mesh, full telemetry, custom agent roles, and priority support.',
  },
  {
    question: 'Can I change plans at any time?',
    answer: 'Yes — you can upgrade or downgrade at any time from the Pricing & Billing page. Upgrades take effect immediately; downgrades apply at the end of your current billing period.',
  },
  {
    question: 'What is a Managed Claw?',
    answer: 'A Managed Claw ($49/month) is a hosted CoderClaw instance that Builderforce runs for you — no Docker, no DevOps. It connects to your workspace and runs your deployed agents.',
  },
  {
    question: 'Do you offer yearly billing?',
    answer: 'Yes — yearly billing is available for both Pro and Teams plans with savings of up to 20%. Select the yearly option during checkout.',
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
    answer: 'The blog covers AI agent training, WebGPU LoRA fine-tuning, dataset generation, multi-agent orchestration, CoderClaw integration, and product development best practices.',
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
    description: 'The coordination of multiple AI agents working together on complex tasks. Includes workflow sequencing, approval gates, fleet mesh networking, and remote dispatch across CoderClaw instances.',
  },
];

/* ════════════════════ NAV LINKS ════════════════════ */

export const MARKETING_NAV_LINKS = [
  { href: '/marketplace', label: 'Workforce' },
  { href: '/blog', label: 'Blog' },
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/login', label: 'Sign In' },
] as const;

export const FOOTER_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/marketplace', label: 'Workforce Registry' },
  { href: '/blog', label: 'Blog' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login', label: 'Sign In' },
  { href: '/register', label: 'Get Started' },
] as const;
