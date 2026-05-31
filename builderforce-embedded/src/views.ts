/**
 * The canonical registry of embeddable BuilderForce surfaces. This is the ONE
 * place the set of views lives — the host <BuilderForceEmbed> validates against
 * it, the BuilderForce frame route resolves `[view]` against it, and host nav
 * can render menus from it. Adding a surface = one entry here.
 *
 * Keys match the `view="…"` values in specs/builderforce docs 05 §5.2 and 07 §7.
 */

export type EmbedPillar = 'product' | 'agile' | 'governance';

export interface EmbedViewMeta {
  /** URL-safe view key (the iframe loads `/embed/<key>`). */
  key: string;
  /** Human label for host nav / titles. */
  label: string;
  /** Which product pillar the surface belongs to. */
  pillar: EmbedPillar;
}

export const EMBED_VIEWS = {
  // Product Management (doc 02)
  ideas:                 { key: 'ideas',                 label: 'Product Discovery',   pillar: 'product' },
  mvp:                   { key: 'mvp',                   label: 'MVP Scaffolding',     pillar: 'product' },
  backlog:               { key: 'backlog',               label: 'Strategic Backlog',   pillar: 'product' },
  validation:            { key: 'validation',            label: 'Validation Lab',      pillar: 'product' },
  roadmap:               { key: 'roadmap',               label: 'AI Roadmap',          pillar: 'product' },
  'feature-roi':         { key: 'feature-roi',           label: 'Feature ROI',         pillar: 'product' },

  // Agile Survival (doc 03)
  kanban:                { key: 'kanban',                label: 'Kanban',              pillar: 'agile' },
  poker:                 { key: 'poker',                 label: 'Planning Poker',      pillar: 'agile' },
  retros:                { key: 'retros',                label: 'Retrospectives',      pillar: 'agile' },
  sprints:               { key: 'sprints',               label: 'Sprint Planning',     pillar: 'agile' },
  velocity:              { key: 'velocity',              label: 'Velocity',            pillar: 'agile' },
  'feature-scoring':     { key: 'feature-scoring',       label: 'Feature Scoring',     pillar: 'agile' },

  // Security, Governance & Compliance (doc 07 — Phase 2)
  soc2:                  { key: 'soc2',                  label: 'SOC 2 Tracker',       pillar: 'governance' },
  vendors:               { key: 'vendors',               label: 'Vendor Register',     pillar: 'governance' },
  incidents:             { key: 'incidents',             label: 'Security Incidents',  pillar: 'governance' },
  'data-inventory':      { key: 'data-inventory',        label: 'PII & Data Inventory', pillar: 'governance' },
  dpa:                   { key: 'dpa',                   label: 'DPA Management',      pillar: 'governance' },
  training:              { key: 'training',              label: 'Security Training',   pillar: 'governance' },
  'compliance-calendar': { key: 'compliance-calendar',   label: 'Compliance Calendar', pillar: 'governance' },
  'access-reviews':      { key: 'access-reviews',        label: 'Access Reviews',      pillar: 'governance' },
  'vuln-scans':          { key: 'vuln-scans',            label: 'Vulnerability Scans', pillar: 'governance' },
  dsr:                   { key: 'dsr',                   label: 'Data Subject Requests', pillar: 'governance' },
  suppression:           { key: 'suppression',           label: 'Suppression List',    pillar: 'governance' },
} as const satisfies Record<string, EmbedViewMeta>;

export type EmbedView = keyof typeof EMBED_VIEWS;

export const EMBED_VIEW_KEYS = Object.keys(EMBED_VIEWS) as EmbedView[];

export function isEmbedView(value: string): value is EmbedView {
  return Object.prototype.hasOwnProperty.call(EMBED_VIEWS, value);
}

export function embedViewsByPillar(pillar: EmbedPillar): EmbedViewMeta[] {
  return EMBED_VIEW_KEYS.map((k) => EMBED_VIEWS[k]).filter((v) => v.pillar === pillar);
}
