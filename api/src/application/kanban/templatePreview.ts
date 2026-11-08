/**
 * TEMPLATE PREVIEW — what a member may see of a priced template they hold no licence for:
 * identity, description, price and lane NAMES. Never requirements, staffing or gates
 * (that is the product being sold).
 */
import type { KanbanTemplate } from './types';
import type { TemplateListingRef } from './templateEntitlement';

export interface TemplatePreview {
  preview: true;
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  priceCents: number;
  currency: string;
  listingSlug: string;
  lanes: Array<{ key: string; name: string; position: number }>;
}

export function previewOf(t: KanbanTemplate, listing: TemplateListingRef): TemplatePreview {
  return {
    preview: true,
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    category: t.category,
    priceCents: listing.priceCents,
    currency: listing.currency,
    listingSlug: listing.slug,
    lanes: t.lanes.map((l) => ({ key: l.key, name: l.name, position: l.position })),
  };
}
