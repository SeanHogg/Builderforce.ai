/**
 * KANBAN TEMPLATE ENTITLEMENT — a priced template is a marketplace listing.
 *
 * A published kanban template is a `catalog_items` row (kind 'kanban_template', public,
 * with a slug and a price) — exactly what `listingCommerce` sells. Its checkout
 * (`startListingCheckout`) and settlement (`completeListingCheckout`) already work on
 * any public catalogue row, and grant a `template_licenses` row. This module is the READ
 * side: before a tenant installs or applies someone else's priced template it must hold
 * that licence. There is no parallel purchase table.
 *
 * Unchanged: built-ins, free templates, a tenant's own templates (incl. its own
 * published priced one) and private copies made by `install`.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { heldLicence } from '../marketplace/listingCommerce';
import { getPublicTemplate } from '../templates/catalogTemplateStore';
import { TEMPLATE_KINDS } from '../templates/templateKinds';
import { isBuiltinTemplateId } from './templateCatalog';

/** The listing a buyer must check out to unlock the template. */
export interface TemplateListingRef {
  listingId: string;
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
}

/** A priced template the tenant holds no licence for. The route answers 402. */
export class TemplateLicenceRequiredError extends Error {
  constructor(readonly listing: TemplateListingRef) {
    super('Purchase required');
    this.name = 'TemplateLicenceRequiredError';
  }
}

/**
 * The 402 body: the marketplace-agent "purchase required" envelope
 * (`checkoutRequired` + `priceCents`, which the client already maps to
 * `PurchaseRequiredError`) plus the listing to check out. `checkoutPath` is the existing
 * listing-checkout door (`POST /api/creation-listings/:slug/checkout`) — nothing new.
 */
export function licenceRequiredBody(e: TemplateLicenceRequiredError) {
  return {
    error: e.message,
    code: 'template_licence_required',
    checkoutRequired: true as const,
    priceCents: e.listing.priceCents,
    currency: e.listing.currency,
    listingId: e.listing.listingId,
    listingSlug: e.listing.slug,
    listingName: e.listing.name,
    checkoutPath: `/api/creation-listings/${encodeURIComponent(e.listing.slug)}/checkout`,
  };
}

/**
 * Throws {@link TemplateLicenceRequiredError} unless the template is free, the tenant's
 * own, or already licensed to `buyerRef`. `buyerRef` is the acting user's id; a null
 * actor (a system path) never holds a licence, so it cannot use a priced foreign template.
 */
export async function assertTemplateEntitled(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; buyerRef: string | null; templateId: string },
): Promise<void> {
  const locked = await lockedTemplateListing(db, env, args);
  if (locked) throw new TemplateLicenceRequiredError(locked);
}

/**
 * The listing that gates this template for the caller, or null when it is usable
 * (built-in, free, own, or licensed). The ONE entitlement question: `assertTemplateEntitled`
 * throws on it and the read path serves a preview on it.
 */
export async function lockedTemplateListing(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; buyerRef: string | null; templateId: string },
): Promise<TemplateListingRef | null> {
  if (isBuiltinTemplateId(args.templateId)) return null;
  // Only a PUBLIC row can be somebody else's priced listing; a private one is the
  // tenant's own (or not visible at all, which `get` reports as not found).
  const row = await getPublicTemplate(db, env, { kind: TEMPLATE_KINDS.kanban, id: args.templateId });
  if (!row || row.tenantId === args.tenantId) return null;
  const priceCents = row.priceCents ?? 0;
  if (priceCents <= 0) return null;
  if (args.buyerRef && (await heldLicence(db, args.tenantId, args.buyerRef, row.id))) return null;
  return {
    listingId: row.id,
    slug: row.slug,
    name: row.name,
    priceCents,
    currency: row.currency ?? 'usd',
  };
}
