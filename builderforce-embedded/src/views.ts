/**
 * The canonical registry of embeddable BuilderForce surfaces. This is the ONE
 * place the set of views lives — the host <BuilderForceEmbed> validates against
 * it, the BuilderForce frame route resolves `[view]` against it, and host nav
 * can render menus from it. Adding a surface = one entry here.
 *
 * `available` = the embed surface is wired to a real, working app component
 * today (resurfaced, not reimplemented). `available: false` = the view is
 * registered but renders a "coming soon" scaffold until its feature is built or
 * wired. Host nav should show available views as active.
 *
 * Keys match the `view="…"` values in specs/builderforce docs 05 §5.2 and 07 §7.
 */

export type EmbedPillar = 'product' | 'agile' | 'governance';

/** The three capability areas a host SuperAdmin enables (governance ⇒ security). */
export type EmbedCapability = 'product' | 'agile' | 'security';

export const EMBED_CAPABILITIES: readonly EmbedCapability[] = ['product', 'agile', 'security'];

/**
 * The current version of the embed-enablement consent text. Bump this whenever
 * the legal/consent copy shown before a host enables embedding changes; a tenant
 * whose recorded `consentVersion` is below this must re-consent. Single source of
 * truth — the frontend consent modal and the API both key off it (the API mirrors
 * the value with a comment, same posture as EMBED_CAPABILITIES).
 */
export const EMBED_CONSENT_VERSION = 1;

/** Map a surface's pillar to the capability that gates it. Single source of truth. */
export function pillarToCapability(pillar: EmbedPillar): EmbedCapability {
  return pillar === 'governance' ? 'security' : pillar;
}

export interface EmbedViewMeta {
  /** URL-safe view key (the iframe loads `/embed/<key>`). */
  key: string;
  /** Human label for host nav / titles. */
  label: string;
  /** Which product pillar the surface belongs to. */
  pillar: EmbedPillar;
  /** True when the surface renders a real, working component today. */
  available: boolean;
}

// Scope: Product Management (CPO/PMO), Agile Survival (CTO), and the full
// Governance & Security TOOLSET (CISO/CSO) EXCEPT identity. BuilderForce provides
// every security tool BurnRateOS had; the ONLY exclusions are RBAC and
// centralized authentication (sessions, MFA/account-security, approval
// workflows, identity/login audit) — those stay in BurnRateOS as the IdP. So
// DSR + suppression (data-privacy tools, scoped per-Segment) ARE included.
// Operational Cadence → hired.video, absent. Views are FUNCTIONAL surfaces, not
// 1-1 page ports — e.g. action items and calendar are served by the tasks
// surface, not separate views.
export const EMBED_VIEWS = {
  // Product Management (CPO/PMO)
  ideas:                 { key: 'ideas',                 label: 'Product Discovery',   pillar: 'product',    available: true  },
  prd:                   { key: 'prd',                   label: 'PRDs & Specs',        pillar: 'product',    available: true  },
  backlog:               { key: 'backlog',               label: 'Strategic Backlog',   pillar: 'product',    available: true  },
  mvp:                   { key: 'mvp',                   label: 'MVP Scaffolding',     pillar: 'product',    available: true  },
  validation:            { key: 'validation',            label: 'Validation Lab',      pillar: 'product',    available: true  },
  roadmap:               { key: 'roadmap',               label: 'AI Roadmap',          pillar: 'product',    available: true  },
  'release-planning':    { key: 'release-planning',      label: 'Release Planning',    pillar: 'product',    available: true  },
  changelog:             { key: 'changelog',             label: 'Changelog',           pillar: 'product',    available: true  },
  'feature-flags':       { key: 'feature-flags',         label: 'Feature Flags',       pillar: 'product',    available: true  },
  'feature-roi':         { key: 'feature-roi',           label: 'Feature ROI',         pillar: 'product',    available: true  },
  'business-value':      { key: 'business-value',        label: 'Business-Value Models', pillar: 'product',  available: true  },
  'dependency-graph':    { key: 'dependency-graph',       label: 'Dependency Graph',    pillar: 'product',    available: true  },
  'rice-matrix':         { key: 'rice-matrix',            label: 'RICE Matrix',         pillar: 'product',    available: true  },
  'roi-dashboard':       { key: 'roi-dashboard',          label: 'ROI Dashboard',       pillar: 'product',    available: true  },

  // Agile Survival (CTO)
  kanban:                { key: 'kanban',                label: 'Kanban',              pillar: 'agile',      available: true  },
  poker:                 { key: 'poker',                 label: 'Planning Poker',      pillar: 'agile',      available: true  },
  retros:                { key: 'retros',                label: 'Retrospectives',      pillar: 'agile',      available: true  },
  sprints:               { key: 'sprints',               label: 'Sprint Planning',     pillar: 'agile',      available: true  },
  velocity:              { key: 'velocity',              label: 'Velocity',            pillar: 'agile',      available: true  },
  capacity:              { key: 'capacity',              label: 'Capacity & Risk',     pillar: 'agile',      available: true  },
  cost:                  { key: 'cost',                  label: 'Cost / Runway',       pillar: 'agile',      available: true  },
  'feature-scoring':     { key: 'feature-scoring',       label: 'Feature Scoring',     pillar: 'agile',      available: true  },

  // Governance & Security — POSTURE ONLY (governance ⇒ 'security' capability)
  soc2:                  { key: 'soc2',                  label: 'SOC 2 Tracker',       pillar: 'governance', available: true  },
  vendors:               { key: 'vendors',               label: 'Vendor Register',     pillar: 'governance', available: true  },
  incidents:             { key: 'incidents',             label: 'Security Incidents',  pillar: 'governance', available: true  },
  'data-inventory':      { key: 'data-inventory',        label: 'PII & Data Inventory', pillar: 'governance', available: true  },
  dpa:                   { key: 'dpa',                   label: 'DPA Management',      pillar: 'governance', available: true  },
  training:              { key: 'training',              label: 'Security Training',   pillar: 'governance', available: true  },
  'compliance-calendar': { key: 'compliance-calendar',   label: 'Compliance Calendar', pillar: 'governance', available: true  },
  'access-reviews':      { key: 'access-reviews',        label: 'Access Reviews',      pillar: 'governance', available: true  },
  'vuln-scans':          { key: 'vuln-scans',            label: 'Vulnerability Scans', pillar: 'governance', available: true  },
  // Data-privacy tools, scoped per-Segment (NOT identity/RBAC) — BuilderForce
  // provides these; BurnRateOS keeps its own platform-global shared-graph DSR.
  dsr:                   { key: 'dsr',                   label: 'Data Subject Requests', pillar: 'governance', available: true  },
  suppression:           { key: 'suppression',           label: 'Suppression List',    pillar: 'governance', available: true  },
} as const satisfies Record<string, EmbedViewMeta>;

export type EmbedView = keyof typeof EMBED_VIEWS;

export const EMBED_VIEW_KEYS = Object.keys(EMBED_VIEWS) as EmbedView[];

export function isEmbedView(value: string): value is EmbedView {
  return Object.prototype.hasOwnProperty.call(EMBED_VIEWS, value);
}

/** The capability that gates a given view (for host nav + frame self-gating). */
export function capabilityForView(view: EmbedView): EmbedCapability {
  return pillarToCapability(EMBED_VIEWS[view].pillar);
}
