/**
 * A package's PRICE LIST — the one place a published extension's plans live.
 *
 * ── NO SECOND COMMERCE STORE (PRD 24 §5.2) ──────────────────────────────────
 * `extension_packages.catalog_item_id` points at a `catalog_items` row, and that
 * row IS the listing's commercial identity: its `priceCents` is what the
 * directory shows as "from", its `body.plans` is the price list, and its id is
 * what `order_line_items.catalog_item_id` names when somebody buys. There is no
 * `extension_plans` table, no price column on `extension_packages`, and no second
 * order table — the PRD is explicit about all three, and the reason is the one
 * this codebase keeps giving: a price stored twice is a price that disagrees with
 * itself the first time one copy is edited.
 *
 * ── THE GATE ON CHARGING ────────────────────────────────────────────────────
 * PRD 24 §9 decision 2 asks whether identity verification should gate charging.
 * The answer shipped here is yes, and it is enforced TWICE on purpose — once at
 * the moment a price is set (below) and once at review (`packageReview.ts`) —
 * through ONE predicate, `mayCharge`. Two gates asking the same question through
 * two implementations is how one of them ends up saying yes; two gates calling one
 * function cannot disagree. The honest moment to refuse is before a price is
 * advertised, not after a customer tries to pay it, which is why the first gate
 * exists at all.
 *
 * ── WHAT DECIDES THE REV-SHARE ──────────────────────────────────────────────
 * Nothing here. The rate a publisher pays is `resolveTakeRateBps` in
 * `marketplace/listingCommerce.ts` — the same resolver, the same lifetime
 * threshold and the same env vars every other seller on this platform is measured
 * against. PRD 24 §9 decision 1 asks for a threshold; the platform already had
 * one ($200,000 lifetime, `MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS`), and answering
 * the question with a second extension-specific number would have been a second
 * fee schedule for a reader to reconcile.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, extensionPackages } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { workspaceAccount } from '../kernel/ledgerAccount';
import { PublisherError, requirePublisher } from './publishers';
import { invalidatePublicCatalog, loadPackage, type PackageRow } from './extensionRepository';
import {
  mayCharge,
  parseExtensionPlans,
  type ExtensionPlan,
} from './extensionContract';

/** The kernel catalogue `kind` a package listing is filed under. */
const LISTING_KIND = 'offering';

/**
 * What a package's catalogue row carries beyond the columns.
 *
 * `packageId` is the back-reference. It exists because the catalogue row is
 * reachable from a checkout session's metadata (a slug) while the package is not,
 * and resolving one from the other by string surgery on the slug would be a join
 * expressed as a naming convention.
 */
interface ListingBody {
  packageId: string;
  packageSlug: string;
  plans: unknown;
}

export interface PackagePricing {
  /** NULL when the package is free — there is no catalogue row and no plans. */
  catalogItemId: string | null;
  currency: string;
  plans: ExtensionPlan[];
  /** The cheapest recurring price, for the directory's "from $X". NULL when every
   *  plan is pure usage-based, which genuinely has no entry price to quote. */
  fromCents: number | null;
}

const EMPTY_PRICING: PackagePricing = { catalogItemId: null, currency: 'USD', plans: [], fromCents: null };

/** The catalogue slug for a package. Derived, never stored twice. */
export const listingSlugFor = (packageSlug: string): string => `ext-${packageSlug}`;

/**
 * The lowest recurring price on offer.
 *
 * Only plans that actually recur are considered: a $0/month plan that meters at
 * 2¢ a call is not a "from $0" listing in any sense a buyer would accept, and
 * quoting it as one is the single most common way a marketplace listing lies.
 */
export function fromCentsOf(plans: readonly ExtensionPlan[]): number | null {
  const recurring = plans.filter((p) => p.priceCents > 0).map((p) => p.priceCents);
  return recurring.length ? Math.min(...recurring) : null;
}

/** One plan by code, or null. The one place a code is resolved. */
export function findPlan(plans: readonly ExtensionPlan[], code: string | null | undefined): ExtensionPlan | null {
  if (!code) return null;
  return plans.find((p) => p.code === code) ?? null;
}

/**
 * Read a package's pricing.
 *
 * Cross-tenant by construction: a listing is priced by its PUBLISHER and read by
 * every workspace considering it, which is what `public_catalogue` means. The
 * plan list is re-parsed on every read for the same reason a spec is — a stored
 * plan can outlive a contract change, and a plan that half-parses is a price
 * somebody is charged out of a field nobody validated.
 */
export async function packagePricing(db: Db, pkg: PackageRow): Promise<PackagePricing> {
  if (!pkg.catalogItemId) return EMPTY_PRICING;
  const [row] = await db
    .select()
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.id, pkg.catalogItemId)))
    .limit(1);
  if (!row) return EMPTY_PRICING;
  const plans = parseExtensionPlans((row.body as ListingBody | null)?.plans);
  return {
    catalogItemId: row.id,
    currency: row.currency ?? 'USD',
    plans,
    fromCents: fromCentsOf(plans),
  };
}

/** The same read, addressed by package id. For callers holding only an id. */
export async function pricingForPackage(db: Db, packageId: string): Promise<PackagePricing> {
  return packagePricing(db, await loadPackage(db, packageId));
}

/**
 * Set (or clear) a package's price list.
 *
 * ── WHY THIS IS ONE CALL AND NOT `addPlan` / `removePlan` ───────────────────
 * A price list is edited as a whole. Per-plan mutations would need their own
 * ordering, their own conflict story and their own answer to "what happens to the
 * installs on the plan you just deleted" — three problems that do not exist when
 * the caller submits the list it wants and this function reconciles once.
 *
 * An empty list CLEARS the pricing and makes the package free again. The
 * catalogue row is kept rather than deleted: `order_line_items.catalog_item_id`
 * points at it, and deleting the row a past order names would turn every one of
 * those orders into a line describing nothing. Its visibility drops to `private`
 * instead, which is what "no longer on sale" means to every other reader of that
 * table.
 *
 * Installs already on a removed plan are NOT touched here, deliberately. Their
 * `plan_code` keeps naming what they agreed to pay, and `extensionBilling` prices
 * a period from the plan it can still find — see the refusal there. Rewriting a
 * customer's plan because the vendor edited their price list is the one thing a
 * marketplace must never do silently.
 */
export async function setPackagePlans(
  db: Db,
  env: Env,
  input: {
    packageId: string;
    actorUserId: string;
    /** Untrusted. Parsed and clamped by `parseExtensionPlans`, never stored raw. */
    plans: unknown;
    currency?: string;
  },
): Promise<PackagePricing> {
  const pkg = await loadPackage(db, input.packageId);
  // `manager`, matching listing and delisting rather than shipping a version: a
  // price is a commercial commitment, and the ladder that governs "may this
  // person put the listing on sale" must govern "at what price".
  const { tenant } = await requirePublisher(db, pkg.tenantId, input.actorUserId, 'manager');

  const plans = parseExtensionPlans(input.plans);

  // The gate, at the honest moment. `mayCharge` is the SAME predicate the review
  // pipeline's `paid_requires_identity` check calls — see the module header.
  if (plans.length > 0 && !mayCharge(tenant.publisherState)) {
    throw new PublisherError(
      'a paid listing requires an identity-verified publisher — verify your identity before setting a price',
      403,
    );
  }

  const currency = (input.currency ?? 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
  const body: ListingBody = { packageId: pkg.id, packageSlug: pkg.slug, plans };
  const fromCents = fromCentsOf(plans);

  const values = {
    tenantId: pkg.tenantId,
    kind: LISTING_KIND,
    slug: listingSlugFor(pkg.slug),
    name: pkg.name,
    summary: pkg.tagline || null,
    body: body as unknown as Record<string, unknown>,
    category: pkg.categories?.[0] ?? null,
    currency,
    priceCents: fromCents,
    // The LEDGER ACCOUNT the earnings land in, not a person: an extension names
    // no author (`extension_packages` has no author column, exactly as
    // `ide_agents` has none), so the seller is the publishing workspace. Stored
    // here because `resolveTakeRateBps` reads this ref to decide the rate, and
    // the account it measures MUST be the account the credit lands in.
    publisherRef: workspaceAccount(pkg.tenantId).ref,
    // A price list with nothing on it is not on sale. Never deleted — see above.
    visibility: plans.length > 0 ? 'public' : 'private',
    publishedAt: plans.length > 0 ? new Date() : null,
    updatedAt: new Date(),
  };

  const [row] = pkg.catalogItemId
    ? await db
      .update(catalogItems)
      .set(values)
      .where(scopedToTenant(catalogItems, pkg.tenantId, eq(catalogItems.id, pkg.catalogItemId)))
      .returning()
    : await db
      .insert(catalogItems)
      .values(values)
      .onConflictDoUpdate({
        // The catalogue's own natural key. A publisher who cleared their pricing
        // and set it again must land on the row their past orders name, not on a
        // second row with the same slug that the unique index would refuse.
        target: [catalogItems.tenantId, catalogItems.kind, catalogItems.slug],
        set: values,
      })
      .returning();
  if (!row) throw new PublisherError('could not record the price list', 409);

  if (pkg.catalogItemId !== row.id) {
    await db
      .update(extensionPackages)
      .set({ catalogItemId: row.id, updatedAt: new Date() })
      .where(scopedToTenant(extensionPackages, pkg.tenantId, eq(extensionPackages.id, pkg.id)));
  }

  await invalidatePublicCatalog(env);
  return { catalogItemId: row.id, currency, plans, fromCents };
}
