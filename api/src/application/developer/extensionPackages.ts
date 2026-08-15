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

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { developerOrgs, extensionPackages, extensionVersions } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { DeveloperOrgError, requireMembership, slugify } from './developerOrgs';
import {
  isExtensionKind,
  SUBMITTABLE_KINDS,
  type ExtensionKind,
  type ListingState,
} from './extensionContract';
import { reviewVersion, type ReviewFinding } from './packageReview';

export interface PackageView {
  id: string;
  developerOrgId: string;
  publisher: { slug: string; legalName: string; verificationState: string } | null;
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
  installCount: number;
  updatedAt: string | null;
}

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

type PackageRow = typeof extensionPackages.$inferSelect;
type VersionRow = typeof extensionVersions.$inferSelect;
type OrgRow = typeof developerOrgs.$inferSelect;

function toPackageView(row: PackageRow, org?: OrgRow | null): PackageView {
  return {
    id: row.id,
    developerOrgId: row.developerOrgId,
    publisher: org
      ? { slug: org.slug, legalName: org.legalName, verificationState: org.verificationState }
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

const CATALOG_CACHE_KEY = 'developer:catalog:listed';

/** The public catalog goes stale on any publish, delist or suspension. */
export async function invalidatePublicCatalog(env: Env): Promise<void> {
  await invalidateCached(env, CATALOG_CACHE_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Publisher-side
// ─────────────────────────────────────────────────────────────────────────────

export async function createPackage(
  db: Db,
  env: Env,
  input: {
    orgId: string;
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
  const { org } = await requireMembership(db, input.orgId, input.actorUserId, 'publisher');

  if (!isExtensionKind(input.kind) || !SUBMITTABLE_KINDS.includes(input.kind)) {
    throw new DeveloperOrgError(`kind must be one of: ${SUBMITTABLE_KINDS.join(', ')}`);
  }
  const name = input.name.trim();
  if (name.length < 2) throw new DeveloperOrgError('name is required');

  const slug = slugify(input.slug?.trim() || name);
  const [taken] = await db.select({ id: extensionPackages.id }).from(extensionPackages).where(eq(extensionPackages.slug, slug)).limit(1);
  if (taken) throw new DeveloperOrgError(`the slug "${slug}" is taken`, 409);

  const [row] = await db
    .insert(extensionPackages)
    .values({
      developerOrgId: input.orgId,
      slug,
      kind: input.kind,
      name,
      tagline: (input.tagline ?? '').trim().slice(0, 240),
      description: input.description?.trim() || null,
      categories: input.categories ?? [],
      docsUrl: input.docsUrl?.trim() || null,
    })
    .returning();
  if (!row) throw new DeveloperOrgError('failed to create package', 409);

  return toPackageView(row, org);
}

/** Every package a publisher owns, drafts included. */
export async function listPackagesForOrg(db: Db, orgId: string, actorUserId: string): Promise<PackageView[]> {
  const { org } = await requireMembership(db, orgId, actorUserId, 'publisher');
  const rows = await db
    .select()
    .from(extensionPackages)
    .where(eq(extensionPackages.developerOrgId, orgId))
    .orderBy(desc(extensionPackages.updatedAt));
  return rows.map((r) => toPackageView(r, org));
}

export async function listVersions(db: Db, packageId: string, actorUserId: string): Promise<VersionView[]> {
  const pkg = await loadPackage(db, packageId);
  await requireMembership(db, pkg.developerOrgId, actorUserId, 'publisher');
  const rows = await db
    .select()
    .from(extensionVersions)
    .where(eq(extensionVersions.packageId, packageId))
    .orderBy(desc(extensionVersions.createdAt));
  return rows.map(toVersionView);
}

/**
 * Submit a version. Static review runs here, synchronously, and a failure is a
 * 400 with the findings attached — the publisher fixes it while looking at it.
 *
 * A rejected submission is still STORED, with its findings. Throwing the row away
 * would mean the publisher's third attempt has no record of the first two, and
 * the review pipeline would have no data about what publishers get wrong.
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
  const { org } = await requireMembership(db, pkg.developerOrgId, input.actorUserId, 'publisher');

  const semver = input.semver.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(semver)) {
    throw new DeveloperOrgError('semver must look like 1.0.0');
  }
  const [dupe] = await db
    .select({ id: extensionVersions.id })
    .from(extensionVersions)
    .where(and(eq(extensionVersions.packageId, input.packageId), eq(extensionVersions.semver, semver)))
    .limit(1);
  if (dupe) throw new DeveloperOrgError(`version ${semver} already exists — versions are immutable`, 409);

  const previous = pkg.currentVersionId ? await loadVersion(db, pkg.currentVersionId) : null;

  const outcome = reviewVersion({
    kind: pkg.kind as ExtensionKind,
    spec: input.spec,
    requestedScopes: input.requestedScopes,
    verificationState: org.verificationState,
    paid: pkg.catalogItemId !== null,
    previousScopes: previous?.requestedScopes ?? null,
  });

  const [row] = await db
    .insert(extensionVersions)
    .values({
      packageId: input.packageId,
      semver,
      spec: outcome.normalizedSpec,
      requestedScopes: outcome.scopes,
      changelog: input.changelog?.trim() || null,
      reviewState: outcome.approved ? 'approved' : 'rejected',
      reviewFindings: outcome.findings as unknown as Array<Record<string, unknown>>,
      reviewedAt: new Date(),
    })
    .returning();
  if (!row) throw new DeveloperOrgError('failed to record version', 409);

  return { version: toVersionView(row), approved: outcome.approved };
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
  await requireMembership(db, pkg.developerOrgId, input.actorUserId, 'publisher');

  const version = await loadVersion(db, input.versionId);
  if (version.packageId !== pkg.id) throw new DeveloperOrgError('that version belongs to another package', 400);
  if (version.reviewState !== 'approved') throw new DeveloperOrgError('only an approved version can be published', 409);

  await db
    .update(extensionVersions)
    .set({ publishedAt: new Date() })
    .where(eq(extensionVersions.id, version.id));

  const [row] = await db
    .update(extensionPackages)
    .set({ currentVersionId: version.id, listingState: 'listed', updatedAt: new Date() })
    .where(eq(extensionPackages.id, pkg.id))
    .returning();
  if (!row) throw new DeveloperOrgError('package not found', 404);

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
  await requireMembership(db, pkg.developerOrgId, input.actorUserId, 'admin');
  if (input.state === 'listed' && !pkg.currentVersionId) {
    throw new DeveloperOrgError('publish an approved version before listing', 409);
  }
  const [row] = await db
    .update(extensionPackages)
    .set({ listingState: input.state, updatedAt: new Date() })
    .where(eq(extensionPackages.id, pkg.id))
    .returning();
  if (!row) throw new DeveloperOrgError('package not found', 404);
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
        .select({ pkg: extensionPackages, org: developerOrgs })
        .from(extensionPackages)
        .innerJoin(developerOrgs, eq(developerOrgs.id, extensionPackages.developerOrgId))
        .where(and(eq(extensionPackages.listingState, 'listed'), sql`${developerOrgs.suspendedAt} is null`))
        .orderBy(desc(extensionPackages.installCount));
      return rows.map((r) => toPackageView(r.pkg, r.org));
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

// ─────────────────────────────────────────────────────────────────────────────
// Loaders shared by every path above
// ─────────────────────────────────────────────────────────────────────────────

export async function loadPackage(db: Db, packageId: string): Promise<PackageRow> {
  const [row] = await db.select().from(extensionPackages).where(eq(extensionPackages.id, packageId)).limit(1);
  if (!row) throw new DeveloperOrgError('package not found', 404);
  return row;
}

export async function loadVersion(db: Db, versionId: string): Promise<VersionRow> {
  const [row] = await db.select().from(extensionVersions).where(eq(extensionVersions.id, versionId)).limit(1);
  if (!row) throw new DeveloperOrgError('version not found', 404);
  return row;
}

/** Load many packages by id in one round-trip. Used by the install list. */
export async function loadPackagesByIds(db: Db, ids: string[]): Promise<Map<string, PackageRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(extensionPackages).where(inArray(extensionPackages.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
