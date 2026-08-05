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
  tagline: 'The creative canvas for humans and AI agents',
  url: 'https://builderforce.ai',
  founder: { name: 'Sean Hogg', url: 'https://hired.video/resumes/seanhogg' },
  year: 2026,
  ogImage: '/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  /** ISO 8601 — update on each content deploy */
  dateModified: '2026-08-04T00:00:00Z',
} as const;

/* ════════════════════ STATS ════════════════════ */

export const STATS = {
  /** Consumer-facing proof points shown on landing/marketing pages. */
  marketing: [
    { value: 'One', label: 'Connected\ncreative canvas' },
    { value: 'Live', label: 'Editable\nartifacts' },
    { value: 'Human + AI', label: 'Shared\ncreation loop' },
    { value: 'Reviewable', label: 'Changes before\ndelivery' },
  ],
  /** Quotable one-liners for AI citability */
  quotable: {
    creativeCanvas: 'Turn any idea into something real on Builderforce.ai. It’s one creative canvas where your team and AI agents design, build, review, and deliver websites, workflows, models, data stories, and products—without the tool sprawl.',
    evermind: 'Evermind is Builderforce.ai\'s project model and memory system. Keyed write-through updates are designed to replace superseded project facts for supported browser and agent workflows.',
    systemOfRecord: 'Builderforce.ai keeps the creative journey connected from the first idea through review and delivery, giving teams one shared record of what humans and AI agents created, changed, approved, and shipped.',
    defineANeed: 'Builderforce.ai lets any human define a need in any modality — plain language, a dataset, a process chart, or a persona — and compiles it into an agent that runs in the IDE, on the desktop, or in the cloud: one AgentSpec spine, compiled from many inputs and deployed to many surfaces.',
    enterpriseInnovation: 'Builderforce.ai connects creative work to delivery: teams can shape an idea with AI, organize it into projects and workflows, and add governance and measurement as the work grows.',
    roleBasedInsight: 'Builderforce.ai brings creative context, delivery activity, model usage, approvals, and available cost data into role-specific operating views for teams and leaders.',
    humanInLoopAgentic: 'Builderforce.ai is a human-in-the-loop creative canvas where your team and AI agents turn ideas into connected, reviewable, deliverable work.',
    trainAndUseLoop: 'Train a custom agent, publish it to the Workforce Registry, then hire it and call it from inside your own agent — your trained specialists become tools your main agent delegates to.',
    neverLeaveVsCode: 'Engineering teams can open Builderforce.ai in VS Code to bring repository context, diagnostics, agent work, reviews, and approvals into the editor.',
    aiExecutiveTeam: 'Builderforce.ai gives leaders connected views of creation, delivery, systems, cost, and governed agent activity without pretending AI replaces accountable executives.',
    freeForever: 'A Free plan is available; verify current pricing and entitlements on the pricing page.',
    agenticTester: 'The Agentic Tester is an autonomous QA agent: point it at your app, give it logins, and it drives a real browser through your highest-traffic flows on a schedule — filing the bugs it finds straight onto your board.',
    collaboration: 'Builderforce.ai is a real-time collaboration platform for a mixed workforce of humans and AI agents: they share one Kanban board, chat in multi-party threads addressable to a person or an @agent, meet over live WebRTC video, and coordinate on shared calendars — from the web or inside VS Code.',
    teamChat: 'Builderforce.ai team chat is multi-party: threads are shared across a project, you invite humans by email and AI agents into the room, and you address each message to a specific participant — a message to a human just talks to them, while an @agent mention makes that agent reply and act on the board within your own permissions.',
    meetings: 'Builderforce.ai runs live video meetings over mesh WebRTC directly on your project board — cameras in standups and retros, a bookable team calendar with per-user availability and "Find a time", and Google/Microsoft calendar sync — joinable from the web or natively inside VS Code, with media flowing peer-to-peer and never through the server.',
    vsCodeCommandCenter: 'The BuilderForce VS Code extension is a command center for a workforce of humans and AI agents: multi-party team chat, live session status showing which runs are executing or need your answer, native video meetings, an Evermind training console, and human-in-the-loop approvals — all without leaving the editor.',
    zeroGpuBills: 'Supported WebGPU training steps run on a compatible local device; hosted and connected steps are disclosed separately.',
    browserNative: 'Fine-tune models up to 2 billion parameters directly in Chrome with WebGPU.',
    datasetSpeed: 'Generate an instruction-tuning dataset in under 30 seconds from a single capability prompt.',
    privacy: 'Supported training work runs locally through WebGPU; publishing, collaboration, and connected cloud services may transmit the data needed for those features.',
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
  tagline: 'A project model designed to learn as the work changes',
  /** Per-page SEO/GEO copy for the dedicated /evermind landing page. */
  seo: {
    title: 'Evermind — The Builderforce.ai LLM, a Self-Updating Model',
    description:
      'Evermind is Builderforce.ai\'s project model and memory system. Its keyed write-through updates are designed to replace superseded project facts and make current context available to supported browser and agent workflows.',
    ogTitle: 'Evermind — The Self-Updating Builderforce.ai LLM',
  },
  blurb:
    'Evermind is Builderforce\'s project model and memory system. Its Write-Through Cognition design stores project knowledge under stable keys so a newer fact can supersede an older one. Supported WebGPU and agent workflows can use that maintained context while external frontier models remain available when needed.',
  /** Quotable one-liner for AI citability / meta descriptions. */
  quotable:
    'Evermind is Builderforce.ai\'s project model and memory system, designed to keep maintained project facts current through keyed updates that replace superseded context.',
  /** The key aspects the homepage brain animation represents. */
  pillars: [
    {
      icon: '🧠',
      title: 'Write-Through Cognition',
      desc: 'Project facts use stable keys so an accepted update can replace prior context instead of simply appending another copy. Provenance and evaluation remain essential when the source itself is incomplete or wrong.',
    },
    {
      icon: '⚡',
      title: 'Shared-expert hybrid generator',
      desc: 'A dense always-on backbone carries continuous online learning, while lazily-loaded routed SSM experts page in on demand. You get specialist depth without a giant frozen blob — and it runs on WebGPU with zero runtime dependencies.',
    },
    {
      icon: '🔁',
      title: 'Write-through memory',
      desc: 'Maintained facts upsert by stable key and invalidate prior recall for that key, reducing stale duplicate context and making corrections explicit.',
    },
    {
      icon: '❤️',
      title: 'Limbic dynamics',
      desc: 'A trainable affective layer modulates how the model responds in the moment — personality as setpoints, limbic state as dynamics — so agents behave consistently with the persona you give them.',
    },
  ] as EvermindPillar[],
  /** Why Evermind beats a frozen frontier model — not on scale, on these axes. */
  edges: [
    { label: 'Currency', desc: 'Keyed project-memory updates can replace superseded facts without waiting for a full model retraining cycle.' },
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
    icon: '✦',
    title: 'Creation Canvas — From Idea to Deliverable',
    shortDesc: 'Chat, workflows, websites, data, models, people, and delivery on one multiplayer canvas.',
    longDesc: 'Start with a prompt—without choosing a project or creating an account—and build in a durable spatial session. Drag in workflows, live websites, datasets, dashboards, Evermind models, voice, humans, and agents; ask Brain to reason across them; review proposed changes; then deliver approved mockups into projects, tasks, and agent execution. Sessions support local-to-account claiming, live cursors and comments, presentation/follow mode, version checkpoints, reusable Marketplace packs, freehand drawing, and reviewed branch merges on the web. VS Code opens the same graph in a native full-editor surface and can add files, selections, diagnostics, repositories, terminal output, services, and previews.',
  },
  {
    icon: '🧠',
    title: 'Evermind — The Self-Updating Model',
    shortDesc: 'A project model designed to learn as the work changes.',
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
    title: 'A VS Code Surface for Engineering Teams',
    shortDesc: 'Bring canvas context, agents, review, and delivery into the editor.',
    longDesc: 'The BuilderForce VS Code extension gives engineering teams an editor-native view of relevant platform work: chat with agents, add repository and diagnostic context, assign tasks, review changes, and handle approvals close to the code.',
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
    title: 'Model Studio & Agent Training',
    shortDesc: 'Train, evaluate, and publish specialist models and agents.',
    longDesc: 'Use in-browser WebGPU LoRA fine-tuning, evaluation, and publishing tools to create specialist models and make them available to supported agent workflows.',
  },
  {
    icon: '🔗',
    title: 'Connected Systems & Orchestration',
    shortDesc: 'Connect supported tools and coordinate work across them.',
    longDesc: 'Connect supported systems such as GitHub, Jira, and Confluence with encrypted credentials, then make approved operations available through workflows and the Brain tool registry.',
  },
  {
    icon: '🛡️',
    title: 'Agent Governance & Security',
    shortDesc: 'Apply permissions, approvals, isolation, and execution records.',
    longDesc: 'Keep accountable people in control with role-based access, human approval gates for configured actions, tenant isolation, encrypted integration credentials, and retained execution records.',
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
    longDesc: 'Fine-tune supported models on compatible devices through WebGPU. Local training, remote evaluation, collaboration, and publishing have separate stated boundaries.',
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
    shortDesc: 'Monaco editor, terminal, preview, and AI chat in one engineering workspace.',
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
    shortDesc: 'A globally distributed Worker API for responsive platform services.',
    longDesc: 'Cloudflare Workers provide globally distributed API execution. COOP/COEP headers enable SharedArrayBuffer where browser-based model tooling requires it.',
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
  { href: '/docs/start/getting-started', iconKey: 'cpu', title: 'Agent & Sub-agent Manager', description: 'BuilderForce Agents runs and coordinates independent coding agents and sub-agents. Delegate work autonomously across your entire workflow.' },
  { href: '/', iconKey: 'mesh', title: 'Mesh Orchestration', description: 'Builderforce.ai is the project management and mesh orchestrator — coordinating agents, tasks, and outcomes across your entire team.' },
  { href: '/docs/start/getting-started', iconKey: 'trending', title: 'Business Outcome Focus', description: 'Transition from writing code to managing business outcomes. Let the agents handle execution while you focus on strategy.' },
  { href: '/docs/agents-overview', iconKey: 'pulse', title: 'Self-Healing Runtime', description: 'Agents detect failures, fix themselves, and adapt over time. Persistent memory means context survives restarts — no re-explaining your codebase.' },
  { href: '/workforce?tab=approvals', iconKey: 'users', title: 'Human-in-the-Loop Control', description: 'Approval gates block agent execution until a manager approves in the Builderforce.ai portal. Workflow visibility, auditability, and human sign-off — enforced, not optional.' },
  { href: '/docs/agents-link', iconKey: 'bolt', title: 'AgentHost-to-AgentHost Mesh', description: 'Distribute work across a fleet of AgentHosts. Use `remote:auto[caps]` to route tasks to the best-matched peer. All dispatch is HMAC-signed and Bearer-authenticated.' },
  { href: '/docs/tools/browser', iconKey: 'globe', title: 'Full Automation', description: 'Agents can browse the web, control your browser, run shell commands, and interact with any tool or service on your behalf.' },
  { href: '/docs/tools/exec', iconKey: 'terminal', title: 'Full System Access', description: 'Read and write files, run shell commands, execute scripts. Full access or sandboxed — your choice.' },
  { href: '/agents/skills', iconKey: 'gear', title: 'Skills & Plugins', description: 'Extend with community skills or build your own. Skills assigned in the Builderforce.ai portal are loaded automatically at startup.' },
  { href: '/docs/deep-understanding', iconKey: 'layers', title: 'Deep Codebase Understanding', description: 'AST parsing, semantic maps, dependency graphs and git history give agents real comprehension of your project.' },
  { href: '/agents/workflow-builder', iconKey: 'flow', title: 'Agentic Workflow Builder', description: 'Drag-and-drop, IPAAS-style canvas for composing your own LLM logic — memory, knowledge-base and training nodes — wired to your agents and run on your agentHosts.' },
  { href: '/docs/agents-workflows', iconKey: 'activity', title: 'Multi-Agent Workflows', description: 'Built-in patterns for planning, feature dev, bug fixes, refactors and adversarial reviews keep work moving.' },
  { href: '/security', iconKey: 'shield', title: 'Security & RBAC', description: 'Role-based access control, device trust, and complete audit trails. HMAC-signed inter-AgentHost dispatch with Bearer authentication.' },
  { href: '/settings?sub=logs', iconKey: 'bars', title: 'Workflow Telemetry', description: 'Every task and workflow emits structured JSONL spans locally and forwards to the Builderforce.ai portal timeline in real time.' },
  { href: '/docs/agents-workflows', iconKey: 'swimlane', title: 'Autonomous Swimlane Execution', description: 'Assign any agent — Cloud or On-Premise — to a kanban swimlane. Tickets are dispatched automatically and the board advances on its own as agents finish, stopping only at the approval gates you choose.' },
  { href: '/docs/start/getting-started', iconKey: 'git', title: 'Agents That Ship Code', description: 'A Cloud agent clones the bound repo through a secure server-side git proxy (your Git token never leaves the server), writes the change, pushes a branch and opens a pull request — headless, no browser open. On-Premise agents do the same on your own machine.' },
  { href: 'https://github.com/SeanHogg/Builderforce.ai', iconKey: 'globe', title: 'Self-Hosted & Open Source', description: 'Run on your infrastructure under the MIT license — no vendor lock-in or subscription ceilings.' },
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

/** @deprecated Historical presentation snapshot. Public pricing now comes from
 * GET /api/tenants/pricing, derived from TenantService.PRICING + PLAN_LIMITS. */
const LEGACY_PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    priceNumeric: 0,
    period: '/month',
    description: 'Start creating on a private canvas, explore the platform, and add agents when they help.',
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
    description: 'More projects, agent capacity, approvals, telemetry, and support for sustained creative delivery.',
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
    description: 'Shared controls and volume pricing for organizations coordinating work across a larger team.',
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
 * Legacy internal snapshot retained only for migration compatibility. Public
 * comparison pages and structured data use criteria-first copy from COMPARE;
 * these undated cells must never be rendered or cited as current evidence.
 */
const LEGACY_COMPETITIVE_COMPARISON: CompetitiveCategory[] = [
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
    title: 'Builderforce.ai Compared: From Creative Canvas to Governed Delivery',
    description:
      'See where Builderforce.ai overlaps with AI coding tools—and where its connected creative canvas, human collaboration, workflows, agents, and governance extend beyond the editor.',
    ogTitle: 'Builderforce.ai — Creative Canvas and Agent Delivery Compared',
  },
  hero: {
    eyebrow: 'Understand the difference',
    title: 'Start with the idea—not the editor',
    subtitle:
      'AI coding tools help engineers produce code. Builderforce.ai gives creative and delivery teams a shared canvas for shaping the idea, connecting the work, collaborating with agents, reviewing changes, and moving approved outcomes into execution. Its open agent runtime remains available when engineering work begins.',
  },
  intro:
    'These products overlap in parts of the engineering workflow, but they are not interchangeable. Use this matrix as a scope guide: Builderforce.ai spans visual creation, connected artifacts, human-and-agent collaboration, work orchestration, and governed delivery. Product capabilities and competitor offerings change, so verify requirements that are critical to your decision.',
  pillars: [
    {
      icon: '🛡️',
      title: 'An open runtime when you need it',
      desc: 'BuilderForce Agents is an MIT-licensed, self-hosted engineering runtime. Teams can choose local models and private infrastructure for agent work that requires tighter control.',
    },
    {
      icon: '🔀',
      title: 'Connected multi-agent workflows',
      desc: 'Coordinate specialist agents, tools, review steps, and dependencies in reusable workflows while keeping the originating idea and related artifacts visible.',
    },
    {
      icon: '🎛️',
      title: 'Model and surface choice',
      desc: 'Choose among supported cloud and local models, work on the web, and bring engineering context into VS Code when the outcome includes software.',
    },
    {
      icon: '✅',
      title: 'People stay in the loop',
      desc: 'Use role-based access, approval gates, execution records, and shared project context to review consequential agent work before it moves forward.',
    },
  ] as ComparePillar[],
  quotable:
    'Builderforce.ai begins before the code: it connects ideas, artifacts, people, and AI agents on a creative canvas, then carries approved work into workflows, projects, and engineering delivery.',
  teaser: {
    title: 'The work begins before the code',
    blurb:
      'See how a connected creative canvas differs from editor-first AI tools—and how Builderforce carries approved ideas into agent-assisted delivery.',
    ctaLabel: 'See how Builderforce is different',
    highlightFeatures: [
      'Start from an idea on a visual canvas',
      'Create live, connected artifacts',
      'Collaborate with people and specialist agents',
      'Review changes before delivery',
      'Move approved work into workflows and projects',
      'Use VS Code when engineering context matters',
    ],
  } as CompareTeaser,
} as const;

/* ════════════════════ GETTING STARTED ════════════════════ */

export const GETTING_STARTED_STEPS = [
  { num: '01', title: 'Describe the outcome', desc: 'Start with the thing you want to create, without translating the idea into a tool-specific workflow first.' },
  { num: '02', title: 'Create and connect', desc: 'Add live artifacts, context, collaborators, and agents to one visual workspace.' },
  { num: '03', title: 'Review and deliver', desc: 'Shape the result with your team and move approved work into projects, workflows, or execution.' },
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
    answer: 'Builderforce.ai is a creative canvas where teams and AI agents turn ideas into working outcomes. You can create websites, workflows, prototypes, data stories, models, documents, and delivery plans in one visual workspace, preserve the relationships between them, and move approved work into governed execution.',
  },
  {
    question: 'Is Builderforce.ai an enterprise platform?',
    answer: 'Yes. Teams can begin with a private canvas, then add shared workspaces, role-based access, approval workflows, delivery tracking, cost visibility, and audit evidence as the work grows. Creative and operational teams keep one connected record instead of reconstructing decisions across separate whiteboards, documents, project tools, and agent chats.',
  },
  {
    question: 'Can I train my own agents and use them inside my own agent?',
    answer: 'Yes — that is the core loop. Train a custom agent in the browser with WebGPU LoRA fine-tuning and the AI evaluation engine, publish it to the Workforce Registry, then hire it and call it from inside your own agent. Your trained specialists become tools your main agent delegates to, so you build and orchestrate a fully agentic workforce you own.',
  },
  {
    question: 'Do I have to leave VS Code to manage my agents?',
    answer: 'No. Builderforce.ai is a web-first creative canvas. Engineering teams can also use the BuilderForce VS Code extension to bring repository context, diagnostics, agent work, reviews, and approvals closer to the code.',
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
    answer: 'A Free tier is available. Current prices, enforced quotas, and plan feature availability are generated from the platform entitlement configuration on the pricing page.',
  },
  {
    question: 'How do I train a model in my browser?',
    answer: 'Start a project, generate or upload a dataset, then launch the in-browser LoRA training wizard on a compatible WebGPU device. The local training step stays in the browser; remote evaluation, collaboration, and publishing are separate operations with their own boundaries.',
  },
  {
    question: 'What is the Workforce Registry?',
    answer: 'The Workforce Registry is a public marketplace where trained AI agents can be listed with profiles, skills, and evaluation scores. Other teams and applications can discover and hire agents instantly.',
  },
  {
    question: 'What is WebGPU LoRA fine-tuning?',
    answer: 'LoRA (Low-Rank Adaptation) trains a smaller set of adapter weights instead of the full model. Builderforce supports browser-based WebGPU training for compatible models and devices; hardware limits and any remote steps are shown separately.',
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
    answer: 'Training computation runs locally on supported WebGPU devices. Data is transmitted only when you use an explicitly connected service such as dataset generation, collaboration, evaluation with a remote model, or artifact publishing; review those steps before enabling them.',
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
    answer: 'A Free plan is available. Use the pricing page for the current API-derived price, quotas, and feature availability.',
  },
  {
    question: 'What is included in the Pro plan?',
    answer: 'The pricing page retrieves current Pro pricing and derives plan availability from the same enforced entitlement configuration used by the API.',
  },
  {
    question: 'Can I change plans at any time?',
    answer: 'Yes — you can upgrade or downgrade at any time from the Pricing & Billing page. Upgrades take effect immediately; downgrades apply at the end of your current billing period.',
  },
  {
    question: 'What is a Managed AgentHost?',
    answer: 'A Managed AgentHost is a hosted BuilderForce Agents instance operated by Builderforce. Its current price is supplied by the public pricing contract on the pricing page.',
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
      'They overlap in engineering assistance but address different scopes. Evaluate Copilot for editor assistance and Builderforce.ai for connected creative work, supported multi-agent workflows, and configured governance. Verify current model, editor, and deployment requirements with each vendor.',
  },
  {
    question: 'How does Builderforce.ai compare to Cursor and Windsurf?',
    answer:
      'Cursor and Windsurf focus on AI-assisted editing. Builderforce.ai starts with a shared creative canvas and can hand supported engineering work into agent workflows and VS Code. Compare the current collaboration, model, deployment, and governance support that matters to your team.',
  },
  {
    question: 'Builderforce.ai vs Claude Code and Aider, what is the difference?',
    answer:
      'Claude Code and Aider are terminal-centered engineering tools. Builderforce.ai adds a visual creation layer, supported multi-agent workflow patterns, project memory, and configurable approvals. Model and channel availability changes, so validate the live catalogs rather than relying on a fixed provider count.',
  },
  {
    question: 'Builderforce.ai vs Devin and OpenHands, which should I pick for autonomous engineering?',
    answer:
      'These products offer different combinations of hosted execution, open runtimes, and engineering automation. Builderforce.ai combines its hosted workspace with the separately deployable MIT-licensed BuilderForce Agents runtime. Compare the exact workflow, approval, observability, and infrastructure boundaries you require.',
  },
  {
    question: 'Can Builderforce.ai run fully offline or air-gapped?',
    answer:
      'The MIT-licensed BuilderForce Agents runtime can run on private infrastructure and use supported local models. A fully air-gapped configuration excludes hosted collaboration, publishing, remote evaluation, and connected services; validate the complete target workflow before making a compliance commitment.',
  },
  {
    question: 'Does Builderforce.ai lock me into one model or IDE?',
    answer:
      'Builderforce.ai supports multiple cloud and local model options, and engineering context can be used on the web or in VS Code. Availability depends on the current catalog, plan, credentials, region, and runtime; verify those requirements before choosing a deployment.',
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
    answer: 'Marketplace fees are governed by the current seller terms shown at publication and checkout. Review those terms before listing a paid agent.',
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

export const REGISTER_MARKETING: Record<'standard' | 'freelancer' | 'sales', RegisterMarketingVariant> = {
  standard: {
    eyebrow: 'Create with AI',
    heading: 'Turn Your Next Idea Into Something Real',
    intro:
      'Open a creative canvas, build connected artifacts with your team and AI agents, review the work, and carry approved outcomes into delivery.',
    stats: [
      { value: 'Free', label: 'Plan available' },
      { value: '14 days', label: 'Pro trial included' },
      { value: 'One canvas', label: 'Ideas through delivery' },
      { value: 'Human + AI', label: 'Create together' },
    ],
    bullets: [
      { icon: '✦', title: 'Start on the canvas', desc: 'Give an idea room to grow before choosing a rigid tool or structure.' },
      { icon: '◫', title: 'Create live artifacts', desc: 'Build websites, workflows, data stories, models, and plans as editable objects.' },
      { icon: '🤝', title: 'Create with people and agents', desc: 'Keep collaborators, context, and specialist AI beside the work.' },
      { icon: '✅', title: 'Review before delivery', desc: 'Inspect proposed changes and move only approved work into execution.' },
      { icon: '🔀', title: 'Connect the journey', desc: 'Preserve the path from the first idea through projects, workflows, and outcomes.' },
      { icon: '🧩', title: 'Engineering when needed', desc: 'Bring repository and diagnostic context into VS Code when the work becomes code.' },
    ],
    quote:
      'Start with the outcome you want—not the software you think you need to use.',
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
      'Set your rate, review the current engagement terms, and use supported time records for approved billable work.',
    faq: [
      {
        question: 'Does Builderforce take a commission on my rate?',
        answer: 'Fees and payout terms are stated in the current engagement agreement. Review them before accepting work; approved time records support billing where configured.',
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
  sales: {
    eyebrow: 'Earn with Builderforce',
    heading: 'Build a Pipeline. Grow with Us.',
    intro: 'Join the Builderforce referral and sales associate program with a focused workspace for prospecting, campaigns, contacts, meetings, and weekly coaching.',
    stats: [
      { value: '1 hub', label: 'Contacts to close' },
      { value: 'Weekly', label: 'Goals & coaching' },
      { value: 'Built in', label: 'Campaign tools' },
      { value: 'Direct', label: 'Admin access' },
    ],
    bullets: [
      { icon: '🎯', title: 'Target markets', desc: 'Define ideal customer segments and focus every campaign.' },
      { icon: '📬', title: 'Email campaigns', desc: 'Build outreach from approved messaging and sales assets.' },
      { icon: '🤝', title: 'Lead management', desc: 'Import contacts and move opportunities through a clear pipeline.' },
      { icon: '📅', title: 'Meetings built in', desc: 'Connect your calendar and book prospects or Builderforce leadership.' },
      { icon: '📈', title: 'Weekly momentum', desc: 'Set activity goals and get the next best action for your pipeline.' },
      { icon: '🧠', title: 'Marketing toolkit', desc: 'Use current decks, one-pagers, templates, and campaign guidance.' },
    ],
    quote: 'A practical sales operating system for turning consistent outreach into qualified Builderforce opportunities.',
    faq: REGISTER_FAQ,
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
    { value: 'Free', label: 'Plan available' },
    { value: '<60s', label: 'To sign in' },
    { value: '2B+', label: 'Params in-browser' },
    { value: '0%', label: 'Agent commission' },
  ],
  bullets: [
    { icon: '🧠', title: 'Evermind', desc: 'A project model and memory system with keyed updates for supported workflows.' },
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
    answer: 'BuilderForce Agents is MIT-licensed and can run on private infrastructure with supported local models. Hosted collaboration, publishing, remote evaluation, and connected services remain separate; validate a complete air-gapped workflow before making a compliance commitment.',
  },
  {
    question: 'How do agents coordinate across machines?',
    answer: 'Agents can form an AgentHost-to-AgentHost mesh and route supported work by capability. Configured dispatch uses the documented authentication path, and the portal shows telemetry for instrumented execution paths.',
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
    description: 'An operating model in which configured AI execution paths can pause at approval gates for a person to approve or reject consequential actions. Retained evidence and coverage depend on the instrumented entry point.',
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

export type CapabilityStatus = 'available' | 'beta' | 'planned';
export type CapabilityDataBoundary = 'browser' | 'workspace-cloud' | 'connected-service' | 'hybrid';

export interface CapabilityProof {
  status: CapabilityStatus;
  dataBoundary: CapabilityDataBoundary;
  prerequisites: readonly string[];
  /** Repository-relative automated or implementation evidence. */
  evidence: readonly string[];
  /** ISO date on which the evidence was last reviewed. */
  lastVerified: string;
}

export interface MarketingClaim {
  id: string;
  approvedCopy: string;
  status: CapabilityStatus;
  scope: string;
  dataBoundaries: readonly CapabilityDataBoundary[];
  evidence: readonly string[];
  owner: string;
  lastReviewed: string;
  reviewBy: string;
  complianceReview: 'required' | 'not-required';
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
    title: 'Create',
    blurb: 'Move from a prompt to working artifacts and delivery without changing surfaces or organizing a project first.',
    surfaces: [
      { icon: '✦', title: 'Creation Canvas', desc: 'One infinite multiplayer canvas for conversation, workflows, websites, data, prototypes, models, voice, people, agents, and optional project context.', href: '/creation-canvas' },
      { icon: '🏠', title: 'Session Library', desc: 'Visual session cards are the first Dashboard view. Search, pin, duplicate, archive, branch, merge, or return to any creative context.', href: '/dashboard' },
      { icon: '🔀', title: 'Workflows & Evaluation', desc: 'Design and run workflows in place, connect them to websites or data, and ask Brain for a cited cross-object evaluation before applying changes.', href: '/create' },
      { icon: '▣', title: 'Websites, Data & Prototypes', desc: 'Import datasets, build live charts and dashboards, create WYSIWYG interactive prototypes, and bind evidence to the experience on one canvas.', href: '/create' },
      { icon: '🧠', title: 'Evermind, LLM & Voice', desc: 'Create, teach, tune, evaluate, package, and operate models and voice experiences as connected canvas objects.', href: '/create' },
      { icon: '🧩', title: 'Creation Canvas for VS Code', desc: 'Open the same tenant Session in a native full editor tab and add files, selections, diagnostics, repository context, terminal output, local services, and browser previews.', href: 'https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai' },
    ],
  },
  {
    id: 'orchestrate',
    icon: '🔀',
    title: 'Orchestrate',
    blurb: 'Coordinate work across agents, workflows, and a mesh of remote AgentHosts.',
    surfaces: [
      { icon: '🔀', title: 'Workflow Execution', desc: 'Compose and run repeatable, approval-gated workflows as live objects inside Creation Sessions.', href: '/create' },
      { icon: '▦', title: 'Projects / Tasks', desc: 'Organize work into project workspaces — each with a full IDE, agents, and a task board — then plan, assign, and watch tasks flow across your agent workforce in board, table, calendar, or Gantt views.', href: '/projects' },
      { icon: '🗺️', title: 'Planning Spine & Portfolio', desc: 'One dated hierarchy — portfolio → initiative → epic → task with OKRs at any level — where every leaf\'s cost rolls up to each ancestor and is split CAPEX vs OPEX on a single Gantt. Plan, deliver, and account for work in one place.', href: '/projects?tab=portfolio' },
      { icon: '🔗', title: 'Board Connectors', desc: 'Two-way sync with Jira, Linear, monday, Asana, ClickUp, ServiceNow, Freshservice, Sentry, PagerDuty, and GitHub — orchestrate across the trackers you already run, with no migration.', href: '/projects?tab=connections' },
      { icon: '🕸️', title: 'Workforce Mesh', desc: 'Discover and dispatch work across local and remote AgentHosts — capacity sharing across machines and tenants.', href: '/workforce' },
      { icon: '💬', title: 'Session Conversations', desc: 'Use the persistent bottom composer or place movable Chat objects beside the work they discuss.', href: '/create' },
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
    blurb: 'Keep accountable people in control with permissions, approvals, security, and operational visibility.',
    surfaces: [
      { icon: '✅', title: 'Approvals', desc: 'Human approval gates on configured agent execution paths, with dispatch blocked if policy resolution fails.', href: '/workforce?tab=approvals' },
      { icon: '🔒', title: 'Security', desc: 'Tenant-scoped access controls and AES-256-GCM encryption for credentials stored by supported integrations.', href: '/security' },
      { icon: '📊', title: 'Observability', desc: 'Execution, token, and tool-call telemetry for instrumented platform workflows, with coverage identified by surface.', href: '/settings?sub=logs' },
      { icon: '🐞', title: 'Quality & Error Tracking', desc: 'Ingest errors from a browser SDK, OpenTelemetry, Sentry, PostHog, or LogRocket; group them by fingerprint; then turn any group into a fix task an agent ships as a pull request — crash to PR on one surface.', href: '/quality' },
      { icon: '📈', title: 'Maturity Diagnostic', desc: 'Rate every practice (Dev, QA, DevOps, PMO, governance) on a CMMI/COBIT-style 1–5 scale — free to self-assess, or scored objectively from your real delivery data with a prioritized plan to mature and innovate.', href: '/diagnostics' },
      { icon: '🏢', title: 'Tenants & Workspaces', desc: 'Multi-tenant workspaces with per-seat roles, members, and cost controls.', href: '/tenants' },
    ],
  },
];

void LEGACY_PRICING_PLANS;

void LEGACY_COMPETITIVE_COMPARISON;

/**
 * Public capability-claim contract. A product surface cannot appear in the
 * marketing catalog without an explicit maturity state, execution/data
 * boundary, prerequisites, and code evidence. Tests keep this registry aligned
 * with PRODUCT_SECTIONS and prevent planned work from being marketed as live.
 */
export const PRODUCT_CAPABILITY_PROOF: Record<string, CapabilityProof> = {
  'Creation Canvas': { status: 'beta', dataBoundary: 'hybrid', prerequisites: [], evidence: ['frontend/src/components/creation-canvas/CreationCanvas.test.tsx'], lastVerified: '2026-08-04' },
  'Session Library': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/lib/creationSessions.ts'], lastVerified: '2026-08-04' },
  'Workflows & Evaluation': { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['account'], evidence: ['frontend/src/lib/creationCanvasAi.test.ts'], lastVerified: '2026-08-04' },
  'Websites, Data & Prototypes': { status: 'beta', dataBoundary: 'hybrid', prerequisites: [], evidence: ['frontend/src/components/creation-canvas/creationObjectRegistry.ts'], lastVerified: '2026-08-04' },
  'Evermind, LLM & Voice': { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['supported WebGPU device for local training'], evidence: ['frontend/src/components/workflow-builder/EvermindBuildPanel.tsx'], lastVerified: '2026-08-04' },
  'Creation Canvas for VS Code': { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['VS Code extension', 'account for shared sessions'], evidence: ['packages/creation-canvas-contract/src/index.ts'], lastVerified: '2026-08-04' },
  'Workflow Execution': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/WorkflowDagView.tsx'], lastVerified: '2026-08-04' },
  'Projects / Tasks': { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/TaskMgmtContent.tsx'], lastVerified: '2026-08-04' },
  'Planning Spine & Portfolio': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/pm/PlanningSpineGantt.tsx'], lastVerified: '2026-08-04' },
  'Board Connectors': { status: 'beta', dataBoundary: 'connected-service', prerequisites: ['supported provider credentials'], evidence: ['api/src/application/boardsync/providerCatalog.ts'], lastVerified: '2026-08-04' },
  'Workforce Mesh': { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['registered AgentHost'], evidence: ['frontend/src/components/workforce/WorkforceAgents.tsx'], lastVerified: '2026-08-04' },
  'Session Conversations': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/creation-canvas/CreationCanvas.tsx'], lastVerified: '2026-08-04' },
  'Workforce Kanban & Templates': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/TaskMgmtContent.tsx'], lastVerified: '2026-08-04' },
  'Knowledge & SOPs': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/knowledge/page.tsx'], lastVerified: '2026-08-04' },
  Skills: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account to install or publish'], evidence: ['frontend/src/app/skills/page.tsx'], lastVerified: '2026-08-04' },
  Personas: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/personas/page.tsx'], lastVerified: '2026-08-04' },
  'Prompt Library': { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account to publish'], evidence: ['frontend/src/app/prompts/page.tsx'], lastVerified: '2026-08-04' },
  'Content Manager': { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/content-manager/page.tsx'], lastVerified: '2026-08-04' },
  Approvals: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['configured policy gate'], evidence: ['api/src/application/runtime/RuntimeService.policyGates.test.ts'], lastVerified: '2026-08-04' },
  Security: { status: 'available', dataBoundary: 'hybrid', prerequisites: ['configuration appropriate to deployment'], evidence: ['api/src/application/governance/policyPackService.test.ts'], lastVerified: '2026-08-04' },
  Observability: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['instrumented platform execution'], evidence: ['frontend/src/components/ObservabilityContent.tsx'], lastVerified: '2026-08-04' },
  'Quality & Error Tracking': { status: 'beta', dataBoundary: 'connected-service', prerequisites: ['configured error source'], evidence: ['frontend/src/app/quality/page.tsx'], lastVerified: '2026-08-04' },
  'Maturity Diagnostic': { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/diagnostics/page.tsx'], lastVerified: '2026-08-04' },
  'Tenants & Workspaces': { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/tenants/page.tsx'], lastVerified: '2026-08-04' },
};

export interface CapabilityOperations {
  owner: string;
  limitation: string;
  exports: readonly string[];
  exampleHref: string;
}

/** Operational disclosure paired one-to-one with the public capability catalog. */
export const PRODUCT_CAPABILITY_OPERATIONS: Record<string, CapabilityOperations> = {
  'Creation Canvas': { owner: 'Creation', limitation: 'Beta coverage is limited to named object and handoff types.', exports: ['Canvas export', 'Supported delivery handoff'], exampleHref: '/creation-canvas' },
  'Session Library': { owner: 'Creation', limitation: 'Shared persistence requires an account and workspace.', exports: ['Session export'], exampleHref: '/dashboard' },
  'Workflows & Evaluation': { owner: 'Creation AI', limitation: 'Evaluation quality depends on available source context and citations.', exports: ['Evaluation result'], exampleHref: '/creation-canvas' },
  'Websites, Data & Prototypes': { owner: 'Creation', limitation: 'Artifact runtimes and export formats vary by object type.', exports: ['Object-specific export'], exampleHref: '/creation-canvas' },
  'Evermind, LLM & Voice': { owner: 'AI Studio', limitation: 'Local paths require compatible WebGPU hardware; publishing uses hosted services.', exports: ['Supported model package', 'Generated media'], exampleHref: '/evermind' },
  'Creation Canvas for VS Code': { owner: 'Developer Experience', limitation: 'Parity is limited to the objects and actions supported by the extension contract.', exports: ['Workspace context'], exampleHref: '/agents' },
  'Workflow Execution': { owner: 'Workflows', limitation: 'Node behavior and governance coverage vary by configured step type.', exports: ['Execution result'], exampleHref: '/agents/workflow-builder' },
  'Projects / Tasks': { owner: 'Delivery', limitation: 'External board behavior depends on connector configuration.', exports: ['CSV', 'Connected board sync'], exampleHref: '/projects' },
  'Planning Spine & Portfolio': { owner: 'PMO', limitation: 'Cost and outcome rollups reflect instrumented and attributed records only.', exports: ['CSV'], exampleHref: '/projects' },
  'Board Connectors': { owner: 'Integrations', limitation: 'Mappings, permissions, sync direction, and conflict handling vary by provider.', exports: ['Provider-specific sync'], exampleHref: '/integrations' },
  'Workforce Mesh': { owner: 'Agent Runtime', limitation: 'Requires registered hosts and configured network/runtime access.', exports: ['Execution records'], exampleHref: '/workforce' },
  'Session Conversations': { owner: 'Collaboration', limitation: 'Conversation retention and tools depend on workspace configuration.', exports: ['Session export'], exampleHref: '/creation-canvas' },
  'Workforce Kanban & Templates': { owner: 'Delivery', limitation: 'Installed templates remain subject to workspace roles and entitlements.', exports: ['Template package'], exampleHref: '/tasks' },
  'Knowledge & SOPs': { owner: 'Knowledge', limitation: 'Compliance suitability depends on configured controls and organizational review.', exports: ['Published snapshot'], exampleHref: '/knowledge' },
  Skills: { owner: 'Marketplace', limitation: 'Installed skills execute with the permissions of their configured runtime.', exports: ['Skill package'], exampleHref: '/skills' },
  Personas: { owner: 'Marketplace', limitation: 'Persona behavior varies with the selected model and workflow.', exports: ['Persona definition'], exampleHref: '/personas' },
  'Prompt Library': { owner: 'Marketplace', limitation: 'Prompt output varies by model, context, and connected tools.', exports: ['Prompt template'], exampleHref: '/prompts' },
  'Content Manager': { owner: 'Content', limitation: 'Reuse depends on the target surface and access permissions.', exports: ['Content block'], exampleHref: '/content-manager' },
  Approvals: { owner: 'Runtime & Governance', limitation: 'Applies to execution paths wired to the effective policy resolver.', exports: ['Decision record'], exampleHref: '/workforce?tab=approvals' },
  Security: { owner: 'Security', limitation: 'Control coverage depends on deployment and integration configuration.', exports: ['Available audit evidence'], exampleHref: '/security' },
  Observability: { owner: 'Observability', limitation: 'Coverage varies by instrumented surface and entry point.', exports: ['Available logs and traces'], exampleHref: '/settings?sub=logs' },
  'Quality & Error Tracking': { owner: 'Quality', limitation: 'Requires a configured source; supported event fields vary by provider.', exports: ['Issue or fix task'], exampleHref: '/quality' },
  'Maturity Diagnostic': { owner: 'Diagnostics', limitation: 'Self-assessment is directional and not a certification.', exports: ['Assessment result'], exampleHref: '/diagnostics' },
  'Tenants & Workspaces': { owner: 'Platform', limitation: 'Roles and entitlements govern available workspace operations.', exports: ['Available workspace records'], exampleHref: '/tenants' },
};

/** Canonical wording for high-risk public claims. Marketing surfaces should
 * reference these records instead of inventing broader privacy/security copy. */
export const MARKETING_CLAIMS: readonly MarketingClaim[] = [
  {
    id: 'creative-canvas-delivery',
    approvedCopy: 'Builderforce connects supported creative artifacts to review and delivery surfaces in one Creation Session.',
    status: 'beta',
    scope: 'Supported Creation Canvas objects and named delivery paths',
    dataBoundaries: ['browser', 'workspace-cloud', 'hybrid'],
    evidence: ['frontend/src/components/creation-canvas/CreationCanvas.test.tsx'],
    owner: 'Creation', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'not-required',
  },
  {
    id: 'human-approval-control',
    approvedCopy: 'Configured agent execution paths can require human approval, and dispatch is blocked when policy resolution fails.',
    status: 'available',
    scope: 'Runtime paths wired to the effective policy resolver',
    dataBoundaries: ['workspace-cloud', 'hybrid'],
    evidence: ['api/src/application/runtime/RuntimeService.policyGates.test.ts'],
    owner: 'Runtime & Governance', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'required',
  },
  {
    id: 'credential-encryption',
    approvedCopy: 'Credentials stored for supported integrations are encrypted with AES-256-GCM and scoped to a tenant.',
    status: 'available',
    scope: 'Credential stores covered by the integration encryption implementation',
    dataBoundaries: ['workspace-cloud', 'connected-service'],
    evidence: ['api/src/application/integrations/credentialCrypto.test.ts'],
    owner: 'Security', lastReviewed: '2026-08-04', reviewBy: '2026-10-03', complianceReview: 'required',
  },
  {
    id: 'browser-local-compute',
    approvedCopy: 'Supported WebGPU training and generation steps run in the browser; remote evaluation, collaboration, publishing, and connected services use their stated external boundaries.',
    status: 'beta',
    scope: 'Named WebGPU operations on compatible devices',
    dataBoundaries: ['browser', 'hybrid'],
    evidence: ['frontend/src/components/workflow-builder/EvermindBuildPanel.tsx'],
    owner: 'AI Studio', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'required',
  },
  {
    id: 'private-runtime-deployment',
    approvedCopy: 'The MIT-licensed BuilderForce Agents runtime can run on private infrastructure and use supported local models; hosted platform features remain separate services.',
    status: 'beta',
    scope: 'BuilderForce Agents runtime, excluding hosted collaboration and publishing services',
    dataBoundaries: ['hybrid'],
    evidence: ['agent-runtime/package.json', 'agent-runtime/docs/CLOUD_DEPLOY.md'],
    owner: 'Agent Runtime', lastReviewed: '2026-08-04', reviewBy: '2026-10-03', complianceReview: 'required',
  },
  {
    id: 'execution-observability',
    approvedCopy: 'Instrumented platform workflows emit available execution, usage, and tool-call records; coverage varies by surface.',
    status: 'beta',
    scope: 'Instrumented runtime and workflow paths',
    dataBoundaries: ['workspace-cloud', 'hybrid'],
    evidence: ['frontend/src/components/ObservabilityContent.tsx'],
    owner: 'Observability', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'required',
  },
] as const;

export interface IntegrationProof {
  name: string;
  status: CapabilityStatus;
  direction: 'import' | 'export' | 'two-way' | 'event-ingest';
  auth: string;
  dataBoundary: 'connected-service';
  limitation: string;
  evidence: string;
  lastVerified: string;
}

/** Public integration matrix: named connectors only, with no implied universal coverage. */
export const INTEGRATION_CAPABILITY_PROOF: readonly IntegrationProof[] = [
  { name: 'GitHub', status: 'beta', direction: 'two-way', auth: 'GitHub credential or app configuration', dataBoundary: 'connected-service', limitation: 'Repository, pull-request, and webhook behavior depends on installed permissions.', evidence: 'api/src/presentation/routes/githubWebhookRoutes.ts', lastVerified: '2026-08-04' },
  { name: 'Jira', status: 'beta', direction: 'two-way', auth: 'Provider credentials', dataBoundary: 'connected-service', limitation: 'Board and field mappings must be configured per workspace.', evidence: 'api/src/application/boardsync/providerCatalog.ts', lastVerified: '2026-08-04' },
  { name: 'Confluence', status: 'beta', direction: 'import', auth: 'Provider credentials', dataBoundary: 'connected-service', limitation: 'Imported content remains subject to source permissions and refresh behavior.', evidence: 'api/src/application/boardsync/providerCatalog.ts', lastVerified: '2026-08-04' },
  { name: 'Sentry', status: 'beta', direction: 'event-ingest', auth: 'Webhook or provider credentials', dataBoundary: 'connected-service', limitation: 'Only configured projects and supported event fields are ingested.', evidence: 'api/src/application/quality/errorEventsLedger.ts', lastVerified: '2026-08-04' },
  { name: 'PostHog', status: 'beta', direction: 'event-ingest', auth: 'Webhook configuration', dataBoundary: 'connected-service', limitation: 'Coverage is limited to configured event sources and mappings.', evidence: 'api/src/application/quality/errorEventsLedger.ts', lastVerified: '2026-08-04' },
] as const;

export interface WorkflowProofDemo {
  id: string;
  status: 'beta';
  dataBoundary: CapabilityDataBoundary;
  evidence: readonly string[];
  limitation: string;
}

/** Three conversion workflows backed by repository-owned journey evidence. */
export const WORKFLOW_PROOF_DEMOS: readonly WorkflowProofDemo[] = [
  { id: 'idea-to-experience', status: 'beta', dataBoundary: 'hybrid', evidence: ['frontend/src/components/creation-canvas/CreationCanvas.test.tsx'], limitation: 'Delivery targets are limited to the artifact and handoff types named in the Creation Canvas.' },
  { id: 'governed-agent-delivery', status: 'beta', dataBoundary: 'hybrid', evidence: ['api/src/application/runtime/RuntimeService.policyGates.test.ts'], limitation: 'Approval behavior applies to execution paths wired to the effective policy resolver.' },
  { id: 'signal-to-decision', status: 'beta', dataBoundary: 'connected-service', evidence: ['frontend/src/lib/creationCanvasAi.test.ts'], limitation: 'Source freshness and citation coverage depend on the configured connected systems.' },
] as const;

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
      { href: '/sell-builderforce', labelKey: 'linkSellBuilderforce' },
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
    tagline: 'Compare editor assistance with connected, governed delivery',
    summary:
      'Compare current support for editor assistance, shared creative work, multi-agent workflows, deployment boundaries, approvals, and retained execution evidence.',
    verdict:
      'Choose against your required workflow and verify current vendor capabilities, pricing, and data handling before deciding.',
  },
  cursor: {
    slug: 'cursor',
    name: 'Cursor & Windsurf',
    tagline: 'Compare AI-native editing with a connected creative canvas',
    summary:
      'Compare current support for editing, visual creation, collaboration, workflow orchestration, model choice, and private-runtime requirements.',
    verdict:
      'Choose the product that covers your primary workflow and confirm any critical integration or deployment requirement directly.',
  },
  claudeCode: {
    slug: 'claude-code',
    name: 'Claude Code',
    tagline: 'Compare terminal engineering with multi-surface delivery',
    summary:
      'Compare current terminal workflows, model requirements, collaboration, agent orchestration, approvals, and observable delivery paths.',
    verdict:
      'Validate the current model catalog and governance coverage for the exact work you intend to run.',
  },
  devin: {
    slug: 'devin',
    name: 'Devin',
    tagline: 'Compare hosted autonomy with configurable delivery workflows',
    summary:
      'Compare hosted execution, private-runtime options, collaboration, approvals, recovery behavior, and current pricing using dated vendor evidence.',
    verdict:
      'Select the operating model that matches your infrastructure, oversight, and delivery requirements.',
  },
  openhands: {
    slug: 'openhands',
    name: 'OpenHands',
    tagline: 'Compare open engineering runtimes and workflow coordination',
    summary:
      'Compare runtime ownership, supported orchestration patterns, approval coverage, project memory, and operational evidence.',
    verdict:
      'Verify the workflow and governance features you need in the current releases of both products.',
  },
  aider: {
    slug: 'aider',
    name: 'Aider',
    tagline: 'Compare git-aware CLI work with coordinated delivery',
    summary:
      'Compare git-aware editing, multi-agent workflow support, approvals, memory, model options, and deployment boundaries.',
    verdict:
      'Choose based on whether your primary need is focused CLI editing or a broader shared delivery system.',
  },
  continueDev: {
    slug: 'continue-dev',
    name: 'Continue.dev',
    tagline: 'Compare open editor assistance with connected delivery',
    summary:
      'Compare current editor support, model choices, shared workflows, approval controls, memory, and delivery surfaces.',
    verdict:
      'Validate the capabilities important to your team against current documentation and a representative workflow.',
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
      'Connect Builderforce.ai to GitHub for supported repository, branch, pull-request, and webhook workflows. Permissions, approval coverage, and retained evidence depend on the configured path.',
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
    tagline: 'Use supported local models from a private agent runtime',
    summary:
      'BuilderForce Agents can use supported Ollama models on private infrastructure. Hosted collaboration, publishing, remote evaluation, and connected services remain outside that local runtime boundary.',
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
  'creation-canvas': [
    'creation-canvas-beyond-chat',
    'compare-projects-and-build-an-executive-roadmap',
    'customer-feedback-to-ten-mockups',
    'build-and-train-evermind-on-the-creation-canvas',
    'multiplayer-creation-canvas-web-vscode',
  ],
  product: [
    'creation-canvas-beyond-chat',
    'customer-feedback-to-ten-mockups',
    'multiplayer-creation-canvas-web-vscode',
    'compare-projects-and-build-an-executive-roadmap',
    'build-and-train-evermind-on-the-creation-canvas',
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
    'build-and-train-evermind-on-the-creation-canvas',
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
