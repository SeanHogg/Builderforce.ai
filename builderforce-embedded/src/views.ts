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

export const EMBED_VIEWS = {
  // Product Management
  ideas:                 { key: 'ideas',                 label: 'Product Discovery',   pillar: 'product',    available: false },
  prd:                   { key: 'prd',                   label: 'PRDs & Specs',        pillar: 'product',    available: false },
  backlog:               { key: 'backlog',               label: 'Strategic Backlog',   pillar: 'product',    available: true  },
  mvp:                   { key: 'mvp',                   label: 'MVP Scaffolding',     pillar: 'product',    available: false },
  validation:            { key: 'validation',            label: 'Validation Lab',      pillar: 'product',    available: false },
  roadmap:               { key: 'roadmap',               label: 'AI Roadmap',          pillar: 'product',    available: false },
  'feature-roi':         { key: 'feature-roi',           label: 'Feature ROI',         pillar: 'product',    available: false },

  // Agile Survival
  kanban:                { key: 'kanban',                label: 'Kanban',              pillar: 'agile',      available: true  },
  poker:                 { key: 'poker',                 label: 'Planning Poker',      pillar: 'agile',      available: false },
  retros:                { key: 'retros',                label: 'Retrospectives',      pillar: 'agile',      available: false },
  sprints:               { key: 'sprints',               label: 'Sprint Planning',     pillar: 'agile',      available: false },
  velocity:              { key: 'velocity',              label: 'Velocity',            pillar: 'agile',      available: false },
  'feature-scoring':     { key: 'feature-scoring',       label: 'Feature Scoring',     pillar: 'agile',      available: false },

  // Security, Governance & Compliance (governance ⇒ 'security' capability)
  security:              { key: 'security',              label: 'Sessions & Access',   pillar: 'governance', available: false },
  approvals:             { key: 'approvals',             label: 'Approvals',           pillar: 'governance', available: false },
  soc2:                  { key: 'soc2',                  label: 'SOC 2 Tracker',       pillar: 'governance', available: false },
  vendors:               { key: 'vendors',               label: 'Vendor Register',     pillar: 'governance', available: false },
  incidents:             { key: 'incidents',             label: 'Security Incidents',  pillar: 'governance', available: false },
  'data-inventory':      { key: 'data-inventory',        label: 'PII & Data Inventory', pillar: 'governance', available: false },
  dpa:                   { key: 'dpa',                   label: 'DPA Management',      pillar: 'governance', available: false },
  training:              { key: 'training',              label: 'Security Training',   pillar: 'governance', available: false },
  'compliance-calendar': { key: 'compliance-calendar',   label: 'Compliance Calendar', pillar: 'governance', available: false },
  'access-reviews':      { key: 'access-reviews',        label: 'Access Reviews',      pillar: 'governance', available: false },
  'vuln-scans':          { key: 'vuln-scans',            label: 'Vulnerability Scans', pillar: 'governance', available: false },
  dsr:                   { key: 'dsr',                   label: 'Data Subject Requests', pillar: 'governance', available: false },
  suppression:           { key: 'suppression',           label: 'Suppression List',    pillar: 'governance', available: false },
} as const satisfies Record<string, EmbedViewMeta>;

export type EmbedView = keyof typeof EMBED_VIEWS;

export const EMBED_VIEW_KEYS = Object.keys(EMBED_VIEWS) as EmbedView[];

export function isEmbedView(value: string): value is EmbedView {
  return Object.prototype.hasOwnProperty.call(EMBED_VIEWS, value);
}

export function embedViewsByPillar(pillar: EmbedPillar): EmbedViewMeta[] {
  return EMBED_VIEW_KEYS.map((k) => EMBED_VIEWS[k]).filter((v) => v.pillar === pillar);
}

/** The capability that gates a given view (for host nav + frame self-gating). */
export function capabilityForView(view: EmbedView): EmbedCapability {
  return pillarToCapability(EMBED_VIEWS[view].pillar);
}
