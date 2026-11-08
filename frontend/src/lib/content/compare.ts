/**
 * The comparison's STRUCTURE — which arenas exist, which vendor columns each
 * one has, in what order, and which URL each vendor's leaf page lives at.
 *
 * Every visible string is catalog copy under `compare.*`: the tab label and
 * blurb (`compare.arenas.<key>.{label,blurb}`), the categories and cells, each
 * arena's FAQ, the page's SEO/hero/pillars, and each vendor's leaf narrative
 * (`compare.competitors.<key>`). Vendor names are proper nouns and stay here.
 */

import vendorFactSources from './compareVendorFactSources.json';

export interface CompetitorCol {
  /** Stable column key — the key a comparison row's `values` map is written under. */
  key: string;
  /** Vendor name — a proper noun, shown untranslated. */
  label: string;
}

/**
 * A comparison ARENA — one market Builderforce.ai is measured in, and the rival
 * columns that belong to it.
 *
 * `/compare` used to be a single table of AI coding agents, which described one
 * of the products this platform actually competes with. A tracker buyer, a
 * canvas buyer, a gateway buyer and a marketplace buyer all land on the same
 * URL, and each of them was shown Copilot and Aider. The arena is the second
 * axis: the page renders one tab per arena, each with its own columns and its
 * own capability categories.
 *
 * This registry owns the stable KEY and ORDER only. Adding an arena is a row
 * here plus a catalog block; it is never a new component or a new branch.
 */
export interface CompareArena {
  /** Stable key — resolves `compare.arenas.<key>.{label,blurb,categories,faq}`. */
  key: string;
  /** Rival columns for this arena, in display order. */
  competitors: CompetitorCol[];
}

/** Every arena in tab order. The first is the default tab. */
export const COMPARE_ARENAS: CompareArena[] = [
  {
    key: 'agentic',
    competitors: [
      { key: 'copilot', label: 'GitHub Copilot' },
      { key: 'cursor', label: 'Cursor / Windsurf' },
      { key: 'claudeCode', label: 'Claude Code' },
      { key: 'devin', label: 'Devin' },
      { key: 'openhands', label: 'OpenHands' },
      { key: 'aider', label: 'Aider' },
      { key: 'continueDev', label: 'Continue.dev' },
    ],
  },
  {
    key: 'delivery',
    competitors: [
      { key: 'jira', label: 'Jira' },
      { key: 'linear', label: 'Linear' },
      { key: 'asana', label: 'Asana' },
      { key: 'monday', label: 'Monday.com' },
      { key: 'azureBoards', label: 'Azure Boards' },
    ],
  },
  {
    key: 'canvas',
    competitors: [
      { key: 'figma', label: 'Figma' },
      { key: 'canva', label: 'Canva' },
      { key: 'miro', label: 'Miro' },
      { key: 'notion', label: 'Notion' },
    ],
  },
  {
    key: 'automation',
    competitors: [
      { key: 'zapier', label: 'Zapier' },
      { key: 'n8n', label: 'n8n' },
      { key: 'make', label: 'Make' },
      { key: 'copilotStudio', label: 'Copilot Studio' },
      { key: 'langgraph', label: 'LangGraph / CrewAI' },
    ],
  },
  {
    key: 'gateway',
    competitors: [
      { key: 'openrouter', label: 'OpenRouter' },
      { key: 'litellm', label: 'LiteLLM' },
      { key: 'portkey', label: 'Portkey' },
      { key: 'bedrock', label: 'Amazon Bedrock' },
      { key: 'helicone', label: 'Helicone' },
    ],
  },
  {
    key: 'talent',
    competitors: [
      { key: 'upwork', label: 'Upwork' },
      { key: 'fiverr', label: 'Fiverr' },
      { key: 'toptal', label: 'Toptal' },
      { key: 'agencies', label: 'Dev agencies' },
    ],
  },
];

/** The default arena's key — the tab `/compare` opens on. */
export const DEFAULT_COMPARE_ARENA = COMPARE_ARENAS[0].key;

/**
 * The arena a competitor column belongs to, or `undefined` for an unknown key.
 * `/compare/{slug}` leaf pages use it to render the right arena's categories
 * against that one vendor, so a leaf never has to know which tab it came from.
 */
export function arenaForCompetitor(key: string): CompareArena | undefined {
  return COMPARE_ARENAS.find((arena) => arena.competitors.some((c) => c.key === key));
}

/**
 * The `/compare` pillar ICONS. They pair by index with the localized
 * `compare.pillars` array — the page renders both, `compareSchema()` emits the
 * text — so the two stay the same length and order.
 */
export const COMPARE_PILLAR_ICONS = ['🛡️', '🔀', '🎛️', '✅'] as const;

/* ════════════════════ PROGRAMMATIC SEO — COMPETITOR LEAF PAGES ════════════════════ */

/**
 * A statically-addressed `/compare/{slug}` leaf page, keyed by the competitor
 * column key. The page's narrative (tagline, summary, verdict) is the localized
 * `compare.competitors.<key>` block; this record owns only the URL and the
 * vendor's marketing name, which is a proper noun and may differ from the short
 * matrix label ("Cursor & Windsurf" vs "Cursor / Windsurf").
 */
export interface CompetitorSeo {
  /** URL segment, e.g. 'github-copilot'. */
  slug: string;
  /** Marketing name for the rival — untranslated. */
  name: string;
}

export const COMPETITOR_SEO: Record<string, CompetitorSeo> = {
  copilot: { slug: 'github-copilot', name: 'GitHub Copilot' },
  cursor: { slug: 'cursor', name: 'Cursor & Windsurf' },
  claudeCode: { slug: 'claude-code', name: 'Claude Code' },
  devin: { slug: 'devin', name: 'Devin' },
  openhands: { slug: 'openhands', name: 'OpenHands' },
  aider: { slug: 'aider', name: 'Aider' },
  continueDev: { slug: 'continue-dev', name: 'Continue.dev' },
  jira: { slug: 'jira', name: 'Jira' },
  linear: { slug: 'linear', name: 'Linear' },
  asana: { slug: 'asana', name: 'Asana' },
  monday: { slug: 'monday-com', name: 'Monday.com' },
  azureBoards: { slug: 'azure-boards', name: 'Azure Boards' },
  figma: { slug: 'figma', name: 'Figma' },
  canva: { slug: 'canva', name: 'Canva' },
  miro: { slug: 'miro', name: 'Miro' },
  notion: { slug: 'notion', name: 'Notion' },
  zapier: { slug: 'zapier', name: 'Zapier' },
  n8n: { slug: 'n8n', name: 'n8n' },
  make: { slug: 'make', name: 'Make' },
  copilotStudio: { slug: 'copilot-studio', name: 'Copilot Studio' },
  langgraph: { slug: 'langgraph-crewai', name: 'LangGraph & CrewAI' },
  openrouter: { slug: 'openrouter', name: 'OpenRouter' },
  litellm: { slug: 'litellm', name: 'LiteLLM' },
  portkey: { slug: 'portkey', name: 'Portkey' },
  bedrock: { slug: 'amazon-bedrock', name: 'Amazon Bedrock' },
  helicone: { slug: 'helicone', name: 'Helicone' },
  upwork: { slug: 'upwork', name: 'Upwork' },
  fiverr: { slug: 'fiverr', name: 'Fiverr' },
  toptal: { slug: 'toptal', name: 'Toptal' },
  agencies: { slug: 'dev-agencies', name: 'Dev agencies' },
};

/**
 * Every vendor column in COMPARE_ARENAS has a leaf page. A column added without
 * a COMPETITOR_SEO row (or a row with no column, or a duplicate slug) is
 * reported here; `messages.test.ts` asserts the list is empty, so the registry
 * and the matrix cannot drift apart. (Not thrown at module load: edge routes
 * import this module.)
 */
export function compareLeafGaps(): string[] {
  const columns = COMPARE_ARENAS.flatMap((arena) => arena.competitors.map((c) => c.key));
  const slugs = Object.values(COMPETITOR_SEO).map((v) => v.slug);
  return [
    ...columns.filter((key) => !COMPETITOR_SEO[key]).map((key) => `column without leaf: ${key}`),
    ...Object.keys(COMPETITOR_SEO).filter((key) => !columns.includes(key)).map((key) => `leaf without column: ${key}`),
    ...slugs.filter((slug, i) => slugs.indexOf(slug) !== i).map((slug) => `duplicate slug: ${slug}`),
  ];
}

/* ════════════════════ VENDOR-FACT SOURCES ════════════════════ */

/**
 * A sourced record for ONE catalog key under `compare.` whose copy states a
 * vendor-specific fact (a price, percentage, user count or version number).
 * Comparison copy is criteria-first; a vendor fact is the exception and needs a
 * primary source, the date it was observed, who reviewed it, and a review
 * deadline no more than 30 days after the observation.
 *
 * `scripts/check-compare-vendor-facts.mjs` fails any such sentence without a
 * record here, and fails a record whose `reviewBy` has passed. The list is empty
 * on purpose: today's comparison copy states no vendor fact.
 */
export interface CompareVendorFactSource {
  /** Catalog key, e.g. `compare.competitors.devin.summary`. Applies to every locale. */
  key: string;
  /** Primary source URL (the vendor's own pricing/docs page). */
  source: string;
  /** ISO date (YYYY-MM-DD) the fact was observed at `source`. */
  observed: string;
  reviewer: string;
  /** ISO date; must be at most 30 days after `observed`. */
  reviewBy: string;
}

/**
 * The records live in `compareVendorFactSources.json` so the CI guard reads
 * them as data. Expiry deliberately fails CI on the `reviewBy` date (consistent
 * with MARKETING_CLAIMS): a stale vendor fact must be re-observed or rewritten.
 */
export const COMPARE_VENDOR_FACT_SOURCES: readonly CompareVendorFactSource[] = vendorFactSources;

/** Slug -> competitor column key, for `/compare/{slug}` route resolution. */
export const COMPETITOR_SLUG_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(COMPETITOR_SEO).map(([key, v]) => [v.slug, key]),
);
