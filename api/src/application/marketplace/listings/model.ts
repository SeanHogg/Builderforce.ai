/**
 * The listing model — the shapes every listing module agrees on (the view, the
 * stored body, the publish input, the snapshot payload), the one error type, and
 * the row → view projection. Split out of `../creationListings.ts`, which
 * re-exports the public names.
 */
import {
  listingKindSpec,
  resolveDelivery,
  type ListingDelivery,
  type ListingLaunchMode,
  type ListingTrialPolicy,
  type StageCheck,
} from '@builderforce/creation-canvas-contract';
import type { catalogItems } from '../../../infrastructure/database/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the publish panel needs to know about ONE candidate before it offers it. */
export interface PublishCandidate {
  objectId: string | null;
  objectKind: string | null;
  title: string;
  /** Listing kinds this candidate may be published as, most specific first. */
  kinds: readonly string[];
  /** An existing listing for this exact source, if it has been published before. */
  existingListingId: string | null;
}

export interface CreationListingView {
  id: string;
  slug: string;
  kind: string;
  name: string;
  summary: string | null;
  category: string | null;
  tags: readonly string[];
  version: string;
  visibility: string;
  priceCents: number;
  currency: string;
  trial: ListingTrialPolicy;
  launch: ListingLaunchMode;
  /** What the buyer receives: the thing (`copy`), or access to it (`hosted`). */
  delivery: ListingDelivery;
  icon: string;
  installCount: number;
  rating: number | null;
  publishedAtISO: string | null;
  updatedAtISO: string;
  sellerRef: string | null;
  sellerName: string | null;
  /**
   * Limits Stage found and the seller shipped with — on the PUBLIC projection too.
   *
   * The inherited rule, made structural: a limitation a seller learns in Stage is
   * DECLARED on the listing rather than discovered by the buyer. Present on the
   * public card and the public detail read, because a disclosure only the seller can
   * see is not a disclosure.
   */
  declared: readonly StageCheck[];
  /** Source coordinates — seller-only. Absent on every public projection. */
  source?: { sessionId: string; objectId: string | null; objectKind: string | null };
}

/** The body stored on `catalog_items.body`. One shape, so nothing reads a `kind`
 *  and guesses at what else is present. */
export interface ListingBody {
  source: { sessionId: string; objectId: string | null; objectKind: string | null };
  snapshotId: string;
  launch: ListingLaunchMode;
  trial: ListingTrialPolicy;
  /**
   * What the buyer receives.
   *
   * STORED rather than re-derived from the kind on every read, because the kind
   * declares what a listing MAY offer and the seller chooses from that set — an `app`
   * can be sold either way, and a listing that re-derived its own delivery would
   * silently become whichever one happens to be first in the registry. It is also the
   * fact the deployment harness selects on, and the fact the hosted-lifecycle sweep
   * finds its work by.
   */
  delivery: ListingDelivery;
  seller: { userId: string; name: string | null };
  /**
   * The warnings the staged build carried when it went on sale.
   *
   * Written at publish, from the checks run over the PROMOTED snapshot — so it
   * describes the build a buyer receives rather than whatever the seller's board says
   * today. Absent on rows published before this existed, which read as "nothing
   * declared" rather than as an error.
   */
  declared?: StageCheck[];
}

export interface PublishInput {
  tenantId: number;
  userId: string;
  sessionId: string;
  /** Null publishes the whole board as a pack. */
  objectId: string | null;
  kind: string;
  name: string;
  summary?: string | null;
  category?: string | null;
  tags?: readonly string[];
  priceCents?: number;
  currency?: string;
  trial?: string | null;
  /**
   * Which door this listing opens. Validated against the kind's `deliveries`, so a
   * client cannot sell a book as a subscription no matter what it posts.
   */
  delivery?: string | null;
  /** Omitted on create; supplied to re-publish an existing listing in place. */
  listingId?: string | null;
  /**
   * A STAGED snapshot to promote instead of re-reading the board.
   *
   * This is what makes "what was tested is what ships" true. Absent, publish reads
   * the live board — correct for a seller who never staged, and a silent
   * substitution for one who did.
   */
  fromSnapshotId?: string | null;
}

export class ListingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = 'ListingError';
  }
}

/** The immutable payload a listing serves forever after. */
export interface ListingSnapshotPayload {
  kind: 'object' | 'session';
  title: string;
  /** For an object listing: the one card. For a pack: every card on the board. */
  objects: Array<{ id: string; kind: string; canvasData: unknown; content: unknown }>;
  connections: Array<{ sourceObjectId: string; targetObjectId: string; kind: string | null }>;
  /**
   * Field names `stripBindings` removed on the way in.
   *
   * Stored ON the snapshot rather than recomputed, because it is a fact about THIS
   * capture: the seller's board changes, and a list re-derived at read time would
   * describe a strip that never happened to the copy a buyer holds. Optional because
   * snapshots written before this seam existed do not carry it.
   */
  strippedFields?: string[];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CatalogRow = typeof catalogItems.$inferSelect;

export function toView(row: CatalogRow, body: ListingBody | null, includeSource = true): CreationListingView {
  const spec = listingKindSpec(row.kind);
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    category: row.category,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    version: row.version,
    visibility: row.visibility,
    priceCents: row.priceCents ?? 0,
    currency: row.currency ?? 'USD',
    trial: body?.trial ?? 'preview',
    launch: body?.launch ?? spec?.launch ?? 'preview',
    // A row published before `delivery` was stored falls back to what its kind
    // declares first, which is the value `resolveDelivery` would have chosen for it.
    delivery: resolveDelivery(row.kind, body?.delivery ?? null),
    declared: body?.declared ?? [],
    icon: spec?.icon ?? '📦',
    installCount: row.installCount,
    rating: row.rating == null ? null : Number(row.rating),
    publishedAtISO: row.publishedAt?.toISOString() ?? null,
    updatedAtISO: row.updatedAt.toISOString(),
    sellerRef: row.publisherRef,
    sellerName: body?.seller?.name ?? null,
    ...(includeSource && body?.source ? { source: body.source } : {}),
  };
}
