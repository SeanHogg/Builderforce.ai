/**
 * Packages and versions — the publisher's half of the marketplace.
 *
 * One artifact, one review, one publish. `kind` decides what the spec MEANS and
 * nothing else branches on it outside `packageReview.ts`, which is the property
 * that makes adding `canvas_kind` a validator rather than a subsystem.
 *
 * ── WHY A VERSION IS IMMUTABLE ──────────────────────────────────────────────
 * A tenant's install points at a specific `version_id` and stores the scopes its
 * admin approved. If a publisher could edit a published version in place, that
 * grant would silently start covering code nobody consented to — which is the
 * supply-chain failure the whole review pipeline exists to prevent. So an edit is
 * a NEW version, reviewed again, and installs move to it explicitly.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, extensionPackages, extensionVersions, extensionReviewStages, tenants } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { PublisherError, requirePublisher } from './publishers';
import {
  CATALOG_CACHE_KEY,
  invalidatePublicCatalog,
  loadPackage,
  loadVersion,
  type PackageRow,
  type VersionRow,
} from './extensionRepository';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { runReviewPipeline, type PipelineOutcome } from './reviewPipeline';
import { installReviewStages } from './reviewStages';
import { buildSearchText } from './catalogSearch';
import {
  isExtensionKind,
  SUBMITTABLE_KINDS,
  type ExtensionKind,
  type ListingState,
} from './extensionContract';
import { reviewVersion, type ReviewFinding } from './packageReview';

export interface PackageView {
  id: string;
  /** The PUBLISHER's workspace. There is no separate publisher id — see `publishers.ts`. */
  tenantId: number;
  publisher: { slug: string; name: string; state: string } | null;
  slug: string;
  kind: ExtensionKind | string;
  name: string;
  tagline: string;
  description: string | null;
  categories: string[];
  iconUrl: string | null;
  docsUrl: string | null;
  listingState: ListingState | string;
  currentVersionId: string | null;
  catalogItemId: string | null;
  /**
   * Whether this listing is on sale, and from what.
   *
   * NOT derivable from `catalogItemId`: clearing a price list leaves the
   * catalogue row in place (past orders name it) and drops its visibility, so a
   * package can carry an id and be free. A page that read the id as "paid" would
   * put a price badge on a free extension the first time a publisher took one
   * off sale.
   */
  pricing: { paid: boolean; fromCents: number | null; currency: string };
  installCount: number;
  updatedAt: string | null;
}

/** What a package with no price list is. One value, so the shape is total. */
const FREE: PackageView['pricing'] = { paid: false, fromCents: null, currency: 'USD' };

export interface VersionView {
  id: string;
  packageId: string;
  semver: string;
  spec: Record<string, unknown>;
  requestedScopes: string[];
  changelog: string | null;
  reviewState: string;
  reviewFindings: ReviewFinding[];
  publishedAt: string | null;
  createdAt: string | null;
}

type PublisherRow = typeof tenants.$inferSelect;

function toPackageView(
  row: PackageRow,
  publisher?: PublisherRow | null,
  pricing: PackageView['pricing'] = FREE,
): PackageView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    publisher: publisher
      ? { slug: publisher.slug, name: publisher.name, state: publisher.publisherState }
      : null,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    categories: row.categories ?? [],
    iconUrl: row.iconUrl,
    docsUrl: row.docsUrl,
    listingState: row.listingState,
    currentVersionId: row.currentVersionId,
    catalogItemId: row.catalogItemId,
    pricing,
    installCount: row.installCount,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export function toVersionView(row: VersionRow): VersionView {
  return {
    id: row.id,
    packageId: row.packageId,
    semver: row.semver,
    spec: row.spec ?? {},
    requestedScopes: row.requestedScopes ?? [],
    changelog: row.changelog,
    reviewState: row.reviewState,
    reviewFindings: (row.reviewFindings ?? []) as unknown as ReviewFinding[],
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}

/**
 * `Acme Payroll, Inc.` → `acme-payroll-inc`.
 *
 * Lives beside its only caller. It used to sit in the publisher module, where it
 * also named publisher orgs — but a publisher is a workspace now and inherits the
 * workspace's slug, so a package slug is the last thing that needs deriving.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Publisher-side
// ─────────────────────────────────────────────────────────────────────────────

export async function createPackage(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    actorUserId: string;
    kind: string;
    name: string;
    slug?: string;
    tagline?: string;
    description?: string | null;
    categories?: string[];
    docsUrl?: string | null;
  },
): Promise<PackageView> {
  const { tenant } = await requirePublisher(db, input.tenantId, input.actorUserId, 'developer');

  if (!isExtensionKind(input.kind) || !SUBMITTABLE_KINDS.includes(input.kind)) {
    throw new PublisherError(`kind must be one of: ${SUBMITTABLE_KINDS.join(', ')}`);
  }
  const name = input.name.trim();
  if (name.length < 2) throw new PublisherError('name is required');

  // Slug uniqueness is PLATFORM-WIDE, so this read deliberately does not filter by
  // the publisher's tenant: two workspaces must not both own `stripe`, because the
  // slug is what an install names and what a URL addresses.
  const slug = slugify(input.slug?.trim() || name);
  const [taken] = await db
    .select({ id: extensionPackages.id })
    .from(extensionPackages)
    .where(acrossTenants(extensionPackages, 'public_catalogue', eq(extensionPackages.slug, slug)))
    .limit(1);
  if (taken) throw new PublisherError(`the slug "${slug}" is taken`, 409);

  const tagline = (input.tagline ?? '').trim().slice(0, 240);
  const description = input.description?.trim() || null;
  const categories = input.categories ?? [];

  const [row] = await db
    .insert(extensionPackages)
    .values({
      tenantId: input.tenantId,
      slug,
      kind: input.kind,
      name,
      tagline,
      description,
      categories,
      docsUrl: input.docsUrl?.trim() || null,
      // The directory's search projection. Written here as well as on publish
      // because a draft is findable to nobody but its owner and a package with a
      // NULL projection would stay unfindable through its first publish if that
      // publish ever failed to reach the update below. Capability names arrive
      // with the head version; the metadata is knowable now.
      searchText: buildSearchText({ name, tagline, description, categories, kind: input.kind, spec: null }),
    })
    .returning();
  if (!row) throw new PublisherError('failed to create package', 409);

  return toPackageView(row, tenant);
}

/** Every package a publisher owns, drafts included. */
export async function listPackagesForPublisher(db: Db, tenantId: number, actorUserId: string): Promise<PackageView[]> {
  const { tenant } = await requirePublisher(db, tenantId, actorUserId, 'developer');
  const rows = await db
    .select()
    .from(extensionPackages)
    .where(scopedToTenant(extensionPackages, tenantId))
    .orderBy(desc(extensionPackages.updatedAt));
  return rows.map((r) => toPackageView(r, tenant));
}

export async function listVersions(db: Db, packageId: string, actorUserId: string): Promise<VersionView[]> {
  const pkg = await loadPackage(db, packageId);
  await requirePublisher(db, pkg.tenantId, actorUserId, 'developer');
  const rows = await db
    .select()
    .from(extensionVersions)
    .where(eq(extensionVersions.packageId, packageId))
    .orderBy(desc(extensionVersions.createdAt));
  return rows.map(toVersionView);
}

/**
 * Submit a version, and run the WHOLE review pipeline on it — synchronously.
 *
 * A publisher who has to poll for a verdict is a publisher who does not come
 * back, so all three stages run while they are still looking at the form. What
 * makes that affordable is that the stages are budgeted rather than shortened:
 * `dynamicReview` caps its real requests and their wall clock, and the agentic
 * stage is one small structured call.
 *
 * ── WHY THE ROW IS WRITTEN BEFORE THE PIPELINE FINISHES ─────────────────────
 * The dynamic stage installs the CANDIDATE version into a sandbox workspace, and
 * `tenant_extension_installs.version_id` is a foreign key — so the version must
 * exist before it can be exercised. The row therefore lands as `pending` and is
 * settled afterwards, which is also the honest sequence: `pending` is exactly
 * what a submission whose review is still running IS.
 *
 * A rejected submission is still STORED, with its findings and its per-stage
 * evidence. Throwing the row away would mean the publisher's third attempt has no
 * record of the first two, and the pipeline would have no data about what
 * publishers get wrong.
 */
export async function submitVersion(
  db: Db,
  env: Env,
  input: {
    packageId: string;
    actorUserId: string;
    semver: string;
    spec: unknown;
    requestedScopes: string[];
    changelog?: string | null;
  },
): Promise<{ version: VersionView; approved: boolean }> {
  const pkg = await loadPackage(db, input.packageId);
  const { tenant } = await requirePublisher(db, pkg.tenantId, input.actorUserId, 'developer');

  const semver = input.semver.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(semver)) {
    throw new PublisherError('semver must look like 1.0.0');
  }
  const [dupe] = await db
    .select({ id: extensionVersions.id })
    .from(extensionVersions)
    .where(and(eq(extensionVersions.packageId, input.packageId), eq(extensionVersions.semver, semver)))
    .limit(1);
  if (dupe) throw new PublisherError(`version ${semver} already exists — versions are immutable`, 409);

  const previous = pkg.currentVersionId ? await loadVersion(db, pkg.currentVersionId) : null;

  // The static stage runs here first and alone, because it is the only one that
  // can NORMALIZE the spec — and an unparseable spec must not be stored at all,
  // let alone installed into a sandbox. Its verdict is recomposed by the pipeline
  // below, which re-runs it as stage one; running it twice costs nothing (it is
  // pure) and buys the property that the pipeline owns the whole composition
  // rather than this function owning the first third of it.
  const provisional = reviewVersion({
    kind: pkg.kind as ExtensionKind,
    spec: input.spec,
    requestedScopes: input.requestedScopes,
    verificationState: tenant.publisherState,
    paid: pkg.catalogItemId !== null,
    previousScopes: previous?.requestedScopes ?? null,
  });

  const [row] = await db
    .insert(extensionVersions)
    .values({
      packageId: input.packageId,
      semver,
      spec: provisional.normalizedSpec,
      requestedScopes: provisional.scopes,
      changelog: input.changelog?.trim() || null,
      reviewState: 'pending',
      reviewFindings: provisional.findings as unknown as Array<Record<string, unknown>>,
    })
    .returning();
  if (!row) throw new PublisherError('failed to record version', 409);

  installReviewStages();
  const outcome = await runReviewPipeline({
    db,
    env,
    packageId: pkg.id,
    packageSlug: pkg.slug,
    versionId: row.id,
    semver,
    kind: pkg.kind as ExtensionKind,
    spec: input.spec,
    normalizedSpec: {},
    scopes: [],
    requestedScopes: input.requestedScopes,
    verificationState: tenant.publisherState,
    paid: pkg.catalogItemId !== null,
    previousScopes: previous?.requestedScopes ?? null,
    priorStages: new Map(),
  });

  await recordReviewStages(db, row.id, outcome);

  const [settled] = await db
    .update(extensionVersions)
    .set({
      spec: outcome.normalizedSpec,
      requestedScopes: outcome.scopes,
      reviewState: outcome.approved ? 'approved' : 'rejected',
      reviewFindings: outcome.findings as unknown as Array<Record<string, unknown>>,
      reviewedAt: new Date(),
    })
    .where(eq(extensionVersions.id, row.id))
    .returning();

  return { version: toVersionView(settled ?? row), approved: outcome.approved };
}

/**
 * Persist what each stage did, one row per stage.
 *
 * An upsert on (version, stage) rather than an insert: a re-review REPLACES its
 * stage record, so "what did the dynamic stage say about 1.2.0" has exactly one
 * answer rather than a history a reader has to date-sort to interpret.
 *
 * Best-effort, and deliberately so. The stage record is the audit trail; the
 * VERDICT is on the version row. Losing the trail to a write error must not lose
 * the verdict, and it must not turn an approved submission into a 500.
 */
async function recordReviewStages(db: Db, versionId: string, outcome: PipelineOutcome): Promise<void> {
  for (const stage of outcome.stages) {
    try {
      await db
        .insert(extensionReviewStages)
        .values({
          versionId,
          stage: stage.stage,
          verdict: stage.verdict,
          findings: stage.findings as unknown as Array<Record<string, unknown>>,
          evidence: stage.evidence as unknown as Array<Record<string, unknown>>,
          sandboxTenantId: stage.sandboxTenantId ?? null,
          durationMs: stage.durationMs,
        })
        .onConflictDoUpdate({
          target: [extensionReviewStages.versionId, extensionReviewStages.stage],
          set: {
            verdict: stage.verdict,
            findings: stage.findings as unknown as Array<Record<string, unknown>>,
            evidence: stage.evidence as unknown as Array<Record<string, unknown>>,
            sandboxTenantId: stage.sandboxTenantId ?? null,
            durationMs: stage.durationMs,
            createdAt: new Date(),
          },
        });
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/developer/extensionPackages.ts',
        operation: `recordReviewStages:${stage.stage}`,
      });
    }
  }
}

/**
 * Every stage record for a version.
 *
 * The publisher's own view of why a submission was refused, and the operator's
 * view of what the pipeline actually exercised. `evidence` is returned in full
 * because a truncated audit trail answers the wrong question.
 */
export async function listReviewStages(
  db: Db,
  versionId: string,
  actorUserId: string,
): Promise<Array<{
  stage: string;
  verdict: string;
  findings: ReviewFinding[];
  evidence: Array<Record<string, unknown>>;
  sandboxTenantId: number | null;
  durationMs: number | null;
  createdAt: string | null;
}>> {
  const version = await loadVersion(db, versionId);
  const pkg = await loadPackage(db, version.packageId);
  await requirePublisher(db, pkg.tenantId, actorUserId, 'developer');

  const rows = await db
    .select()
    .from(extensionReviewStages)
    .where(eq(extensionReviewStages.versionId, versionId))
    .orderBy(asc(extensionReviewStages.stage));

  return rows.map((r) => ({
    stage: r.stage,
    verdict: r.verdict,
    findings: (r.findings ?? []) as unknown as ReviewFinding[],
    evidence: (r.evidence ?? []) as Array<Record<string, unknown>>,
    sandboxTenantId: r.sandboxTenantId,
    durationMs: r.durationMs,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }));
}

/**
 * Publish an approved version as the package head, and list the package.
 *
 * Publish and list are ONE call on purpose. A publisher who has passed review and
 * chosen a version has already made the decision; a second "and now make it
 * visible" step is the one people forget, and a package that is approved but
 * invisible looks to them like the review failed.
 */
export async function publishVersion(
  db: Db,
  env: Env,
  input: { packageId: string; versionId: string; actorUserId: string },
): Promise<PackageView> {
  const pkg = await loadPackage(db, input.packageId);
  await requirePublisher(db, pkg.tenantId, input.actorUserId, 'developer');

  const version = await loadVersion(db, input.versionId);
  if (version.packageId !== pkg.id) throw new PublisherError('that version belongs to another package', 400);
  if (version.reviewState !== 'approved') throw new PublisherError('only an approved version can be published', 409);

  await db
    .update(extensionVersions)
    .set({ publishedAt: new Date() })
    .where(eq(extensionVersions.id, version.id));

  const [row] = await db
    .update(extensionPackages)
    .set({
      currentVersionId: version.id,
      listingState: 'listed',
      // Publish is the ONE moment the platform holds both the listing metadata
      // and a parsed spec, so it is the only place the capability half of the
      // search projection can be built. A listing whose actions are not in
      // `search_text` is invisible to everybody searching for what it DOES,
      // which is what most people search for.
      searchText: buildSearchText({
        name: pkg.name,
        tagline: pkg.tagline,
        description: pkg.description,
        categories: pkg.categories,
        kind: pkg.kind,
        spec: version.spec,
      }),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(extensionPackages, pkg.tenantId, eq(extensionPackages.id, pkg.id)))
    .returning();
  if (!row) throw new PublisherError('package not found', 404);

  await invalidatePublicCatalog(env);
  return toPackageView(row);
}

/** Take a package off the catalog. Existing installs keep working — see `setListingState`. */
export async function setListingState(
  db: Db,
  env: Env,
  input: { packageId: string; actorUserId: string; state: ListingState },
): Promise<PackageView> {
  const pkg = await loadPackage(db, input.packageId);
  await requirePublisher(db, pkg.tenantId, input.actorUserId, 'manager');
  if (input.state === 'listed' && !pkg.currentVersionId) {
    throw new PublisherError('publish an approved version before listing', 409);
  }
  const [row] = await db
    .update(extensionPackages)
    .set({ listingState: input.state, updatedAt: new Date() })
    .where(scopedToTenant(extensionPackages, pkg.tenantId, eq(extensionPackages.id, pkg.id)))
    .returning();
  if (!row) throw new PublisherError('package not found', 404);
  await invalidatePublicCatalog(env);
  return toPackageView(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public catalog
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every listed package, with its publisher.
 *
 * A cross-tenant read by construction — a published package is the same row for
 * every tenant, which is what `public_catalogue` means. It is served through the
 * read-through cache because the catalog is hit by the marketplace grid, the
 * install picker and (Phase 3) the public integrations page, and it changes only
 * when somebody publishes.
 *
 * Suspended publishers are filtered HERE rather than at each call site, so
 * standing a vendor down removes their listings everywhere at once.
 */
export async function listPublicCatalog(db: Db, env: Env): Promise<PackageView[]> {
  return getOrSetCached(
    env,
    CATALOG_CACHE_KEY,
    async () => {
      const rows = await db
        .select({
          pkg: extensionPackages,
          publisher: tenants,
          listingPriceCents: catalogItems.priceCents,
          listingCurrency: catalogItems.currency,
          listingVisibility: catalogItems.visibility,
        })
        .from(extensionPackages)
        .innerJoin(tenants, eq(tenants.id, extensionPackages.tenantId))
        // LEFT, because most listings are free and have no catalogue row at all.
        // An INNER join here would quietly delete every free package from the
        // catalogue that the install picker and `/integrations` both read.
        .leftJoin(catalogItems, eq(catalogItems.id, extensionPackages.catalogItemId))
        .where(acrossTenants(
          extensionPackages,
          'public_catalogue',
          eq(extensionPackages.listingState, 'listed'),
          sql`${tenants.publisherSuspendedAt} is null`,
        ))
        .orderBy(desc(extensionPackages.installCount));
      return rows.map((r) => toPackageView(r.pkg, r.publisher, {
        // `visibility` and not the id: clearing a price list keeps the row and
        // drops it to `private`, which is exactly "no longer on sale".
        paid: r.listingVisibility === 'public',
        fromCents: r.listingPriceCents ?? null,
        currency: r.listingCurrency ?? 'USD',
      }));
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/** One listed package by slug, for the listing page. */
export async function getPublicPackage(db: Db, env: Env, slug: string): Promise<{ pkg: PackageView; version: VersionView | null } | null> {
  const catalog = await listPublicCatalog(db, env);
  const pkg = catalog.find((p) => p.slug === slug);
  if (!pkg) return null;
  const version = pkg.currentVersionId ? toVersionView(await loadVersion(db, pkg.currentVersionId)) : null;
  return { pkg, version };
}

/**
 * The loaders and the cache keys this module used to own now live in
 * `extensionRepository.ts`, and they moved for a structural reason rather than a
 * tidying one: `extensionInstalls` needed the same two reads, which made the
 * installs module import this one — and once the review pipeline resolved a
 * manifest through `connectorRegistry` (which reads installs), a packages module
 * that reached the stages closed a cycle through three bounded contexts. The
 * shared bottom of this context was never the packages SERVICE's to own.
 */
export { loadPackage, loadVersion, loadPackagesByIds, invalidatePublicCatalog } from './extensionRepository';
