/**
 * Demo-account persona blueprints (migration 0360) — the seed data for the five
 * sales-cycle demo tenants entered from the marketing shell. Each blueprint is a
 * declarative description of one persona's workspace (projects, board, agents,
 * OKRs, knowledge, usage); demoSeedService.ts interprets it idempotently on every
 * reseed (deploy hook + nightly cron), so visitor changes never survive.
 *
 * Persona keys are stable API/analytics identifiers — the frontend maps them to
 * localized marketing copy; do not rename without migrating tenants.demo_persona.
 */

export type DemoPersonaKey = 'ai-team' | 'insights' | 'pmo' | 'talent' | 'governance';

export const DEMO_PERSONA_KEYS: DemoPersonaKey[] = ['ai-team', 'insights', 'pmo', 'talent', 'governance'];

export function isDemoPersona(value: unknown): value is DemoPersonaKey {
  return typeof value === 'string' && (DEMO_PERSONA_KEYS as string[]).includes(value);
}

export const demoUserEmail = (key: DemoPersonaKey): string => `demo-${key}@builderforce.ai`;

export interface DemoTaskSeed {
  /** Globally-unique task key suffix — prefixed `DEMO-<persona>` by the seeder. */
  key: string;
  title: string;
  description?: string;
  status: 'backlog' | 'todo' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  epic?: boolean;
  /** Task key (suffix) of the parent epic. */
  parentKey?: string;
  /** 'user' = the demo human; string = agent idSlug from the blueprint or a builtin kind. */
  assignee?: 'user' | string;
  points?: number;
  /** How many days ago the task completed (done tasks only). */
  completedDaysAgo?: number;
}

export interface DemoProjectSeed {
  /** Globally-unique project key — must be unique across ALL personas. */
  key: string;
  name: string;
  description: string;
  tasks: DemoTaskSeed[];
  errorGroups?: Array<{
    fingerprint: string;
    title: string;
    type: string;
    level: 'fatal' | 'error' | 'warning' | 'info';
    status: 'unresolved' | 'resolved' | 'fixing';
    eventCount: number;
    userCount: number;
  }>;
}

export interface DemoAgentSeed {
  /** Stable per-tenant agent id becomes `demo-<idSlug>-t<tenantId>`. */
  idSlug: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
  published?: boolean;
  hireCount?: number;
}

export interface DemoObjectiveSeed {
  title: string;
  description: string;
  keyResults: Array<{
    title: string;
    metricType: 'number' | 'percent' | 'currency' | 'boolean';
    start: number;
    target: number;
    current: number;
    unit?: string;
    status: 'on_track' | 'at_risk' | 'off_track' | 'done';
  }>;
  /** Task key suffixes this objective rolls up. */
  linkTaskKeys?: string[];
}

export interface DemoKnowledgeSeed {
  title: string;
  docType: 'sop' | 'process' | 'doc' | 'postmortem';
  summary: string;
  content: string;
  requiresAck?: boolean;
}

export interface DemoActivitySeed {
  verb: string;
  actorType: 'human' | 'cloud_agent' | 'system';
  /** Agent idSlug / builtin kind when actorType is cloud_agent; ignored otherwise. */
  actor?: string;
  summary: string;
  daysAgo: number;
}

export interface DemoBlueprint {
  key: DemoPersonaKey;
  tenantName: string;
  user: { displayName: string; username: string };
  /** In-app route the demo session lands on. */
  entryPath: string;
  agents: DemoAgentSeed[];
  projects: DemoProjectSeed[];
  portfolio?: {
    name: string;
    description: string;
    initiatives: Array<{ name: string; description: string; status: 'proposed' | 'active' | 'completed'; startDaysAgo: number; targetDaysAhead: number }>;
  };
  objectives?: DemoObjectiveSeed[];
  knowledge?: DemoKnowledgeSeed[];
  activity?: DemoActivitySeed[];
  /** Approximate llm_usage_log rows per day over the trailing 14 days (0 = none). */
  usagePerDay?: number;
}

const CODER = {
  idSlug: 'coder',
  name: 'Atlas',
  title: 'AI Software Engineer — takes tickets from Ready to PR',
  bio: 'Picks up Ready tickets from the board, plans the change, writes the code on a branch, and opens a pull request with CI feedback wired back to the ticket. Steerable mid-run from the ticket chat.',
  skills: ['typescript', 'react', 'api-design', 'testing', 'refactoring'],
} satisfies DemoAgentSeed;

export const DEMO_BLUEPRINTS: DemoBlueprint[] = [
  // ── 1. AI Software Team — the flagship "agents as team members" demo ──────
  {
    key: 'ai-team',
    tenantName: 'Nova Commerce (Demo)',
    user: { displayName: 'Sam Rivera', username: 'demo-ai-team' },
    entryPath: '/dashboard',
    agents: [
      CODER,
      {
        idSlug: 'reviewer',
        name: 'Vega',
        title: 'AI Code Reviewer — every PR reviewed before merge',
        bio: 'Reviews every agent and human pull request for correctness, tests, and conventions, and requests changes with concrete diffs before work is merged.',
        skills: ['code-review', 'testing', 'security', 'conventions'],
      },
    ],
    projects: [
      {
        key: 'DEMO-SHOP',
        name: 'Storefront Platform',
        description: 'Customer-facing storefront: catalog, cart, checkout, and order tracking. Humans and AI agents share this board — drag a ticket to Ready and an agent picks it up.',
        tasks: [
          { key: 'SHOP-1', title: 'Checkout revamp', description: 'Epic: rebuild the checkout flow for conversion — fewer steps, saved payment methods, express wallets.', status: 'in_progress', epic: true, priority: 'high', assignee: 'user' },
          { key: 'SHOP-2', title: 'Add Apple Pay / Google Pay express checkout', description: 'Wire the payment-request API into the cart page behind a feature flag. Acceptance: one-tap purchase from the cart on supported devices.', status: 'in_progress', parentKey: 'SHOP-1', priority: 'high', assignee: 'coder', points: 5 },
          { key: 'SHOP-3', title: 'Persist cart across devices for signed-in shoppers', description: 'Move cart state server-side keyed by account; merge anonymous cart on sign-in.', status: 'in_review', parentKey: 'SHOP-1', priority: 'medium', assignee: 'coder', points: 3 },
          { key: 'SHOP-4', title: 'Fix rounding error in multi-currency totals', description: 'Totals drift by ±1 cent when the display currency differs from the charge currency. Root cause: summing after conversion.', status: 'done', priority: 'urgent', assignee: 'coder', points: 2, completedDaysAgo: 1 },
          { key: 'SHOP-5', title: 'Order-status email notifications', description: 'Transactional emails on paid / shipped / delivered transitions with locale-aware templates.', status: 'done', parentKey: 'SHOP-1', priority: 'medium', assignee: 'coder', points: 3, completedDaysAgo: 3 },
          { key: 'SHOP-6', title: 'Product page performance: lazy-load reviews', description: 'Reviews block first paint on long pages. Defer below the fold and hydrate on scroll.', status: 'done', priority: 'medium', assignee: 'user', points: 2, completedDaysAgo: 5 },
          { key: 'SHOP-7', title: 'Inventory low-stock badge on listing cards', status: 'ready', priority: 'low', points: 1 },
          { key: 'SHOP-8', title: 'Gift-card redemption at checkout', status: 'ready', priority: 'medium', points: 5 },
          { key: 'SHOP-9', title: 'Wishlist sharing links', status: 'todo', priority: 'low', points: 2 },
          { key: 'SHOP-10', title: 'Migrate product search to typo-tolerant engine', status: 'backlog', priority: 'medium', points: 8 },
          { key: 'SHOP-11', title: 'A/B test framework for merch banners', status: 'backlog', priority: 'low', points: 5 },
        ],
      },
    ],
    activity: [
      { verb: 'run.completed', actorType: 'cloud_agent', actor: 'coder', summary: 'Atlas finished SHOP-4: fixed multi-currency rounding by summing in charge currency before conversion. PR opened with 2 new unit tests.', daysAgo: 1 },
      { verb: 'review.requested_changes', actorType: 'cloud_agent', actor: 'reviewer', summary: 'Vega requested changes on SHOP-3: cart merge overwrote the newer anonymous cart; suggested last-write-wins by line item.', daysAgo: 2 },
      { verb: 'task.completed', actorType: 'cloud_agent', actor: 'coder', summary: 'Atlas shipped SHOP-5 order-status emails — all three transitions covered with locale templates.', daysAgo: 3 },
      { verb: 'standup.recorded', actorType: 'system', summary: 'Daily standup: 2 tickets in progress, 1 in review, no blockers. Atlas picked up SHOP-2 express checkout.', daysAgo: 1 },
      { verb: 'task.completed', actorType: 'human', summary: 'Sam completed SHOP-6 product page performance work.', daysAgo: 5 },
    ],
    usagePerDay: 3,
  },

  // ── 2. Engineering ROI / Insights — the economic-buyer demo ───────────────
  {
    key: 'insights',
    tenantName: 'Meridian Labs (Demo)',
    user: { displayName: 'Priya Sharma', username: 'demo-insights' },
    entryPath: '/insights',
    agents: [CODER],
    projects: [
      {
        key: 'DEMO-CORE',
        name: 'Core Platform',
        description: 'The revenue-critical API and web platform. Watch delivery health, AI impact, and cost per ticket roll up in Insights.',
        tasks: [
          { key: 'CORE-1', title: 'Rate-limit public API per plan tier', status: 'done', priority: 'high', assignee: 'coder', points: 5, completedDaysAgo: 2 },
          { key: 'CORE-2', title: 'Nightly usage-rollup job for billing', status: 'done', priority: 'high', assignee: 'coder', points: 3, completedDaysAgo: 4 },
          { key: 'CORE-3', title: 'Self-serve plan upgrade flow', status: 'done', priority: 'medium', assignee: 'user', points: 5, completedDaysAgo: 6 },
          { key: 'CORE-4', title: 'Webhook retry with exponential backoff', status: 'done', priority: 'medium', assignee: 'coder', points: 3, completedDaysAgo: 8 },
          { key: 'CORE-5', title: 'Customer data export (GDPR)', status: 'in_progress', priority: 'high', assignee: 'coder', points: 5 },
          { key: 'CORE-6', title: 'Reduce cold-start latency on edge workers', status: 'in_review', priority: 'medium', assignee: 'coder', points: 3 },
          { key: 'CORE-7', title: 'Usage anomaly alerts for account teams', status: 'ready', priority: 'medium', points: 3 },
          { key: 'CORE-8', title: 'Deprecate v1 API endpoints', status: 'backlog', priority: 'low', points: 8 },
        ],
        errorGroups: [
          { fingerprint: 'demo-timeout-payments', title: 'TimeoutError: payment provider webhook exceeded 10s', type: 'TimeoutError', level: 'error', status: 'fixing', eventCount: 142, userCount: 37 },
          { fingerprint: 'demo-nullref-export', title: "TypeError: cannot read 'locale' of undefined in export job", type: 'TypeError', level: 'error', status: 'unresolved', eventCount: 23, userCount: 9 },
          { fingerprint: 'demo-deprecation-v1', title: 'DeprecationWarning: v1 /orders endpoint called', type: 'DeprecationWarning', level: 'warning', status: 'unresolved', eventCount: 611, userCount: 84 },
        ],
      },
    ],
    objectives: [
      {
        title: 'Cut cost per shipped ticket 40% with AI delivery',
        description: 'Blend agent-executed tickets into the delivery flow and measure fully-loaded cost per shipped story point.',
        keyResults: [
          { title: 'Cost per shipped ticket', metricType: 'currency', start: 410, target: 246, current: 291, unit: 'USD', status: 'on_track' },
          { title: 'Tickets shipped by agents', metricType: 'percent', start: 0, target: 40, current: 31, status: 'on_track' },
        ],
        linkTaskKeys: ['CORE-1', 'CORE-2', 'CORE-4'],
      },
    ],
    activity: [
      { verb: 'deploy.recorded', actorType: 'system', summary: 'Production deploy #214 — 6 tickets shipped, lead time 2.1 days (p50).', daysAgo: 1 },
      { verb: 'run.completed', actorType: 'cloud_agent', actor: 'coder', summary: 'Atlas completed CORE-1 plan-tier rate limiting: 34k tokens, $0.87 attributed to the ticket.', daysAgo: 2 },
      { verb: 'deploy.recorded', actorType: 'system', summary: 'Production deploy #213 — 4 tickets shipped, change-failure rate 0%.', daysAgo: 4 },
      { verb: 'run.completed', actorType: 'cloud_agent', actor: 'coder', summary: 'Atlas completed CORE-4 webhook retries with idempotency keys and jittered backoff.', daysAgo: 8 },
    ],
    usagePerDay: 8,
  },

  // ── 3. PMO Command Center — portfolio→OKR→task planning spine ────────────
  {
    key: 'pmo',
    tenantName: 'Atlas Group PMO (Demo)',
    user: { displayName: 'Jordan Lee', username: 'demo-pmo' },
    entryPath: '/pmo',
    agents: [CODER],
    projects: [
      {
        key: 'DEMO-MOBILE',
        name: 'Mobile App Relaunch',
        description: 'The flagship initiative deliverable: rebuilt mobile experience shipping in phases.',
        tasks: [
          { key: 'MOB-1', title: 'Design system parity on mobile', status: 'done', priority: 'high', assignee: 'user', points: 8, completedDaysAgo: 10 },
          { key: 'MOB-2', title: 'Offline mode for order history', status: 'in_progress', priority: 'high', assignee: 'coder', points: 5 },
          { key: 'MOB-3', title: 'Push-notification preference center', status: 'ready', priority: 'medium', points: 3 },
          { key: 'MOB-4', title: 'Biometric sign-in', status: 'in_review', priority: 'medium', assignee: 'coder', points: 3 },
          { key: 'MOB-5', title: 'App-store launch checklist', status: 'todo', priority: 'high', points: 2 },
        ],
      },
      {
        key: 'DEMO-DATA',
        name: 'Data Platform Modernization',
        description: 'Second portfolio workstream: consolidate reporting onto the new warehouse.',
        tasks: [
          { key: 'DATA-1', title: 'Migrate finance marts to new warehouse', status: 'in_progress', priority: 'high', assignee: 'coder', points: 8 },
          { key: 'DATA-2', title: 'Deprecate legacy nightly extracts', status: 'blocked', priority: 'medium', points: 5 },
          { key: 'DATA-3', title: 'Self-serve dashboard templates', status: 'done', priority: 'medium', assignee: 'coder', points: 3, completedDaysAgo: 6 },
        ],
      },
    ],
    portfolio: {
      name: 'FY26 Digital Portfolio',
      description: 'The board-visible investment portfolio: two funded initiatives with dated milestones rolling up to company OKRs.',
      initiatives: [
        { name: 'Mobile Relaunch', description: 'Rebuild the mobile experience; phased release through Q3.', status: 'active', startDaysAgo: 60, targetDaysAhead: 45 },
        { name: 'Data Platform Modernization', description: 'One warehouse, one semantic layer, self-serve analytics.', status: 'active', startDaysAgo: 40, targetDaysAhead: 90 },
      ],
    },
    objectives: [
      {
        title: 'Ship the mobile relaunch to 100% of users by Q3',
        description: 'Phased rollout with quality gates at each phase.',
        keyResults: [
          { title: 'Rollout coverage', metricType: 'percent', start: 0, target: 100, current: 35, status: 'on_track' },
          { title: 'Crash-free sessions', metricType: 'percent', start: 97.1, target: 99.5, current: 99.2, status: 'on_track' },
        ],
        linkTaskKeys: ['MOB-1', 'MOB-2', 'MOB-4'],
      },
      {
        title: 'Retire the legacy reporting stack',
        description: 'Every consumer on the new warehouse; legacy extracts switched off.',
        keyResults: [
          { title: 'Marts migrated', metricType: 'number', start: 0, target: 24, current: 14, unit: 'marts', status: 'at_risk' },
        ],
        linkTaskKeys: ['DATA-1', 'DATA-2'],
      },
    ],
    activity: [
      { verb: 'ceremony.completed', actorType: 'system', summary: 'Sprint planning: 21 points committed across Mobile Relaunch and Data Platform.', daysAgo: 2 },
      { verb: 'initiative.status_changed', actorType: 'human', summary: 'Jordan flagged "Retire legacy reporting" at risk — blocked on finance sign-off for extract cutover.', daysAgo: 3 },
      { verb: 'task.completed', actorType: 'cloud_agent', actor: 'coder', summary: 'Atlas delivered DATA-3 self-serve dashboard templates.', daysAgo: 6 },
    ],
    usagePerDay: 4,
  },

  // ── 4. Talent & Marketplace — agencies / freelancers ─────────────────────
  {
    key: 'talent',
    tenantName: 'Brightside Studio (Demo)',
    user: { displayName: 'Alex Chen', username: 'demo-talent' },
    entryPath: '/workforce',
    agents: [
      { ...CODER, published: true, hireCount: 12 },
      {
        idSlug: 'copywriter',
        name: 'Lyra',
        title: 'AI Content Specialist — product copy, docs, and localization',
        bio: 'Writes product copy, help-center articles, and release notes in your brand voice, and keeps five locales in sync.',
        skills: ['copywriting', 'documentation', 'localization', 'seo'],
        published: true,
        hireCount: 8,
      },
    ],
    projects: [
      {
        key: 'DEMO-CLIENT',
        name: 'Client: Harbor Fitness',
        description: 'A client engagement staffed with a mixed roster — your people, hired freelancers, and AI agents on one board.',
        tasks: [
          { key: 'CLI-1', title: 'Marketing site refresh', status: 'in_progress', priority: 'high', epic: true, assignee: 'user' },
          { key: 'CLI-2', title: 'New pricing page with plan comparison', status: 'in_review', parentKey: 'CLI-1', priority: 'high', assignee: 'coder', points: 3 },
          { key: 'CLI-3', title: 'Rewrite onboarding email sequence', status: 'done', parentKey: 'CLI-1', priority: 'medium', assignee: 'copywriter', points: 2, completedDaysAgo: 2 },
          { key: 'CLI-4', title: 'Class-schedule booking widget', status: 'ready', priority: 'medium', points: 5 },
          { key: 'CLI-5', title: 'Localize site to Spanish and French', status: 'todo', priority: 'medium', assignee: 'copywriter', points: 3 },
        ],
      },
    ],
    activity: [
      { verb: 'engagement.started', actorType: 'human', summary: 'Alex hired a freelance designer through the Talent marketplace for the Harbor Fitness refresh.', daysAgo: 4 },
      { verb: 'task.completed', actorType: 'cloud_agent', actor: 'copywriter', summary: 'Lyra delivered the onboarding email sequence — 6 emails, brand-voice checked.', daysAgo: 2 },
      { verb: 'agent.hired', actorType: 'system', summary: 'Atlas was hired by another workspace from the public marketplace (12 total hires).', daysAgo: 1 },
    ],
    usagePerDay: 2,
  },

  // ── 5. Security / Architecture / Governance ──────────────────────────────
  {
    key: 'governance',
    tenantName: 'Ledgerline Financial (Demo)',
    user: { displayName: 'Morgan Diaz', username: 'demo-governance' },
    entryPath: '/quality',
    agents: [CODER],
    projects: [
      {
        key: 'DEMO-BANK',
        name: 'Ledger Core',
        description: 'A regulated fintech codebase: the Security agent audits it weekly against SOC 2, findings become tracked remediation tickets, and every action lands in the immutable audit trail.',
        tasks: [
          { key: 'SEC-1', title: 'Remediate: rotate long-lived service credentials (CC6.1)', description: 'Security-agent finding: two service tokens have no rotation policy. Move to short-lived credentials with automated rotation.', status: 'in_progress', priority: 'urgent', assignee: 'coder', points: 5 },
          { key: 'SEC-2', title: 'Remediate: add rate limiting to password reset (CC6.6)', description: 'Security-agent finding: reset endpoint accepts unlimited attempts. Add per-IP and per-account throttles.', status: 'done', priority: 'high', assignee: 'coder', points: 3, completedDaysAgo: 3 },
          { key: 'SEC-3', title: 'Remediate: encrypt PII columns at rest (C1.1)', description: 'Security-agent finding: two tables hold unencrypted PII. Introduce column-level encryption with key rotation.', status: 'in_review', priority: 'high', assignee: 'coder', points: 8 },
          { key: 'SEC-4', title: 'Architecture: isolate payment service behind private network', status: 'ready', priority: 'high', points: 8 },
          { key: 'SEC-5', title: 'Quarterly access review automation', status: 'todo', priority: 'medium', points: 5 },
          { key: 'SEC-6', title: 'Vendor-risk questionnaire pipeline', status: 'backlog', priority: 'low', points: 3 },
        ],
        errorGroups: [
          { fingerprint: 'demo-authz-denied', title: 'AuthorizationError: expired service token on ledger sync', type: 'AuthorizationError', level: 'error', status: 'fixing', eventCount: 31, userCount: 4 },
          { fingerprint: 'demo-tls-legacy', title: 'TLSWarning: client negotiated TLS 1.1 on legacy endpoint', type: 'TLSWarning', level: 'warning', status: 'unresolved', eventCount: 88, userCount: 12 },
        ],
      },
    ],
    knowledge: [
      {
        title: 'Access Control Policy (SOC 2 CC6)',
        docType: 'sop',
        summary: 'Who may access what, how access is granted, reviewed, and revoked. Read-acknowledgement required for all engineers.',
        content: '## Purpose\nDefine how access to production systems and customer data is granted, reviewed, and revoked.\n\n## Policy\n1. Access follows least privilege and is role-based.\n2. Production access requires MFA and is logged to the audit trail.\n3. Access is reviewed quarterly; the review itself is a tracked ticket.\n4. Credentials are short-lived; long-lived tokens are prohibited (see SEC-1).\n\n## Evidence\nRead-acknowledgements below are the audit evidence for control CC6.2.',
        requiresAck: true,
      },
      {
        title: 'Incident Response Runbook',
        docType: 'process',
        summary: 'Sev levels, paging, war-room, and post-mortem flow — from first alert to published RCA.',
        content: '## Severity levels\n- SEV1: customer-facing outage → page primary on-call immediately.\n- SEV2: degraded service → respond within 30 minutes.\n\n## Flow\nAlert → acknowledge → war-room chat → mitigate → post-mortem within 5 working days. The Incident Manager agent runs paging and escalation timers automatically.',
        requiresAck: true,
      },
      {
        title: 'Q2 SOC 2 Audit Summary',
        docType: 'doc',
        summary: 'Latest weekly Security-agent audit: 3 findings (1 critical, 2 high), all tracked as remediation tickets.',
        content: '## Scope\nFull codebase + dependency scan against all five Trust Service Criteria.\n\n## Findings\n| Severity | Criterion | Finding | Ticket |\n|---|---|---|---|\n| Critical | CC6.1 | Long-lived service credentials | SEC-1 |\n| High | CC6.6 | Unthrottled password reset | SEC-2 (resolved) |\n| High | C1.1 | Unencrypted PII columns | SEC-3 |\n\nEvery finding is an access-restricted ticket with an owner and a due date; progress is visible on the Quality dashboard.',
      },
    ],
    activity: [
      { verb: 'audit.completed', actorType: 'cloud_agent', actor: 'security', summary: 'Weekly SOC 2 audit finished: 3 findings filed as remediation tickets (1 critical, 2 high).', daysAgo: 2 },
      { verb: 'task.completed', actorType: 'cloud_agent', actor: 'coder', summary: 'Atlas closed SEC-2: password-reset throttling shipped with per-IP and per-account limits.', daysAgo: 3 },
      { verb: 'policy.acknowledged', actorType: 'human', summary: 'Morgan acknowledged the Access Control Policy v1 (audit evidence recorded).', daysAgo: 4 },
      { verb: 'approval.granted', actorType: 'human', summary: 'Production deploy approved after policy gate passed — approval recorded to the immutable audit trail.', daysAgo: 1 },
    ],
    usagePerDay: 3,
  },
];

export function getBlueprint(key: DemoPersonaKey): DemoBlueprint {
  const bp = DEMO_BLUEPRINTS.find((b) => b.key === key);
  if (!bp) throw new Error(`Unknown demo persona: ${key}`);
  return bp;
}
