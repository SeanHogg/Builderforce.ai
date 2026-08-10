/**
 * What `/integrations` is allowed to claim, read from the API's projection of
 * the connector / board / data / drive / mailbox ports.
 *
 * The page used to render `SEO_INTEGRATIONS` — a hand-maintained array in this
 * repo — so shipping a provider changed the product and not the page, and
 * `/product` (which rendered a SECOND hand-maintained array) could disagree with
 * it about the same question. The registry lives where the adapters live now;
 * this file is the reader.
 *
 * `SEO_INTEGRATIONS` survives, with its scope corrected: it is the EDITORIAL
 * layer — the curated leaf pages at `/integrations/<slug>` with a written
 * tagline, summary and use-cases. Copy a person wrote is not derivable from a
 * manifest and should not be. It supplies the link and the sentence; the
 * registry supplies the list.
 */

import { SEO_INTEGRATIONS } from './content';
import { publicApiGet } from './publicApi';

export type IntegrationCategory =
  | 'work' | 'devtools' | 'incident' | 'communication' | 'crm'
  | 'productivity' | 'finance' | 'marketing' | 'support' | 'storage' | 'data' | 'other';

export type IntegrationSurface = 'connector' | 'board' | 'data' | 'drive' | 'mailbox';

export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  category: IntegrationCategory;
  surfaces: IntegrationSurface[];
  direction: 'import' | 'export' | 'two-way' | 'event-ingest';
  capabilities: ('webhook' | 'discovery' | 'oauth')[];
}

export interface IntegrationCatalogGroup {
  category: IntegrationCategory;
  entries: IntegrationCatalogEntry[];
}

/**
 * The editorial leaf page for a registry entry, matched by NAME rather than id.
 *
 * Port ids are adapter keys (`google-sheets`, `drive-google`, `freshservice`)
 * while a leaf page's slug is a marketing URL that predates them. Names are what
 * both sides actually agree on, and a fold-cased comparison is enough because
 * these are proper nouns, not free text.
 */
const SEO_BY_NAME = new Map(SEO_INTEGRATIONS.map((entry) => [entry.name.toLowerCase(), entry]));

export function leafPageFor(entry: IntegrationCatalogEntry): { href: string; tagline: string } | null {
  const seo = SEO_BY_NAME.get(entry.name.toLowerCase());
  return seo ? { href: `/integrations/${seo.slug}`, tagline: seo.tagline } : null;
}

/**
 * The catalog, grouped in the API's own category order.
 *
 * Degrades to the editorial list when the API is unreachable: a marketing page
 * that 500s because a catalog endpoint blipped is strictly worse than one that
 * shows the curated subset. The fallback is visibly smaller, never wrong.
 */
export async function getIntegrationCatalog(): Promise<IntegrationCatalogGroup[]> {
  const body = await publicApiGet<{ groups?: IntegrationCatalogGroup[] }>('/api/integrations/catalog');
  const groups = body?.groups?.filter((group) => group.entries?.length > 0);
  if (groups?.length) return groups;
  return fallbackGroups();
}

/**
 * The editorial list, shaped as registry groups. Its `category` strings are free
 * text written for humans, so they cannot be mapped onto the registry's twelve
 * keys without guessing — everything lands in `other`, which renders under one
 * honest heading rather than under a category the page invented.
 */
function fallbackGroups(): IntegrationCatalogGroup[] {
  return [{
    category: 'other',
    entries: SEO_INTEGRATIONS.map((entry) => ({
      id: entry.slug,
      name: entry.name,
      category: 'other' as const,
      surfaces: ['connector' as const],
      direction: 'two-way' as const,
      capabilities: [],
    })),
  }];
}
