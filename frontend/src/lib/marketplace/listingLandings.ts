/**
 * Listing landings (PRD 33 §4.2 step 1) — DATA, keyed by listing slug.
 *
 * A marketplace listing page renders its landing ABOVE the launch surface when
 * its slug has an entry here, through ONE lookup (`landingFor`) and ONE section
 * registry (`LANDING_SECTION_COMPONENTS`). A new landing is a new entry, never a
 * branch in the page. Copy lives in the catalogs under each section's `ns`; the
 * keys listed here are the item ids beneath it.
 */

export const LANDING_SECTION_KINDS = ['hero', 'install', 'pillars', 'compare', 'pricing', 'faq', 'proof'] as const;
export type LandingSectionKind = (typeof LANDING_SECTION_KINDS)[number];

/** Where the landing's "Start free" goes, and the intent it carries through sign-up. */
export interface LandingStart {
  path: string;
  intent: string;
}

interface LandingSectionBase {
  /** i18n namespace for this section's copy (`<ns>.<kind>.*`). */
  ns: string;
}

export type LandingSection = LandingSectionBase & (
  | { kind: 'hero'; start: LandingStart }
  | { kind: 'install'; steps: readonly string[] }
  | { kind: 'pillars'; items: readonly string[] }
  | { kind: 'compare'; columns: readonly string[]; rows: readonly string[] }
  | { kind: 'pricing'; freeRecordings: number; start: LandingStart }
  | { kind: 'faq'; items: readonly string[] }
  | { kind: 'proof'; start: LandingStart }
);

const INSIGHTS_NS = 'marketplace.landing.insights';
const INSIGHTS_START: LandingStart = { path: '/apps/insights/setup', intent: 'install:insights' };

export const LISTING_LANDINGS: Readonly<Record<string, ReadonlyArray<LandingSection>>> = {
  'session-replay': [
    { kind: 'hero', ns: INSIGHTS_NS, start: INSIGHTS_START },
    { kind: 'install', ns: INSIGHTS_NS, steps: ['paste', 'verify', 'improve'] },
    { kind: 'pillars', ns: INSIGHTS_NS, items: ['fixes', 'recordings', 'heatmaps', 'funnels', 'live', 'privacy'] },
    {
      kind: 'compare',
      ns: INSIGHTS_NS,
      columns: ['insights', 'typical'],
      rows: ['recordings', 'heatmaps', 'frustration', 'fixes', 'releases', 'measured'],
    },
    // D4: 5,000 kept recordings a month free per installed workspace.
    { kind: 'pricing', ns: INSIGHTS_NS, freeRecordings: 5_000, start: INSIGHTS_START },
    { kind: 'faq', ns: INSIGHTS_NS, items: ['what', 'install', 'privacy', 'pricing', 'builderforce'] },
    { kind: 'proof', ns: INSIGHTS_NS, start: INSIGHTS_START },
  ],
};

/** The landing for a listing, or null — the page's ONE lookup. */
export function landingFor(slug: string): ReadonlyArray<LandingSection> | null {
  return Object.prototype.hasOwnProperty.call(LISTING_LANDINGS, slug) ? LISTING_LANDINGS[slug] ?? null : null;
}

/**
 * `SoftwareApplication` structured data with a free offer, for a listing that has
 * a landing (it is a web app a visitor can start for nothing).
 */
export function listingLandingJsonLd(listing: { name: string; summary: string | null; slug: string }, baseUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: listing.name,
    ...(listing.summary ? { description: listing.summary } : {}),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${baseUrl.replace(/\/+$/, '')}/marketplace/listing/${listing.slug}`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}
