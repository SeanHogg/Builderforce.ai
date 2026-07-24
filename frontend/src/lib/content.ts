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
  tagline: 'The innovation platform for the agentic era',
  url: 'https://builderforce.ai',
  founder: { name: 'Sean Hogg', url: 'https://hired.video/resumes/seanhogg' },
  year: 2026,
  ogImage: '/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  /** ISO 8601 — update on each content deploy */
  dateModified: '2026-07-23T00:00:00Z',
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
    evermind: 'Evermind is Builderforce.ai\'s self-updating model and the brain of the platform, governed by Write-Through Cognition: new knowledge is written straight through so an update replaces what came before — reads are always current, there is never a reconciliation step, and it runs in the browser, on-device, or inside every agent.',
    systemOfRecord: 'Builderforce.ai is the system of record for the agentic enterprise: every unit of work — human or agent — is instrumented, costed, and attributed from idea to ship to learn, on one board governed by roles, approvals, and a full audit trail.',
    defineANeed: 'Builderforce.ai lets any human define a need in any modality — plain language, a dataset, a process chart, or a persona — and compiles it into an agent that runs in the IDE, on the desktop, or in the cloud: one AgentSpec spine, compiled from many inputs and deployed to many surfaces.',
    enterpriseInnovation: 'Builderforce.ai is an end-to-end innovation platform for the agentic era — plan, build, ship, and measure with a workforce of humans and AI agents on a single instrumented system, priced as a platform rather than per-seat enterprise software.',
    roleBasedInsight: 'Because every action is instrumented and costed, every role gets its own operating picture from the same data: delivery and DORA for engineering, cost and FinOps for finance, portfolio and innovation funnel for the PMO and CEO, and an immutable audit trail for security.',
    humanInLoopAgentic: 'Builderforce.ai is a human-in-the-loop, fully agentic cloud: train your own AI agents and put them to work inside your own agent, running a whole workforce from a Kanban board — all without ever leaving VS Code.',
    trainAndUseLoop: 'Train a custom agent, publish it to the Workforce Registry, then hire it and call it from inside your own agent — your trained specialists become tools your main agent delegates to.',
    neverLeaveVsCode: 'The BuilderForce VS Code extension runs the whole platform in your editor — chat with agents, assign and run tasks, review and validate their work, and approve actions without leaving VS Code.',
    aiExecutiveTeam: 'Builderforce.ai acts as your AI CTO, CIO and Security Officer — building your AI agent workforce, connecting your systems, and governing every action with approvals and an audit trail.',
    freeForever: 'Free plan is $0/month forever, no credit card required.',
    agenticTester: 'The Agentic Tester is an autonomous QA agent: point it at your app, give it logins, and it drives a real browser through your highest-traffic flows on a schedule — filing the bugs it finds straight onto your board.',
    collaboration: 'Builderforce.ai is a real-time collaboration platform for a mixed workforce of humans and AI agents: they share one Kanban board, chat in multi-party threads addressable to a person or an @agent, meet over live WebRTC video, and coordinate on shared calendars — from the web or inside VS Code.',
    teamChat: 'Builderforce.ai team chat is multi-party: threads are shared across a project, you invite humans by email and AI agents into the room, and you address each message to a specific participant — a message to a human just talks to them, while an @agent mention makes that agent reply and act on the board within your own permissions.',
    meetings: 'Builderforce.ai runs live video meetings over mesh WebRTC directly on your project board — cameras in standups and retros, a bookable team calendar with per-user availability and "Find a time", and Google/Microsoft calendar sync — joinable from the web or natively inside VS Code, with media flowing peer-to-peer and never through the server.',
    vsCodeCommandCenter: 'The BuilderForce VS Code extension is a command center for a workforce of humans and AI agents: multi-party team chat, live session status showing which runs are executing or need your answer, native video meetings, an Evermind training console, and human-in-the-loop approvals — all without leaving the editor.',
    zeroGpuBills: 'All training runs on your local WebGPU device — zero cloud GPU bills.',
    browserNative: 'Fine-tune models up to 2 billion parameters directly in Chrome with WebGPU.',
    datasetSpeed: 'Generate an instruction-tuning dataset in under 30 seconds from a single capability prompt.',
    privacy: '100% private — your data and models never leave your browser during training.',
  },
} as const;

/* ════════════════════ EVERMIND (the platform's brain) ════════════════════ */

export interface EvermindPillar {
  /** Emoji icon. */
  icon: string;
  title: string;
  desc: string;
}

/**
 * Evermind — Builderforce's self-updating model and the "brain" of the
 * platform (visualised by the homepage neural backdrop). Single source of truth
 * for Evermind marketing copy so it stays consistent across every surface.
 */
export const EVERMIND = {
  name: 'Evermind',
  eyebrow: 'Meet Evermind',
  tagline: 'A model that learns as it works — and never goes stale',
  /** Per-page SEO/GEO copy for the dedicated /evermind landing page. */
  seo: {
    title: 'Evermind — The Builderforce.ai LLM, a Self-Updating Model',
    description:
      'Evermind is the Builderforce.ai LLM: a self-updating model governed by Write-Through Cognition. Unlike frozen frontier models, new knowledge is written straight through so an update replaces what came before — no retrain, no reconciliation step. Runs on WebGPU in the browser, on-device, or inside every agent.',
    ogTitle: 'Evermind — The Self-Updating Builderforce.ai LLM',
  },
  blurb:
    'Evermind is the brain of Builderforce: a self-updating model governed by Write-Through Cognition. Frozen frontier models go out of date the moment they ship — every update needs a bolt-on retrain, fine-tune, or RAG patch. Evermind writes new knowledge straight through into the model, so an update simply replaces what was there. Reads always reflect the latest truth, there is never a reconciliation step, and it runs anywhere — in the browser, on-device, or inside every agent.',
  /** Quotable one-liner for AI citability / meta descriptions. */
  quotable:
    'Evermind is Builderforce.ai\'s self-updating model, governed by Write-Through Cognition: new knowledge is written straight through so an update replaces what came before — reads are always current, there is never a reconciliation step, and it runs in the browser, on-device, or inside every agent.',
  /** The key aspects the homepage brain animation represents. */
  pillars: [
    {
      icon: '🧠',
      title: 'Write-Through Cognition',
      desc: 'Knowledge is write-through: an update means replace, not append. Reads always reflect the latest truth and there is never a stale-then-reconcile step — the same invalidate-on-write rule the platform uses for caching, applied to the model\'s memory.',
    },
    {
      icon: '⚡',
      title: 'Shared-expert hybrid generator',
      desc: 'A dense always-on backbone carries continuous online learning, while lazily-loaded routed SSM experts page in on demand. You get specialist depth without a giant frozen blob — and it runs on WebGPU with zero runtime dependencies.',
    },
    {
      icon: '🔁',
      title: 'Write-through memory',
      desc: 'Every fact upserts by a stable key and invalidates its old recall, so the model never accumulates contradictory copies of the same truth. The knowledge loop corrects in place instead of drifting.',
    },
    {
      icon: '❤️',
      title: 'Limbic dynamics',
      desc: 'A trainable affective layer modulates how the model responds in the moment — personality as setpoints, limbic state as dynamics — so agents behave consistently with the persona you give them.',
    },
  ] as EvermindPillar[],
  /** Why Evermind beats a frozen frontier model — not on scale, on these axes. */
  edges: [
    { label: 'Currency', desc: 'Never stale — knowledge updates land in the model the moment they happen, with no retrain cycle.' },
    { label: 'Footprint', desc: 'Runs in any runtime — in the browser, on-device, or embedded in every agent via WebGPU.' },
    { label: 'Ownership', desc: 'Yours end to end — open packages, your data, no third-party model dependency.' },
  ],
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
    title: 'Evermind — The Self-Updating Model',
    shortDesc: 'A model that learns as it works and never goes stale.',
    longDesc: 'Evermind is the brain of the platform — a self-updating model governed by Write-Through Cognition: new knowledge is written straight through, so an update replaces what came before with no reconciliation step. A shared-expert hybrid generator (dense backbone + routed SSM experts) learns online and runs on WebGPU, so it wins on currency, footprint, and ownership rather than raw scale — in the browser, on-device, or inside every agent.',
  },
  {
    icon: '🎓',
    title: 'Distill a Frontier Model Into Your Own',
    shortDesc: 'Pin any frontier model as a teacher and train your own private model on its best answers.',
    longDesc: 'Pin any frontier LLM — Opus, Mistral, GLM and more — as a teacher for a project\'s Evermind. For every real piece of work your team ships, the teacher produces the ideal answer to that task and your own model learns from it, steadily absorbing frontier-level quality into a small model you own and run on-device. It\'s cost-gated and best-effort: it only spends when there\'s token budget, and a teacher miss falls back to learning from the raw work so a lesson is never lost.',
  },
  {
    icon: '🧠',
    title: 'A Learning Brain for Every Project',
    shortDesc: 'Every project gets its own self-updating model that learns from your team\'s work.',
    longDesc: 'Each project is provisioned with its own Evermind on day one — a self-updating model that learns from every run across all four studios: design, voice, LLM, and video. Corrections stick across sessions through a shared write-through fact store, so the brain that helped yesterday is smarter today. Inference stays off until you opt in, and the model is editable right in the LLM Studio.',
  },
  {
    icon: '🎬',
    title: 'Evermind Generative Media',
    shortDesc: 'Generate images and video from your own on-device model — not just text.',
    longDesc: 'Evermind is more than a text model. The same self-updating engine generates images and video end-to-end — a trainable codec and acoustic stack running on WebGPU, with the API serving the rendered media. Build a generation pipeline visually in the Workflow Builder, keep the weights and outputs yours, and produce media without a per-frame cloud bill or a third-party model dependency.',
  },
  {
    icon: '🐙',
    title: 'Native GitHub App — Checks, Actions & CI Gates',
    shortDesc: 'Agents work through a real GitHub App: Checks write-back, Actions runs, and CI-gated merges.',
    longDesc: 'Connect a first-class GitHub App and agents operate through the same controls your engineers do. Work is offloaded to GitHub with App-authenticated access, agent verdicts write back as native Checks, security alerts ingest onto the board, and a build-and-deploy pipeline runs real Actions — so a merge is gated on green CI, and a red PR-branch build auto-opens a fix. Observability that ends in a pull request, not a dashboard.',
  },
  {
    icon: '📨',
    title: 'Embeddable Product Feedback',
    shortDesc: 'Drop a snippet on any app to collect feedback — filed as human-gated work no agent can touch.',
    longDesc: 'The human-input twin of error observability. Embed a dependency-free, shadow-DOM feedback widget on any product surface and every submission lands on your board as a human-gated request — deduplicated by fingerprint, rate-limited per collector, and inert until a person approves it, so no agent acts on raw user input without a sign-off. Approve in triage and it becomes ordinary executable work a cloud agent can pick up.',
  },
  {
    icon: '🧑‍🏭',
    title: 'Agentic Workforce Kanban',
    shortDesc: 'Staff a deep role roster of humans and AI agents on a sign-off-gated board.',
    longDesc: 'Go beyond a to-do list: staff each project from a first-class job-role taxonomy — humans and AI agents in the same roster — starting from a recommended set built for your team. Swimlanes can require the right reviewer before a ticket advances, and every "Done" carries a per-ticket role and diagnostic sign-off audit, so quality is gated at the board rather than hoped for after the fact.',
  },
  {
    icon: '🧰',
    title: 'Kanban Template Marketplace',
    shortDesc: 'Buy, sell, and install ready-made board templates with lanes, roles, and gates.',
    longDesc: 'Package a delivery process — lanes, required roles, review gates, and a recommended roster — as a Kanban template, then publish it to the marketplace to sell or share. Install a proven template into any project in one click, so a team inherits a governed, role-gated workflow instead of assembling one from scratch.',
  },
  {
    icon: '✅',
    title: 'Validator Agent — Proof of Done',
    shortDesc: 'An agent that checks "Done" really is done and files the gaps it finds.',
    longDesc: 'Ad-hoc chat work becomes visible tickets automatically, and a built-in Validator agent reviews every item marked Done — recording a verdict and opening GAP tasks for anything that falls short. One shared merge-to-Done path covers human approval, green CI, and post-deploy, so nothing slips through as "finished" without proof.',
  },
  {
    icon: '🧭',
    title: 'Learned Model Routing',
    shortDesc: 'The platform learns which model is best — and cheapest — for each kind of task.',
    longDesc: 'Every run is scored on its outcome, and a learned router reorders which model handles each action type accordingly — cheaper models take the work they do well, premium models are reserved for where they earn it. Combined with the semantic cache, your token bill bends down as the platform learns your workload, with a one-flag kill switch whenever you want manual control.',
  },
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
    icon: '🎥',
    title: 'Live Meetings, Standups & Shared Calendars',
    shortDesc: 'Video standups, retros and calls — right on your board.',
    longDesc: 'See and hear your team, not just co-edit a board. Turn on cameras for the whole round-table during a standup, planning, or retro; start ad-hoc or direct calls; and run it all over mesh WebRTC so media flows peer-to-peer and never touches the server. A shared team calendar overlays your meetings and connected Google/Microsoft events, shades each person\'s availability, and "Find a time" proposes slots where every invitee is genuinely free. Join from the web or natively inside VS Code.',
  },
  {
    icon: '💬',
    title: 'Multi-Party Team Chat — Humans + Agents',
    shortDesc: 'Shared threads you can address to a person or an @agent.',
    longDesc: 'Chat is real collaboration, not a solo prompt box. Threads are shared across your project, you invite humans by email and AI agents into the room, and you address each message to a specific participant. Talk to a teammate and the agent loop stays idle; @-mention an agent and it replies as itself — running a bounded, permission-scoped tool loop to create a task, update an OKR, or read the board, never exceeding your own access. The same conversation works on the web and in VS Code.',
  },
  {
    icon: '🧪',
    title: 'Agentic Tester — Autonomous QA',
    shortDesc: 'An AI agent that browser-tests your app on a schedule.',
    longDesc: 'The Agentic Tester is a hireable QA agent. Point it at your project\'s URL, save the logins it should use, and it drives a real browser through your highest-traffic flows — ranking what to test from real usage heatmaps, logging in as each persona, and capturing console errors, failed requests, and crashes. Run it on demand or schedule it as part of a workflow; every bug it finds lands straight on your Kanban board.',
  },
  {
    icon: '💼',
    title: 'Hire Human Talent',
    shortDesc: 'Bring on freelance developers, DBAs and designers — and pay only for tracked time.',
    longDesc: 'Beyond AI agents, hire real people: the Talent Marketplace lists vetted freelance developers, DBAs, designers and specialists with résumés (powered by hired.video), skills and hourly rates. Interview, hire across any project, and see billable hours captured automatically from the work they do in the portal and VS Code — every timecard is yours to approve before you pay. Humans and agents work side by side on the same board.',
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
    icon: '🗺️',
    title: 'Planning Spine — Portfolio to Task',
    shortDesc: 'One dated, cost-bearing hierarchy on a single Gantt.',
    longDesc: 'Plan, deliver, and account for work on one hierarchy: portfolio → initiative → epic → task, with Objectives and Key Results attaching at any level. Every leaf\'s cost — LLM spend priced at write time plus human effort — rolls up to every ancestor and is split CAPEX vs OPEX, with anomaly flags where a capitalization decision needs sign-off. Engineering plans on it, the PMO rolls portfolios up on it, and finance closes from it — one set of numbers, no reconciliation step.',
  },
  {
    icon: '🐞',
    title: 'Error Observability + One-Click Agent Fix',
    shortDesc: 'Crash to pull request on a single surface.',
    longDesc: 'Ingest runtime errors from your browser SDK, OpenTelemetry, Sentry, PostHog, or LogRocket; group them by fingerprint into deduplicated error groups with occurrence and affected-user counts; then turn any group into a fix task a cloud agent picks up and ships as a pull request. Observability that doesn\'t end at a dashboard — the same platform that surfaces the crash assigns it, fixes it, and PRs it.',
  },
  {
    icon: '📚',
    title: 'Knowledge Management & Compliance',
    shortDesc: 'Versioned SOPs with an audit-ready acknowledgement trail.',
    longDesc: 'A versioned base for SOPs, processes, and docs with immutable publish snapshots, timestamped read-acknowledgements, and per-user overdue tracking — audit-ready evidence for SOX, TISAX, and ISO 27001. Author and improve documents with AI, co-edit in real time, and gate access per page. The same knowledge that proves compliance also grounds your agents.',
  },
  {
    icon: '🔗',
    title: 'Single-Pane Board Connectors',
    shortDesc: 'Two-way sync with Jira, Linear, Sentry, PagerDuty & more.',
    longDesc: 'Connect the trackers and incident tools you already run — Jira, Linear, monday, Asana, ClickUp, ServiceNow, Freshservice, Sentry, PagerDuty, and GitHub — and sync work two-ways. Agents pick up and act on a ticket or incident wherever it originates, and changes flow back to the system of record. One pane to orchestrate across everything, with no migration and no lock-in.',
  },
  {
    icon: '🚨',
    title: 'Incident Management & On-Call',
    shortDesc: 'A help-desk agent, on-call rotations, escalation, paging, and a war-room — that learn.',
    longDesc: 'Run incidents where the work already lives. A Help-Desk / Incident-Manager agent triages, on-call rotations decide who is paged, timed escalation walks the chain, and Teams, Slack, or email paging reaches the responder — with a per-incident war-room feed for humans and agents together. When it resolves, the root-cause analysis is published to your Knowledge base and fed to the project\'s Evermind, so the workforce learns and stops repeating the same failure.',
  },
  {
    icon: '📡',
    title: 'Active Monitoring Canvas',
    shortDesc: 'Pin live monitors onto your architecture diagram — a breach starts the investigation.',
    longDesc: 'Upload your architecture diagram and pin heartbeat, HTTP, webhook, or metric monitors directly onto the systems they watch. A sweep evaluates them every five minutes, and a breach doesn\'t just light up red — it auto-starts the on-call investigation: monitor → signal → incident → paging, on one surface. Monitoring that opens the ticket and calls the responder instead of just drawing a chart.',
  },
  {
    icon: '⚖️',
    title: 'Role-Gated Accountability',
    shortDesc: 'Proof that the right role did each part of the work — an immutable sign-off record.',
    longDesc: 'Every ticket carries a participation manifest: the roles it requires, resolved to the humans and agents capable of each — so a Product Manager is never dispatched to write code and a producer stage runs a producer. An append-only Accountability Report records Who, When, Verdict, Comments, and Contribution per role, gated by default-deny sign-off permissions, with a Resource Assessment that flags a missing role as a blocking gap. Quality is proven at the board, not hoped for after the fact.',
  },
  {
    icon: '📄',
    title: 'Automated RFP & Proposal Response',
    shortDesc: 'Turn an analyzed codebase into a branded, costed proposal.',
    longDesc: 'Answer a request for proposal from what you\'ve already built. CTO and Product-Owner agents read a project\'s analyzed capabilities and generate a co-branded proposal — cost and P&L, a phased delivery Gantt, risks, dependencies, and a capability roster matched to the ask — blending the requester\'s brand palette and logo with yours. Freshness-gated grounding re-scans a stale project before it answers, so the proposal reflects the real system.',
  },
  {
    icon: '🧑‍💼',
    title: 'AI Managers & Coaching',
    shortDesc: 'Typed managers you can coach — Dev, QA, Service-Desk, DevOps.',
    longDesc: 'Managers aren\'t generic. A manager type — Dev, QA, Service-Desk, DevOps, or a custom role from your catalog — shapes how a manager agent runs its reports. When one gets it wrong, a human runs a Coaching Session: a directive or a task, with an expiry and a done state, that steers the manager\'s behavior going forward. Feedback becomes durable guidance, not a one-off correction lost to the next run.',
  },
  {
    icon: '⚡',
    title: 'Memory-First Answering',
    shortDesc: 'Answer from the project\'s own memory before spending a paid model call.',
    longDesc: 'The cheapest token is the one you never spend. Before a paid model call, the Brain consults the project\'s own memory — an exact-repeat question-and-answer cache plus opt-in inference on the project\'s Evermind — and short-circuits the LLM entirely on a confident hit. Learning fans out to every Evermind under the project (its own and its IDE builds\'), so a lesson taught once answers everywhere. Your token bill falls as the project\'s memory grows.',
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
    icon: '🎯',
    title: 'Grounded RAG & Answer Evaluation',
    shortDesc: 'Hybrid retrieval, plus faithfulness & drift scoring.',
    longDesc: 'The full retrieval-and-evaluation stack, built in. Memory uses hybrid retrieval — dense embeddings and BM25 keyword search fused with Reciprocal Rank Fusion and reranked with MMR for relevance and diversity, over chunked documents. Every run is then scored for faithfulness, answer relevance, and hallucination rate, and a drift monitor flags when a model\'s quality regresses over time — so a wrong answer never hides behind a green dashboard.',
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
      'Evermind self-updating model (on-device)',
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
    description: 'Org-wide volume pricing (5-seat minimum) with shared approval inbox and per-seat controls.',
    features: [
      'Everything in Pro',
      '5-seat minimum (org-wide volume pricing)',
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

/* ════════════════════ MEDIA KIT ════════════════════ */

export interface MediaAsset {
  /** Stable key — localized name/description live at `media.assets.<key>.*`. */
  key: 'pdf' | 'pptx' | 'slides';
  href: string;
  /** Non-translatable format token shown on the download card. */
  format: string;
  /** Approximate download size, shown verbatim. */
  size: string;
}

/**
 * Downloadable marketing media (the sales deck + per-slide PNGs), served from
 * `public/media/`. Regenerated by `Builderforce.ai/marketing/pitch-deck/`
 * (see its README) — copy new builds into `public/media/` to update the site.
 */
export const MEDIA_KIT: { cover: string; coverWidth: number; coverHeight: number; assets: MediaAsset[] } = {
  cover: '/media/deck-cover.png',
  coverWidth: 1280,
  coverHeight: 720,
  assets: [
    { key: 'pdf', href: '/media/Builderforce-Pitch-Deck.pdf', format: 'PDF', size: '5 MB' },
    { key: 'pptx', href: '/media/Builderforce-Pitch-Deck.pptx', format: 'PPTX', size: '11 MB' },
    { key: 'slides', href: '/media/Builderforce-Deck-Slides.zip', format: 'ZIP · 26 PNG', size: '11 MB' },
  ],
};

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
      { feature: 'Price', note: 'Self-hosted runtime is MIT (free); the hosted Cloud platform is a Free/Pro/Teams SaaS.', values: { builderforce: 'Free (MIT) self-hosted · Cloud from $0', copilot: '$19/user/mo', cursor: '$20/user/mo', claudeCode: 'Usage-based', devin: '$500/mo', openhands: 'Free (MIT)', aider: 'Free (MIT)', continueDev: 'Free (MIT)' } },
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
    id: 'self-improving',
    title: 'Self-Improving Models & Proof of Done',
    blurb: 'Models that learn from your work, route themselves by outcome, and prove that "Done" is really done — capabilities frozen single-agent tools structurally lack.',
    rows: [
      { feature: 'Trains your own model on your work', note: 'Frontier-model teacher distillation', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Self-updating model per project', note: 'Evermind, runs on-device', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Learned, outcome-based model routing', note: 'scores runs, reorders models', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Validator agent — proof of Done', note: 'opens GAP tasks on shortfall', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Role-gated board with sign-off audit', note: 'per-ticket role + diagnostic', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
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
      { feature: 'Semantic answer evaluation', note: 'faithfulness / relevance / hallucination', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
      { feature: 'Quality-drift monitoring', note: 'per-model regression alerts', values: { builderforce: '✅', copilot: '❌', cursor: '❌', claudeCode: '❌', devin: '❌', openhands: '❌', aider: '❌', continueDev: '❌' } },
    ],
  },
  {
    id: 'codebase-context',
    title: 'Codebase Understanding & Editing',
    blurb: 'How deeply the tool reads your repo and how cleanly it stages changes for review.',
    rows: [
      { feature: 'Codebase semantic search', values: { builderforce: '✅', copilot: '⚠️', cursor: '✅', claudeCode: '⚠️ Basic RAG', devin: '✅', openhands: '⚠️ Basic', aider: '⚠️ Git-aware', continueDev: '✅' } },
      { feature: 'Hybrid retrieval (dense + BM25 + rerank)', note: 'RRF fusion + MMR diversity', values: { builderforce: '✅', copilot: '❌', cursor: '⚠️ Vector only', claudeCode: '⚠️ Vector only', devin: '⚠️ Vector only', openhands: '⚠️ Vector only', aider: '⚠️ Git-aware', continueDev: '⚠️ Vector only' } },
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
    'Most AI coding tools are powerful autocomplete engines that stop at the file boundary. Builderforce.ai operates one level up: it is the system of record for agentic work — building, training and deploying an AI agent workforce, connecting to your systems, instrumenting and costing every action, and governing it with roles, approvals and an audit trail. The tables below compare Builderforce.ai against the tools teams evaluate most often, focused on the capabilities that separate running an innovation organization from finishing a line.',
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
    question: 'What is Evermind?',
    answer: 'Evermind is the brain of Builderforce.ai — a self-updating model governed by Write-Through Cognition. Instead of freezing knowledge at training time like a conventional frontier model, Evermind writes new knowledge straight through into the model, so an update replaces what came before with no reconciliation step and reads always reflect the latest truth. It is built from a shared-expert hybrid generator (a dense backbone that learns online plus routed SSM experts that page in on demand), a write-through knowledge memory that upserts by stable key, and a trainable limbic layer for dynamics. It runs on WebGPU in the browser, on-device, or inside every agent, and is designed to win on currency, footprint, and ownership rather than raw scale.',
  },
  {
    question: 'What is Builderforce.ai?',
    answer: 'Builderforce.ai is the innovation platform for the agentic era — a single system of record where every unit of work, done by a human or an AI agent, is instrumented, costed, and attributed from idea to ship to learn. You plan, build, ship, and measure with one workforce of humans and agents on a Kanban board, train your own agents in the browser (dataset generation, WebGPU LoRA training, AI evaluation, and the Workforce Registry), connect to your systems and data, and govern every action with roles, approval gates, and a full audit trail — all without leaving VS Code.',
  },
  {
    question: 'Is Builderforce.ai an enterprise platform?',
    answer: 'Yes — it is built to operate like an enterprise system of record, without enterprise pricing. Because every action (human or agent) is instrumented and costed, the whole organization works from one source of truth instead of stitching together a board, a code host, an observability tool, a FinOps tool, and spreadsheets. Each role gets its own operating picture from the same data: delivery and DORA for engineering, cost and budgets for finance, portfolio rollup and the innovation funnel for the PMO and CEO, and an immutable audit trail for security. Access is governed by workspace roles (owner, manager, developer, viewer), so people see what their role allows.',
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
    question: 'Can I plan and cost work from portfolio down to task?',
    answer: 'Yes — that is the Planning Spine. Portfolio, initiative, epic, and task live on one dated hierarchy (with Objectives and Key Results attaching at any level), rendered as a single Gantt. Because every task is instrumented, its cost — LLM spend priced at write time plus human effort — rolls up to every ancestor and is split CAPEX vs OPEX, with anomaly flags where a capitalization decision needs sign-off. Engineering, the PMO, and finance read the same numbers, and the whole spine exports to CSV.',
  },
  {
    question: 'Can Builderforce fix the errors it monitors?',
    answer: 'Yes. The Quality pillar ingests runtime errors from a browser SDK, OpenTelemetry, Sentry, PostHog, or LogRocket, groups them by fingerprint into deduplicated error groups, then turns any group into a fix task a cloud agent picks up and ships as a pull request. Unlike a monitoring dashboard that ends at a stack trace, the same platform that surfaces the crash assigns it, fixes it, and opens the PR.',
  },
  {
    question: 'Can my team meet over video in Builderforce?',
    answer: 'Yes. Builderforce runs live video and audio meetings over mesh WebRTC directly on your project board — turn on cameras for a standup, planning, or retro round-table, or start ad-hoc and direct calls. Media flows peer-to-peer and never touches the server. A shared team calendar overlays your meetings and connected Google or Microsoft Calendar events, shades each person\'s availability, and "Find a time" proposes slots where every invitee is genuinely free. You can join a meeting from the web or natively inside VS Code.',
  },
  {
    question: 'Can I chat with both humans and AI agents in the same thread?',
    answer: 'Yes — that is multi-party team chat. Threads are shared across your project, you invite humans by email and AI agents into the room, and you address each message to a specific participant. A message to a human just talks to them (the agent loop stays idle); an @agent mention makes that agent reply as itself and run a bounded, permission-scoped tool loop to create a task, update an OKR, or read the board — never exceeding your own access. The same conversation works on the web and in VS Code.',
  },
  {
    question: 'Do I have to migrate off Jira or Linear to use Builderforce?',
    answer: 'No. Board connectors sync work two-ways with the tools you already run — Jira, Linear, monday, Asana, ClickUp, ServiceNow, Freshservice, Sentry, PagerDuty, and GitHub. Agents pick up and act on a ticket or incident wherever it originates, and changes flow back to the system of record. You get one pane to orchestrate across everything with no migration and no lock-in.',
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
    question: 'Can Builderforce manage incidents and on-call?',
    answer: 'Yes. Builderforce runs incidents end-to-end: a Help-Desk / Incident-Manager agent triages, on-call rotations decide who is paged, timed escalation walks the chain, and Teams, Slack, or email paging reaches the responder — with a per-incident war-room feed for humans and agents. Monitors pinned onto your architecture diagram sweep every five minutes and a breach auto-starts the investigation. When an incident resolves, its root-cause analysis is published to your Knowledge base and fed to the project\'s Evermind, so the workforce learns and stops repeating the same failure.',
  },
  {
    question: 'How does Builderforce prove the right role did each part of the work?',
    answer: 'Every ticket carries a participation manifest — the roles it requires, resolved to the humans and agents capable of each, so a Product Manager is never dispatched to write code. An append-only Accountability Report records Who, When, Verdict, Comments, and Contribution per role, gated by default-deny sign-off permissions, with a Resource Assessment that flags a missing role as a blocking gap. Quality is proven at the board with an immutable record, not hoped for after the fact.',
  },
  {
    question: 'Can Builderforce answer without spending tokens on a model?',
    answer: 'Yes. Before a paid model call, the Brain consults the project\'s own memory — an exact-repeat question-and-answer cache plus opt-in inference on the project\'s Evermind — and short-circuits the LLM entirely on a confident hit. Learning fans out to every Evermind under a project, so a lesson taught once answers everywhere. Combined with the semantic response cache, the token bill falls as the project\'s memory grows.',
  },
  {
    question: 'Can Builderforce respond to an RFP or RFQ?',
    answer: 'Yes. CTO and Product-Owner agents turn an analyzed project into a branded, costed proposal — cost and P&L, a phased delivery Gantt, risks, dependencies, and a capability roster matched to the ask — co-branded with the requester\'s palette and logo. Freshness-gated grounding re-scans a stale project before it answers, so the proposal reflects the real system. RFP responses live as a tab on the project itself.',
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
    answer: 'Yes — models trained on Builderforce can be exported and published as Evermind models that your self-hosted BuilderForce Agents gateway calls directly as the model, not just as a memory layer. The platform supports the full pipeline: train a custom SSM in the browser, publish it, and route live traffic to it over the OpenAI-compatible API.',
  },
  {
    question: 'Can I train my own model on a frontier model\'s answers?',
    answer: 'Yes — that is teacher distillation. Pin any frontier LLM (Opus, Mistral, GLM and more) as a teacher for a project\'s Evermind. For each real piece of work your team ships, the teacher produces the ideal answer to that task, and your own model learns from that exemplar instead of the raw text — so it steadily absorbs frontier-level quality into a small model you own and run on-device. It is cost-gated (it only spends when you have token budget) and best-effort (a teacher miss falls back to learning from the raw work), so a lesson is never lost.',
  },
  {
    question: 'Does each project get its own model?',
    answer: 'Yes. Every project is provisioned with its own Evermind on creation — a self-updating model that learns from every run across all four studios (design, voice, LLM, and video) through one shared learning mechanism. Corrected facts persist across sessions in a write-through fact store shared by the web app, VS Code, cloud, and on-prem agents, so the brain that helped yesterday is smarter today. Inference stays off until you opt in, and the model is editable in the LLM Studio.',
  },
  {
    question: 'Can I gate my board so only the right role can finish a ticket?',
    answer: 'Yes — that is the Agentic Workforce Kanban. Staff each project from a first-class job-role taxonomy of humans and AI agents, and configure swimlanes to require the right reviewer before a ticket can advance. Every item marked Done carries a per-ticket role and diagnostic sign-off audit, and a role-coverage diagnostic flags gaps on the board, so quality is enforced rather than assumed.',
  },
  {
    question: 'How does Builderforce check that work marked Done is really done?',
    answer: 'A built-in Validator agent reviews every item marked Done, records a verdict, and opens GAP tasks for anything that falls short. Ad-hoc chat work is also captured as visible tickets automatically, and one shared merge-to-Done path covers human approval, green CI, and post-deploy — so nothing is reported as finished without proof.',
  },
  {
    question: 'Can I buy or sell a Kanban board template?',
    answer: 'Yes. Package a delivery process — lanes, required roles, review gates, and a recommended roster — as a Kanban template and publish it to the marketplace to sell or share. Any team can install a proven template into a project in one click and inherit a governed, role-gated workflow instead of building one from scratch.',
  },
];

/** Evermind page FAQ — GEO-targeted Q&As for "Builderforce LLM / self-updating model" intent. */
export const EVERMIND_FAQ: FaqItem[] = [
  {
    question: 'What is Evermind?',
    answer: 'Evermind is the Builderforce.ai LLM — the self-updating model at the brain of the platform. It is governed by Write-Through Cognition: new knowledge is written straight through into the model, so an update replaces what came before with no reconciliation step, and reads always reflect the latest truth. Evermind is built from a shared-expert hybrid SSM generator (a dense always-on backbone plus lazily-loaded routed experts), a write-through knowledge memory, and a trainable limbic layer for dynamics, and it runs on WebGPU in the browser, on-device, or inside every agent.',
  },
  {
    question: 'What is the Builderforce.ai LLM?',
    answer: 'The Builderforce.ai LLM is Evermind. Rather than relying on a frozen third-party frontier model, Builderforce.ai runs its own self-updating model that learns as it works. Frontier LLMs can still be routed to when you want them, but Evermind is the native model that gives the platform currency (never stale), a small footprint (runs on-device), and full ownership (your data, open packages, no third-party model dependency).',
  },
  {
    question: 'What is Write-Through Cognition?',
    answer: 'Write-Through Cognition is the governing principle of Evermind. Knowledge is written straight through into the model, so an update is an upsert by a stable key plus an invalidation of the old recall — an update means replace, not append. Reads always reflect the latest truth and there is never a stale-then-reconcile step. It is the same invalidate-on-write rule used for caching, applied to a model\'s knowledge tier so it can never quietly drift out of date.',
  },
  {
    question: 'How is Evermind different from a frozen LLM like GPT or Claude?',
    answer: 'Frozen frontier models fix their knowledge at training time; updating them means a bolt-on retrain, fine-tune, RAG pipeline, or hand-edit — each a separate reconciliation step. Evermind writes new knowledge directly into the model, so it never accumulates contradictory copies of the same fact and never needs a reconcile pass. It is designed to win not on raw parameter count but on three axes a frozen model structurally trades away: currency, footprint, and ownership.',
  },
  {
    question: 'Does Evermind run on-device or in the browser?',
    answer: 'Yes. Evermind runs on WebGPU, so it executes in the browser, on-device, or embedded inside every agent, with zero runtime dependencies. The same model and its write-through memory travel wherever the agent runs, which is what lets agents carry correct knowledge across sessions without a cloud round-trip.',
  },
  {
    question: 'Can I use Evermind inside my own agents?',
    answer: 'Yes. Evermind is the model behind the platform\'s agents, and its write-through memory and recall are available to the agents you run — so a corrected fact stays corrected across sessions. You can also train custom specialist models in the browser (WebGPU LoRA) and publish them to the Workforce Registry to call from inside your own agent.',
  },
  {
    question: 'How does Evermind stay up to date without retraining?',
    answer: 'Through its shared-expert hybrid generator and write-through memory. A dense always-on backbone carries continuous online learning while routed experts page in on demand, and every new fact upserts by a stable key and invalidates its prior recall. New knowledge lands in the model the moment it happens, so there is no retrain cycle and no knowledge cutoff you do not control.',
  },
  {
    question: 'Does Evermind have benchmarks — how do I know a model I train is any good?',
    answer: 'Yes. Every model you train in the Studio is scored on-device before you publish it. The built-in benchmarking harness holds out a slice of your corpus the model never trains on, then reports the standard language-model yardsticks — held-out perplexity, bits-per-token, top-1 and top-k next-token accuracy, and generation throughput — plus a held-out coding pass@1 gate that runs generated solutions against unseen test cases, so a model is measured on whether it actually writes passing code, not just on perplexity. It can A/B two checkpoints so you can see whether a fresh adaptation actually improved on the last one, runs entirely in your browser with no GPU bill and no data leaving your machine, and is the open measurement instrument behind the Evermind technical report.',
  },
  {
    question: 'Can Evermind learn from a frontier model like Opus or Mistral?',
    answer: 'Yes — through teacher distillation. You can pin any frontier LLM (Opus, Mistral, GLM and more) as a teacher for a project\'s Evermind. For each real task your team ships, the teacher is asked for the ideal answer through the metered gateway, and the SSM adapts on the pair of (task context → teacher exemplar) rather than on the raw run text. Over time your own small, on-device model absorbs the quality of a much larger one, while you keep ownership and currency. The teacher call is cost-gated to your token budget and best-effort — a miss falls back to learning from the raw work — so distillation never stalls the learning loop.',
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

/**
 * Register page — right-hand marketing panel, one variant per account type the
 * chooser toggles between: `standard` (Build with AI) and `freelancer` (Get
 * hired). Single source of truth so the panel copy stays consistent with the
 * rest of the marketing site; the register client switches on `accountType`.
 */
export interface RegisterMarketingVariant {
  /** Short eyebrow tag shown above the heading. */
  eyebrow: string;
  heading: string;
  intro: string;
  /** Four headline metrics rendered as stat cards. */
  stats: { value: string; label: string }[];
  /** Value-prop bullets (emoji + one line). */
  bullets: { icon: string; title: string; desc: string }[];
  /** Pull-quote reinforcing the differentiator. */
  quote: string;
  faq: FaqItem[];
}

export const REGISTER_MARKETING: Record<'standard' | 'freelancer', RegisterMarketingVariant> = {
  standard: {
    eyebrow: 'Build with AI',
    heading: 'Your AI Agent Workspace Awaits',
    intro:
      'Train custom AI agents in your browser, put them to work on a live Kanban board alongside your team, and orchestrate the whole workforce without ever leaving VS Code.',
    stats: [
      { value: '$0', label: 'Free forever' },
      { value: '14 days', label: 'Pro trial included' },
      { value: '2B+', label: 'Params in-browser' },
      { value: '0%', label: 'Agent commission' },
    ],
    bullets: [
      { icon: '🧠', title: 'Evermind', desc: 'A self-updating model that learns as it works and never goes stale.' },
      { icon: '🔁', title: 'Train & reuse agents', desc: 'WebGPU LoRA fine-tuning, then call your specialists from inside your agent.' },
      { icon: '▦', title: 'Live Kanban workforce', desc: 'Humans and AI agents ship on the same board, backlog to done.' },
      { icon: '🧩', title: 'Never leave VS Code', desc: 'Chat, assign, review, and approve — all inside your editor.' },
      { icon: '🧪', title: 'Agentic Tester', desc: 'An autonomous QA agent that browser-tests your app and files bugs.' },
      { icon: '🗺️', title: 'Planning Spine', desc: 'Portfolio → task on one dated, cost-bearing Gantt with CAPEX/OPEX rollup.' },
    ],
    quote:
      'Unlike cloud training platforms that charge per GPU-hour, Builderforce runs training on your local WebGPU device at zero cost.',
    faq: REGISTER_FAQ,
  },
  freelancer: {
    eyebrow: 'Get hired',
    heading: 'Get Hired. Get Paid for Every Hour.',
    intro:
      'Publish a for-hire profile with your hired.video résumé, get discovered across every team on the platform, and let your billable hours capture themselves as you work in the portal and VS Code.',
    stats: [
      { value: '0%', label: 'Commission on your rate' },
      { value: 'Auto', label: 'Time tracked as you work' },
      { value: 'Cross-tenant', label: 'Gigs from any team' },
      { value: 'hired.video', label: 'Résumé built in' },
    ],
    bullets: [
      { icon: '💼', title: 'For-hire profile', desc: 'Set your rate, showcase skills, go public or stay invite-only.' },
      { icon: '🎬', title: 'hired.video résumé', desc: 'Your video résumé travels with your profile — no re-uploading.' },
      { icon: '🔎', title: 'Find Work', desc: 'Browse and get matched to gigs across every tenant on Builderforce.' },
      { icon: '⏱️', title: 'Automatic timecards', desc: 'Billable hours are captured from real activity — no manual logging.' },
      { icon: '🤝', title: 'Work beside AI agents', desc: 'Sit on the same board as humans and agents on any project you join.' },
      { icon: '✅', title: 'Approve-then-pay', desc: 'Every timecard is reviewed before payment, so billing stays clean.' },
    ],
    quote:
      'Keep 100% of your rate — Builderforce takes zero commission, and every billable hour is captured automatically from the work you actually do.',
    faq: [
      {
        question: 'Does Builderforce take a commission on my rate?',
        answer: 'No. Builderforce charges zero commission on freelance engagements — you keep 100% of your hourly rate. Clients pay for tracked, approved hours only.',
      },
      {
        question: 'How are my hours tracked?',
        answer: 'Billable hours are captured automatically from the activity you generate in the portal and the VS Code extension. You never fill in a manual timesheet, and every timecard is yours (and the client\'s) to review before payment.',
      },
      {
        question: 'Who can see my profile?',
        answer: 'You choose. A for-hire profile can be public (discoverable by any team on the platform) or private (visible only to teams you share it with). Either way it carries your skills, hourly rate, and hired.video résumé.',
      },
      {
        question: 'Do I need my own clients to start?',
        answer: 'No. Once your profile is live you can browse Find Work and get matched to gigs from any tenant on Builderforce, then interview and get hired across projects — all without leaving the platform.',
      },
    ],
  },
};

/**
 * Login page — right-hand marketing panel. Login has no account-type chooser, so
 * it's a single variant (reusing the register panel's shape so the two auth
 * surfaces stay visually identical). Copy is welcome-back framed but still sells
 * the platform to logged-out visitors who land here. Uses the `standard`
 * MarketingVisual (the agent-workforce graph).
 */
export const LOGIN_MARKETING: RegisterMarketingVariant = {
  eyebrow: 'Welcome back',
  heading: 'Pick Up Right Where You Left Off',
  intro:
    'Sign in to your AI agent workspace — your trained models, live Kanban board, and the whole agent workforce are exactly where you left them.',
  stats: [
    { value: '$0', label: 'Free forever' },
    { value: '<60s', label: 'To sign in' },
    { value: '2B+', label: 'Params in-browser' },
    { value: '0%', label: 'Agent commission' },
  ],
  bullets: [
    { icon: '🧠', title: 'Evermind', desc: 'A self-updating model that learns as it works and never goes stale.' },
    { icon: '🔁', title: 'Your trained agents', desc: 'Call the specialists you fine-tuned with WebGPU LoRA, right where you left them.' },
    { icon: '▦', title: 'Live Kanban workforce', desc: 'Humans and AI agents ship on the same board, backlog to done.' },
    { icon: '🧩', title: 'Never leave VS Code', desc: 'Chat, assign, review, and approve — all inside your editor.' },
    { icon: '🔑', title: 'Passwordless sign-in', desc: 'Magic links and OAuth with Google, GitHub, LinkedIn, and Microsoft.' },
    { icon: '🧪', title: 'Agentic Tester', desc: 'An autonomous QA agent that browser-tests your app and files bugs.' },
  ],
  quote:
    'Your work stays yours — Builderforce runs training on your local WebGPU device at zero cost, with no GPU bills and no vendor lock-in.',
  faq: LOGIN_FAQ,
};

/** Blog index FAQ */
export const BLOG_FAQ: FaqItem[] = [
  {
    question: 'What topics does the Builderforce blog cover?',
    answer: 'The blog covers AI agent training, WebGPU LoRA fine-tuning, dataset generation, multi-agent orchestration, autonomous Kanban (swimlane) execution, cross-surface semantic caching for token savings, the Planning Spine (cost-bearing portfolio-to-task delivery), error observability with one-click agent fixes, knowledge management and compliance, autonomous QA with the Agentic Tester, single-pane board connectors, BuilderForce Agents integration, and product development best practices.',
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
    name: 'Evermind',
    description: 'Builderforce.ai\'s self-updating model and the brain of the platform. It is governed by Write-Through Cognition, built from a shared-expert hybrid SSM generator (a dense always-on backbone plus lazily-loaded routed experts), a write-through knowledge memory, and a trainable limbic layer for dynamics. It runs on WebGPU in the browser, on-device, or inside every agent, and is designed to beat frozen frontier models on currency, footprint, and ownership rather than raw scale.',
  },
  {
    name: 'Write-Through Cognition',
    description: 'The governing principle of Evermind: knowledge is written straight through into the model, so an update replaces what came before instead of being appended alongside it. Reads always reflect the latest truth and there is never a stale-then-reconcile step — the same invalidate-on-write rule used for caching, applied to a model\'s knowledge tier so it can never drift out of date.',
  },
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
  {
    name: 'System of record for agentic work',
    description: 'A single platform where every unit of work — performed by a human or an AI agent — is captured, costed, and attributed across its whole lifecycle from idea to ship to learn. Builderforce.ai instruments every task transition, agent run, LLM call, and deployment, so the same data answers what was built, by whom (human or agent), at what cost, and whether it worked — without stitching together a board, a code host, an observability tool, and a spreadsheet.',
  },
  {
    name: 'AI FinOps',
    description: 'The financial-operations discipline of attributing, budgeting, and forecasting the cost of AI work. On Builderforce.ai every token and task is priced at write time and rolled up ticket → project → initiative → tenant, so finance can see cost-per-outcome (such as cost per merged pull request), set budgets, and forecast spend instead of reconciling vendor invoices after the fact.',
  },
  {
    name: 'Innovation funnel',
    description: 'The end-to-end pipeline an idea travels on Builderforce.ai — idea → validated → in-build → shipped → measured — with conversion and time-to-value tracked at each stage. It gives executives a throughput-and-ROI view of innovation the way a sales funnel gives a revenue view of pipeline.',
  },
  {
    name: 'Role-based insight lens',
    description: 'A view onto the same instrumented work tailored to a role: delivery and DORA metrics for engineering, cost and FinOps for finance, portfolio rollup and the innovation funnel for the PMO and CEO, and an immutable audit trail for security. Because the data is collected once and attributed, each lens is a projection of one source of truth rather than a separate report.',
  },
  {
    name: 'Planning Spine',
    description: 'Builderforce.ai\'s single dated hierarchy that unifies planning, delivery, and cost — portfolio → initiative → epic → task, with Objectives and Key Results attaching as a goal layer at any level. Every leaf\'s cost (LLM spend priced at write time plus human effort) rolls up to every ancestor and is split CAPEX vs OPEX, with anomaly flags where a capitalization decision contradicts its parent. It renders as one nested Gantt and exports to CSV, so engineering, the PMO, and finance read the same numbers without a reconciliation step.',
  },
  {
    name: 'Error Observability with one-click agent fix',
    description: 'Builderforce.ai\'s quality pillar ingests runtime errors from a browser SDK, OpenTelemetry, Sentry, PostHog, or LogRocket, groups them by fingerprint into deduplicated error groups, and turns any group into a fix task a cloud agent picks up and ships as a pull request. Unlike a monitoring dashboard that ends at a stack trace, the same platform that surfaces the crash assigns it, fixes it, and PRs it — and error volume is a metered resource in the same consumption view as tokens.',
  },
  {
    name: 'Knowledge Management & compliance audit trail',
    description: 'A versioned base for SOPs, processes, and docs on Builderforce.ai. Each publish takes an immutable snapshot, and read-acknowledgements are bound to a specific version with a timestamp and per-user overdue tracking, producing audit-ready evidence for SOX, TISAX, and ISO 27001. Documents are AI-authored and AI-analyzed, co-edited in real time over a CRDT, and access-controlled per page — and because they live on the agent platform, the same knowledge that proves compliance also grounds the agent workforce.',
  },
  {
    name: 'Agentic Maturity Index',
    description: 'A CMMI/COBIT-style maturity model that rates how a technology organization runs across six practices — software delivery, release & operations (DORA), quality assurance, project management, agentic AI operations, and governance & security — on a 1–5 scale (Initial → Optimizing). Builderforce.ai scores it two ways: a free, logged-out self-assessment, and a data-driven diagnostic that derives each practice level objectively from real telemetry (cycle time, DORA, rework, run outcomes), then outputs a prioritized plan to mature and innovate.',
  },
  {
    name: 'Frontier-model teacher distillation',
    description: 'A training mode on Builderforce.ai where any frontier LLM (such as Opus, Mistral, or GLM) is pinned as a teacher for a project\'s Evermind. For each real task the team ships, the teacher is asked for the ideal answer through the metered gateway, and the self-updating model adapts on the pair of (task context → teacher exemplar) rather than on the raw run text — so a small, on-device model steadily absorbs the quality of a much larger one. The teacher call is cost-gated to the tenant\'s token budget and best-effort, falling back to raw-text learning on a miss so the learning loop never stalls.',
  },
  {
    name: 'Project Evermind',
    description: 'A per-project instance of Builderforce.ai\'s self-updating Evermind model, provisioned automatically when a project is created. It learns from every run across all four studios (design, voice, LLM, and video) through one shared learning mechanism and a single-writer coordinator, and reads corrected facts from a write-through fact store shared by the web app, VS Code, cloud, and on-prem agents. Inference is opt-in per project, and the model is editable in the LLM Studio.',
  },
  {
    name: 'Agentic Workforce Kanban',
    description: 'Builderforce.ai\'s role-gated delivery board where each project is staffed from a first-class job-role taxonomy of humans and AI agents, starting from a recommended roster. Swimlanes can require a specific reviewer before a ticket advances, every completed ticket carries a role and diagnostic sign-off audit, and a role-coverage diagnostic surfaces gaps — so quality is enforced on the board rather than assumed. Governed board templates (lanes, roles, gates, and rosters) can be published to, sold on, and installed from a marketplace.',
  },
  {
    name: 'Validator agent',
    description: 'A built-in Builderforce.ai agent, seeded into every workspace, that reviews each work item marked Done, records a verdict in a review ledger, and opens GAP tasks for anything incomplete. Ad-hoc chat work is captured as visible tickets automatically, and one shared merge-to-Done path (human approval, green CI, and post-deploy) routes through the validator, so nothing is reported as finished without proof.',
  },
  {
    name: 'Learned model routing',
    description: 'A cost-and-quality optimization on Builderforce.ai that scores every run on its outcome and reorders which model handles each action type accordingly — cheaper models take the work they do well while premium models are reserved for tasks that need them. Combined with the cross-surface semantic cache, the token bill bends down as the platform learns a team\'s workload, with a single kill-switch flag for manual control.',
  },
  {
    name: 'Memory-first inference',
    description: 'A token-saving pattern on Builderforce.ai where, before any paid model call, the Brain consults the project\'s own memory — an exact-repeat question-and-answer cache plus opt-in inference on the project\'s Evermind — and short-circuits the frontier LLM entirely on a confident hit. The decision is single-sourced so every surface (web and VS Code) behaves identically, and learning fans out to every Evermind under a project (its own head and its IDE builds\'), so a lesson taught once answers everywhere and the token bill falls as memory grows.',
  },
  {
    name: 'Role-gated accountability',
    description: 'Builderforce.ai\'s model for proving the right role did each part of a ticket. A per-ticket participation manifest resolves the required roles to the humans and agents capable of each — so a role-incapable owner (for example a Product Manager) is never dispatched to a producer stage — and an append-only Accountability Report records Who, When, Verdict, Comments, and Contribution per role, gated by default-deny sign-off permissions, with a Resource Assessment that surfaces a missing role as a blocking gap. Quality is proven on the board with an immutable record rather than assumed after the fact.',
  },
  {
    name: 'Incident management with learned RCA',
    description: 'Builderforce.ai\'s end-to-end incident response: a Help-Desk / Incident-Manager agent triages, on-call rotations decide who is paged, timed escalation walks the chain, Teams/Slack/email paging reaches the responder, and a per-incident war-room feed coordinates humans and agents. Active monitors pinned onto an uploaded architecture diagram sweep every five minutes and a breach auto-starts the investigation. On resolution the root-cause analysis is published to the Knowledge base and fed to the project\'s Evermind, so the workforce learns and stops repeating the same failure.',
  },
  {
    name: 'Automated RFP response',
    description: 'A pre-sales capability on Builderforce.ai where CTO and Product-Owner agents turn a project\'s analyzed capabilities into a branded, costed proposal — cost and P&L, a phased delivery Gantt, risks, dependencies, and a capability roster matched to the ask — co-branded with the requester\'s palette and logo. Freshness-gated grounding re-runs the deterministic system audits before answering, so the proposal reflects the system as it is today. RFP responses live as a tab on the project itself.',
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
      { icon: '🧠', title: 'Evermind', desc: 'The brain of the platform — a self-updating model governed by Write-Through Cognition. New knowledge replaces what came before with no reconciliation step, and it runs on WebGPU in the browser, on-device, or inside every agent.', href: '/evermind' },
      { icon: '🏠', title: 'Dashboard', desc: 'Your command center: workspace health, recent runs, and what your AI workforce is doing right now.', href: '/dashboard' },
      { icon: '💡', title: 'Brain Storm', desc: 'Describe what you need in plain language; the Brain turns it into projects, datasets, and agents.', href: '/brainstorm' },
      { icon: '💻', title: 'IDE Workspace', desc: 'Monaco editor, terminal, AI chat, and file explorer in one collaborative project workspace.', href: '/ide' },
      { icon: '🎓', title: 'Training', desc: 'In-browser WebGPU LoRA fine-tuning up to 2B parameters with a live evaluation engine — zero GPU bills. Train a custom agent, then call it from inside your own agent.', href: '/training' },
      { icon: '🧩', title: 'VS Code Extension', desc: 'Run the whole platform from your editor — chat with agents, assign and run tasks, review and validate their work, and approve actions without leaving VS Code.', href: 'https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai' },
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
      { icon: '🗺️', title: 'Planning Spine & Portfolio', desc: 'One dated hierarchy — portfolio → initiative → epic → task with OKRs at any level — where every leaf\'s cost rolls up to each ancestor and is split CAPEX vs OPEX on a single Gantt. Plan, deliver, and account for work in one place.', href: '/projects?tab=portfolio' },
      { icon: '🔗', title: 'Board Connectors', desc: 'Two-way sync with Jira, Linear, monday, Asana, ClickUp, ServiceNow, Freshservice, Sentry, PagerDuty, and GitHub — orchestrate across the trackers you already run, with no migration.', href: '/projects?tab=connections' },
      { icon: '🕸️', title: 'Workforce Mesh', desc: 'Discover and dispatch work across local and remote AgentHosts — capacity sharing across machines and tenants.', href: '/workforce' },
      { icon: '💬', title: 'Chats', desc: 'Talk to your agents directly, or watch them collaborate in shared conversations.', href: '/workforce?tab=chats' },
      { icon: '🧑‍🏭', title: 'Workforce Kanban & Templates', desc: 'Staff a project from a role roster of humans and AI agents on a sign-off-gated board, then buy, sell, or install ready-made board templates — lanes, required roles, review gates, and a recommended roster — from the marketplace.', href: '/projects?tab=templates' },
    ],
  },
  {
    id: 'extend',
    icon: '🧩',
    title: 'Extend',
    blurb: 'A marketplace of skills, personas, prompts, and content to supercharge agents.',
    surfaces: [
      { icon: '📚', title: 'Knowledge & SOPs', desc: 'A versioned base for SOPs, processes, and docs with read-acknowledgement audit trails for SOX, TISAX, and ISO 27001, AI authoring, and real-time co-editing — knowledge that grounds your agents and proves compliance.', href: '/knowledge' },
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
      { icon: '🐞', title: 'Quality & Error Tracking', desc: 'Ingest errors from a browser SDK, OpenTelemetry, Sentry, PostHog, or LogRocket; group them by fingerprint; then turn any group into a fix task an agent ships as a pull request — crash to PR on one surface.', href: '/quality' },
      { icon: '📈', title: 'Maturity Diagnostic', desc: 'Rate every practice (Dev, QA, DevOps, PMO, governance) on a CMMI/COBIT-style 1–5 scale — free to self-assess, or scored objectively from your real delivery data with a prioritized plan to mature and innovate.', href: '/diagnostics' },
      { icon: '🏢', title: 'Tenants & Workspaces', desc: 'Multi-tenant workspaces with per-seat roles, members, and cost controls.', href: '/tenants' },
    ],
  },
];

/* ════════════════════ NAV LINKS ════════════════════ */

/** A footer link: a stable route + the i18n key (under the `footer` namespace)
 *  that AppFooter resolves to the visible label. Brand names (e.g. "Evermind
 *  LLM", "BuilderForce Agents") still map to a key so the catalog stays the
 *  single source, even where the translation is the brand token itself. */
export interface FooterLink {
  href: string;
  labelKey: string;
}

export interface FooterColumn {
  /** i18n key under the `footer` namespace for the column heading. */
  titleKey: string;
  links: FooterLink[];
}

/**
 * Grouped footer navigation, rendered as columns on desktop and collapsed to
 * stacked sections on mobile. `Home` is reached via the footer brand mark, so it
 * is intentionally omitted from the columns. Labels/titles are i18n keys (see
 * the `footer` namespace) resolved in AppFooter — never hardcoded strings.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    titleKey: 'colProduct',
    links: [
      { href: '/product', labelKey: 'linkProduct' },
      { href: '/compare', labelKey: 'linkCompare' },
      { href: '/pricing', labelKey: 'linkPricing' },
      { href: '/media', labelKey: 'linkMediaKit' },
    ],
  },
  {
    titleKey: 'colPlatform',
    links: [
      { href: '/evermind', labelKey: 'linkEvermind' },
      { href: '/marketplace', labelKey: 'linkWorkforceRegistry' },
      { href: '/agents', labelKey: 'linkAgents' },
      { href: '/tools', labelKey: 'linkDiagnostics' },
      { href: '/soc2', labelKey: 'linkSoc2' },
      { href: '/blog', labelKey: 'linkBlog' },
    ],
  },
  {
    titleKey: 'colGetStarted',
    links: [
      { href: '/demo', labelKey: 'linkLiveDemo' },
      { href: '/login', labelKey: 'linkSignIn' },
      { href: '/register', labelKey: 'linkGetStarted' },
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
    'transitioning-to-an-agentic-workforce',
    'real-time-collaboration-humans-and-agents',
    'define-a-need-the-agentic-system-solves-it',
    'agent-tech-stack-all-seven-layers',
    'evermind-self-updating-model',
    'system-of-record-for-agentic-work',
    'planning-spine-cost-bearing-delivery',
    'quality-error-observability-one-click-fix',
    'incident-management-on-call-and-war-rooms',
    'role-gated-accountability-proof-of-participation',
    'automated-rfp-response-from-your-codebase',
    'memory-first-inference-skip-the-llm',
  ],
  // Evermind technology page / feature teaser.
  evermind: [
    'evermind-self-updating-model',
    'inside-evermind-architecture',
    'memory-first-inference-skip-the-llm',
    'local-first-ai-webgpu-in-the-browser',
    'transitioning-to-an-agentic-workforce',
    'agent-tech-stack-all-seven-layers',
    'semantic-response-cache',
  ],
  compare: [
    'best-ai-coding-agents-compared',
    'builderforce-vs-github-copilot',
    'builderforce-vs-cursor-windsurf',
  ],
  pricing: [
    'evermind-self-updating-model',
    'memory-first-inference-skip-the-llm',
    'system-of-record-for-agentic-work',
    'semantic-response-cache',
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
  ide: ['vs-code-command-center-for-your-agentic-workforce', 'in-browser-ide-and-collaboration', 'product-ideation-with-builderforce'],
  training: ['webgpu-lora-explained', 'local-first-ai-webgpu-in-the-browser', 'inside-evermind-architecture', 'evermind-self-updating-model', 'ai-dataset-generation-best-practices'],
  workflows: ['define-a-need-the-agentic-system-solves-it', 'multi-agent-orchestration', 'autonomous-swimlane-execution'],
  projects: ['planning-spine-cost-bearing-delivery', 'role-gated-accountability-proof-of-participation', 'autonomous-swimlane-execution', 'task-execution-and-observability'],
  workforce: ['real-time-collaboration-humans-and-agents', 'multi-party-team-chat-humans-and-agents', 'fleet-management-and-agent-routing'],
  meetings: ['video-meetings-standups-and-shared-calendars', 'real-time-collaboration-humans-and-agents', 'multi-party-team-chat-humans-and-agents'],
  skills: ['skills-assignment-and-the-marketplace', 'builderforce-agents-and-agent-integration', 'best-ai-coding-agents-compared'],
  personas: ['ai-agent-personality-psychometric-personas', 'builderforce-agents-and-agent-integration', 'multi-agent-orchestration'],
  'content-manager': ['skills-assignment-and-the-marketplace', 'product-ideation-with-builderforce'],
  security: ['every-role-operating-picture', 'role-gated-accountability-proof-of-participation', 'security-and-multi-tenant-architecture', 'cobit-governance-readiness-for-agentic-it'],
  soc2: ['cobit-governance-readiness-for-agentic-it', 'security-and-multi-tenant-architecture', 'knowledge-management-sops-and-compliance'],
  contributors: ['every-role-operating-picture', 'task-execution-and-observability', 'multi-agent-orchestration'],
  dashboard: ['system-of-record-for-agentic-work', 'real-time-collaboration-humans-and-agents', 'every-role-operating-picture'],
  agents: ['builderforce-agents-and-agent-integration', 'fleet-management-and-agent-routing', 'single-pane-board-connectors'],
  prompts: ['specs-and-planning-with-ai', 'product-ideation-with-builderforce', 'getting-started-with-ai-agents'],
  diagnostics: ['ai-development-maturity-diagnostic', 'cobit-governance-readiness-for-agentic-it', 'system-of-record-for-agentic-work'],
  // Newer enterprise surfaces.
  knowledge: ['knowledge-management-sops-and-compliance', 'every-role-operating-picture', 'security-and-multi-tenant-architecture'],
  quality: ['quality-error-observability-one-click-fix', 'incident-management-on-call-and-war-rooms', 'agentic-tester-autonomous-qa', 'task-execution-and-observability'],
};
