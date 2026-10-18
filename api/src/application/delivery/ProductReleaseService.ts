/**
 * Product release service — the CRUD behind /api/releases (0227).
 *
 * A release is already a first-class entity and a task already carries
 * `releaseId`; associating a task with a release stays on the task update path,
 * so this service is the single writer of a `product_releases` row and nothing
 * else.
 *
 * Every read and write is tenant-scoped HERE rather than at the caller. That is
 * the point of moving it out of `releasesRoutes.ts`: the predicate was repeated
 * in four handlers, and a fifth handler that forgot it would have been a
 * cross-tenant read with no guard to catch it.
 *
 * It is also the ONE release use case: `/api/product/release-planning` used to be
 * a second, generic-tracker writer of the same table that stamped `segment_id` and
 * filtered on it, while this service wrote rows with no segment. Each surface was
 * therefore blind to the other's releases. Both now run through here, with ONE
 * segment rule: a caller with a segment sees its segment's rows plus the
 * tenant-wide (segment-less) ones, and new rows carry the caller's segment.
 */
import { desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { productReleases } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';

export const RELEASE_STATUSES = ['planned', 'in_progress', 'released', 'cancelled'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export interface ReleaseInput {
  name?: string;
  version?: string;
  projectId?: number | null;
  status?: string;
  targetDate?: string | null;
  releasedAt?: string | null;
  /** The release-planning tracker's single "Date" field (column `release_date`). */
  releaseDate?: string | null;
  notes?: string;
}

/** Who is asking. `segmentId` is the end-client segment when the request carries one. */
export interface ReleaseScope {
  tenantId: number;
  segmentId?: string | null;
}

/** The segment rule described in the header; no segment = the whole tenant. */
function segmentRule(scope: ReleaseScope): SQL | undefined {
  return scope.segmentId
    ? or(isNull(productReleases.segmentId), eq(productReleases.segmentId, scope.segmentId))
    : undefined;
}

/** Coerce an ISO date string/number to a Date, or null. */
function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const d = new Date(raw as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function positiveInt(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export class ProductReleaseService {
  constructor(private readonly db: Db) {}

  /** Releases in scope, optionally narrowed to one project (the picker's
   *  "releases for this project" mode). Newest target/release date first. */
  async list(scope: ReleaseScope, projectId?: number) {
    return this.db
      .select({
        id: productReleases.id, name: productReleases.name, version: productReleases.version,
        projectId: productReleases.projectId, status: productReleases.status,
        targetDate: productReleases.targetDate, releasedAt: productReleases.releasedAt,
        releaseDate: productReleases.releaseDate, notes: productReleases.notes,
        createdAt: productReleases.createdAt, updatedAt: productReleases.updatedAt,
      })
      .from(productReleases)
      .where(scopedToTenant(productReleases, scope.tenantId, segmentRule(scope), projectId != null ? eq(productReleases.projectId, projectId) : undefined))
      .orderBy(desc(productReleases.targetDate), desc(productReleases.createdAt))
      .limit(500);
  }

  /** @throws never — the caller validates that `name` is present. */
  async create(scope: ReleaseScope, input: ReleaseInput & { name: string }) {
    const [row] = await this.db
      .insert(productReleases)
      .values({
        tenantId: scope.tenantId,
        segmentId: scope.segmentId ?? null,
        name: input.name.trim().slice(0, 255),
        version: typeof input.version === 'string' ? input.version.trim().slice(0, 50) : null,
        projectId: positiveInt(input.projectId) ?? null,
        status: RELEASE_STATUSES.includes(input.status as ReleaseStatus) ? (input.status as ReleaseStatus) : 'planned',
        targetDate: parseDate(input.targetDate),
        releasedAt: parseDate(input.releasedAt),
        releaseDate: parseDate(input.releaseDate),
        notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null,
      })
      .returning();
    return row!;
  }

  /** Partial update. Only keys PRESENT in `input` are written, so an omitted
   *  field keeps its value and an explicit null clears it. */
  async update(scope: ReleaseScope, id: string, input: ReleaseInput) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) set.name = input.name.trim().slice(0, 255);
    if (typeof input.version === 'string') set.version = input.version.trim().slice(0, 50);
    if ('projectId' in input) set.projectId = positiveInt(input.projectId) ?? null;
    if (RELEASE_STATUSES.includes(input.status as ReleaseStatus)) set.status = input.status;
    if ('targetDate' in input) set.targetDate = parseDate(input.targetDate);
    if ('releasedAt' in input) set.releasedAt = parseDate(input.releasedAt);
    if ('releaseDate' in input) set.releaseDate = parseDate(input.releaseDate);
    if (typeof input.notes === 'string') set.notes = input.notes.slice(0, 4000);

    const [row] = await this.db
      .update(productReleases)
      .set(set)
      .where(scopedToTenant(productReleases, scope.tenantId, segmentRule(scope), eq(productReleases.id, id)))
      .returning();
    return row ?? null;
  }

  /** Delete a release in scope; true when a row went. */
  async remove(scope: ReleaseScope, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(productReleases)
      .where(scopedToTenant(productReleases, scope.tenantId, segmentRule(scope), eq(productReleases.id, id)))
      .returning({ id: productReleases.id });
    return rows.length > 0;
  }
}
