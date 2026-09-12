/**
 * The listing TARGET — what a publish and a stage both establish before either
 * writes a snapshot (kind accepts the source, caller owns the listing, a registry
 * entry exists), the global slug claim, and the `catalog_items` row writer. Split
 * out of `../creationListings.ts`, which re-exports the public names.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  listingKindSpec,
  resolveDelivery,
  resolveTrialPolicy,
  slugify as slugifyBase,
  type ListingDelivery,
  type ListingTrialPolicy,
  type MarketplaceListingKindSpec,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import {
  catalogItems,
  creationSessionObjects,
  creationSessionProjectLinks,
  creationSessions,
  SESSION_PROJECT_LINK_APP,
  users,
} from '../../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../../infrastructure/database/tenantScope';
import { registerObject } from '../../kernel/ObjectRegistry';
import {
  ListingError,
  type CatalogRow,
  type ListingBody,
  type PublishInput,
} from './model';

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const MAX_TAGS = 12;

/** A URL-safe slug. Uniqueness is checked GLOBALLY, not per tenant: the public
 *  detail page is addressed by slug alone, so two tenants owning `space-game`
 *  would be two products at one URL. */
function slugify(input: string): string {
  return slugifyBase(input, { unicode: true, foldDiacritics: true, maxLength: 120, fallback: 'listing' });
}

async function claimSlug(db: Db, base: string, ownListingId: string | null): Promise<string> {
  const candidates = [base, ...Array.from({ length: 6 }, (_, i) => `${base}-${i + 2}`)];
  // Uniqueness is checked across EVERY tenant, which is the whole point: the slug
  // is the public URL, and a per-tenant check would happily hand two products the
  // same address.
  const taken = await db
    .select({ slug: catalogItems.slug, id: catalogItems.id })
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', inArray(catalogItems.slug, candidates)));
  const blocked = new Set(taken.filter((row) => row.id !== ownListingId).map((row) => row.slug));
  const free = candidates.find((slug) => !blocked.has(slug));
  // Six collisions on one name is rare enough that a random suffix is better than
  // a loop that can spin — and it still produces a readable URL.
  return free ?? `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * Publish, or re-publish, one canvas creation.
 *
 * Idempotent per source in the sense that matters: publishing the same object
 * twice UPDATES its listing (new snapshot, bumped version) rather than creating a
 * second row, so a seller who clicks twice does not end up competing with
 * themselves at two URLs.
 */
/**
 * Everything a publish and a STAGE both have to establish before either can write a
 * snapshot: that the kind accepts this source, that the caller owns the listing, and
 * that the listing has a registry entry a snapshot can point at.
 *
 * Extracted when Stage arrived because the two paths agree on every one of those
 * questions and differ only in what they do afterwards — publish points the listing
 * at the new snapshot and makes it public, staging leaves both alone. Two copies of
 * this validation is how a card becomes stageable as a kind the publish endpoint
 * would refuse.
 */
export interface ListingTarget {
  listingId: string;
  /** `objects.id` — the registry row a snapshot's foreign key resolves to. */
  registryObjectId: string;
  spec: MarketplaceListingKindSpec;
  objectKind: string | null;
  existing: CatalogRow | null;
  name: string;
  priceCents: number;
  trial: ListingTrialPolicy;
  /** Resolved once here, so the panel, the harness and the buy button agree. */
  delivery: ListingDelivery;
  /**
   * The project this board IS, when it is one.
   *
   * Read from the `app` link rather than taken from the client: that link is the
   * operator decision "the project IS the app" written down (migration 0473), and it
   * is the only fact that lets a hosted listing be put under the platform's standing
   * deployment watch. Null for every board that has not been converted, which is
   * every `copy` listing and is not an error.
   */
  projectId: number | null;
  sellerName: string | null;
}

export async function resolveListingTarget(
  db: Db,
  env: Env,
  input: PublishInput,
): Promise<ListingTarget> {
  const spec = listingKindSpec(input.kind);
  if (!spec) throw new ListingError(`Unknown listing kind "${input.kind}"`, 400);

  const name = input.name.trim().slice(0, 200);
  if (!name) throw new ListingError('A listing needs a name', 400);

  const [session] = await db
    .select({ id: creationSessions.id, title: creationSessions.title })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, input.sessionId), eq(creationSessions.tenantId, input.tenantId)))
    .limit(1);
  if (!session) throw new ListingError('Session not found', 404);

  // The kind must actually accept this source. Checked here rather than trusted
  // from the client, because `launch` is derived from it and a `game` launch over
  // a `document` payload renders an empty frame with a Play button on it.
  let objectKind: string | null = null;
  if (input.objectId) {
    const [row] = await db
      .select({ kind: creationSessionObjects.kind })
      .from(creationSessionObjects)
      .where(and(
        eq(creationSessionObjects.id, input.objectId),
        eq(creationSessionObjects.sessionId, input.sessionId),
      ))
      .limit(1);
    if (!row) throw new ListingError('Object not found on this board', 404);
    objectKind = row.kind;
    if (!spec.from.includes(row.kind)) {
      throw new ListingError(`A "${row.kind}" cannot be published as a ${spec.id}`, 400);
    }
  } else if (spec.from.length > 0) {
    throw new ListingError(`A ${spec.id} is published from an object, not from a board`, 400);
  }

  const priceCents = Math.max(0, Math.round(Number(input.priceCents ?? 0)) || 0);
  if (priceCents > 0 && spec.pricing === 'free') {
    throw new ListingError(`A ${spec.id} cannot be sold`, 400);
  }
  const trial = resolveTrialPolicy(spec.id, priceCents, input.trial ?? null);
  // The KIND is the authority on what may be offered; the seller picks from that set.
  // Resolved once, here, and carried on the target — the harness selects on it, the
  // body stores it and the buy button reads it, and three derivations of one choice
  // is how a listing offers a subscription to something nobody is running.
  const delivery = resolveDelivery(spec.id, input.delivery ?? null);

  const existing = input.listingId
    ? (await db.select().from(catalogItems)
        .where(and(eq(catalogItems.id, input.listingId), eq(catalogItems.tenantId, input.tenantId)))
        .limit(1))[0] ?? null
    : null;
  if (input.listingId && !existing) throw new ListingError('Listing not found', 404);
  if (existing && existing.publisherRef !== input.userId) {
    throw new ListingError('Only the publisher can update this listing', 403);
  }

  // Only a HOSTED listing has anything to do with a project, so only a hosted publish
  // pays for the lookup — an extra round-trip on every book and every pack to answer
  // a question none of them ask is the kind of cost that never shows up in one trace
  // and always shows up in the bill.
  const [appLink] = delivery === 'hosted'
    ? await db
        .select({ projectId: creationSessionProjectLinks.projectId })
        .from(creationSessionProjectLinks)
        .where(and(
          eq(creationSessionProjectLinks.sessionId, input.sessionId),
          eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
        ))
        .limit(1)
    : [];

  const [seller] = await db
    .select({ displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  // Stamped onto the listing rather than joined at read time: the public card is
  // read far more often than a person renames themselves, and the alternative is a
  // join into the identity domain from a catalogue query — the exact cross-domain
  // reach the holding rule forbids. A rename reaches the card on the next publish.
  const sellerName = seller?.displayName ?? seller?.username ?? null;

  // The listing's registry entry comes FIRST: the snapshot's `objectId` is a real
  // foreign key into it, so there is no window where a snapshot points at nothing.
  const listingId = existing?.id ?? crypto.randomUUID();
  const registered = await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: 'catalog_item',
    refId: listingId,
    domain: 'commerce',
    title: name,
  });

  return {
    listingId,
    registryObjectId: registered.id,
    spec,
    objectKind,
    existing,
    name,
    priceCents,
    trial,
    delivery,
    projectId: appLink?.projectId ?? null,
    sellerName,
  };
}

/**
 * Write the `catalog_items` row for a target.
 *
 * `visibility` is a parameter rather than a constant because that single value is
 * the whole difference between staging and publishing: a staged listing is a real
 * row with a real registry entry and a real snapshot, and it is `private` with no
 * `publishedAt` — which is exactly what every browse surface already filters out.
 * Staging therefore needs no new "is this live" flag for somebody to get wrong.
 */
export async function writeListingRow(
  db: Db,
  input: PublishInput,
  target: ListingTarget,
  body: ListingBody,
  options: { visibility: 'public' | 'private'; version: string },
): Promise<CatalogRow> {
  const { existing, listingId, spec, name, priceCents } = target;
  const slug = existing?.slug ?? await claimSlug(db, slugify(name), listingId);
  const tags = (input.tags ?? []).map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, MAX_TAGS);
  const now = new Date();

  const values = {
    id: listingId,
    tenantId: input.tenantId,
    kind: spec.id,
    slug,
    name,
    summary: input.summary?.trim().slice(0, 2000) ?? null,
    body: body as unknown as Record<string, unknown>,
    category: input.category?.trim().slice(0, 64) ?? null,
    tags: tags as unknown as string[],
    version: options.version,
    visibility: options.visibility,
    priceCents,
    currency: (input.currency ?? 'USD').toUpperCase().slice(0, 8),
    publisherRef: input.userId,
    // Set the first time it actually goes public, and never by a stage. A staged
    // listing carrying a publish date would appear in the feed the moment somebody
    // relaxed the visibility filter.
    publishedAt: existing?.publishedAt ?? (options.visibility === 'public' ? now : null),
    updatedAt: now,
  };

  const [row] = existing
    ? await db.update(catalogItems).set(values)
        .where(scopedToTenant(catalogItems, input.tenantId, eq(catalogItems.id, listingId))).returning()
    : await db.insert(catalogItems).values(values).returning();
  if (!row) throw new ListingError('Could not save the listing', 400);
  return row;
}
