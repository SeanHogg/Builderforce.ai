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
import { desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { productReleases } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import {
  RELEASED_STATUS,
  applyReleasedAtPlan,
  foldDeprecatedReleaseDate,
  isReleaseStatus,
  planReleasedAt,
  type ReleasedAtPlan,
} from '../../domain/delivery/releaseSchedule';

export interface ReleaseInput {
  name?: string;
  version?: string;
  projectId?: number | null;
  status?: string;
  /** The planned ship date. */
  targetDate?: string | null;
  /** When it actually shipped. Honoured only on a write that marks the release
   *  released, or as a correction to one that already is; otherwise the status
   *  transition owns it (see `planReleasedAt`). */
  releasedAt?: string | null;
  /** @deprecated the old single "Date" field — folded onto `targetDate` (or onto
   *  `releasedAt` on a write that marks the release released) by
   *  `foldDeprecatedReleaseDate`. Accepted for one release. */
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

/**
 * The `released_at` SET clause for an update — `applyReleasedAtPlan` in SQL, so it
 * reads the row's CURRENT `released_at` / `status` inside the one UPDATE rather
 * than a separate read a concurrent transition could slip between. Undefined =
 * leave the column alone.
 */
function releasedAtSet(plan: ReleasedAtPlan): SQL | Date | null | undefined {
  switch (plan.kind) {
    case 'keep': return undefined;
    case 'clear': return null;
    case 'set': return plan.at;
    case 'stamp': return sql`COALESCE(${productReleases.releasedAt}, ${plan.at.toISOString()}::timestamptz)`;
    case 'correct':
      return sql`CASE WHEN ${productReleases.status} = ${RELEASED_STATUS} THEN ${plan.at.toISOString()}::timestamptz ELSE ${productReleases.releasedAt} END`;
  }
}

/**
 * The ONE wire projection of a release row, used by every read and every
 * `.returning()`. Explicit rather than `select()` / `returning()`, so the wire shape is
 * this list and nothing a later column adds leaks into a response.
 */
const RELEASE_COLUMNS = {
  id: productReleases.id, name: productReleases.name, version: productReleases.version,
  projectId: productReleases.projectId, status: productReleases.status,
  targetDate: productReleases.targetDate, releasedAt: productReleases.releasedAt,
  notes: productReleases.notes,
  createdAt: productReleases.createdAt, updatedAt: productReleases.updatedAt,
};

export class ProductReleaseService {
  constructor(private readonly db: Db) {}

  /** Releases in scope, optionally narrowed to one project (the picker's
   *  "releases for this project" mode). Newest planned (target) date first. */
  async list(scope: ReleaseScope, projectId?: number) {
    return this.db
      .select(RELEASE_COLUMNS)
      .from(productReleases)
      .where(scopedToTenant(productReleases, scope.tenantId, segmentRule(scope), projectId != null ? eq(productReleases.projectId, projectId) : undefined))
      .orderBy(desc(productReleases.targetDate), desc(productReleases.createdAt))
      .limit(500);
  }

  /** @throws never — the caller validates that `name` is present. */
  async create(scope: ReleaseScope, raw: ReleaseInput & { name: string }, now: Date = new Date()) {
    const input = foldDeprecatedReleaseDate(raw);
    const status = isReleaseStatus(input.status) ? input.status : 'planned';
    const releasedAt = applyReleasedAtPlan(planReleasedAt({ status, releasedAt: parseDate(input.releasedAt) }, now), null);
    const [row] = await this.db
      .insert(productReleases)
      .values({
        tenantId: scope.tenantId,
        segmentId: scope.segmentId ?? null,
        name: input.name.trim().slice(0, 255),
        version: typeof input.version === 'string' ? input.version.trim().slice(0, 50) : null,
        projectId: positiveInt(input.projectId) ?? null,
        status,
        targetDate: parseDate(input.targetDate),
        releasedAt,
        notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null,
      })
      .returning(RELEASE_COLUMNS);
    return row!;
  }

  /** Partial update. Only keys PRESENT in `input` are written, so an omitted
   *  field keeps its value and an explicit null clears it — except `releasedAt`,
   *  which follows the status transition (stamped on the move to released, cleared
   *  on a move back to planned / in_progress, kept on cancel; see `planReleasedAt`). */
  async update(scope: ReleaseScope, id: string, raw: ReleaseInput, now: Date = new Date()) {
    const input = foldDeprecatedReleaseDate(raw);
    const status = isReleaseStatus(input.status) ? input.status : undefined;
    const set: Record<string, unknown> = { updatedAt: now };
    if (typeof input.name === 'string' && input.name.trim()) set.name = input.name.trim().slice(0, 255);
    if (typeof input.version === 'string') set.version = input.version.trim().slice(0, 50);
    if ('projectId' in input) set.projectId = positiveInt(input.projectId) ?? null;
    if (status) set.status = status;
    if ('targetDate' in input) set.targetDate = parseDate(input.targetDate);
    const releasedAt = releasedAtSet(planReleasedAt({ status, releasedAt: parseDate(input.releasedAt) }, now));
    if (releasedAt !== undefined) set.releasedAt = releasedAt;
    if (typeof input.notes === 'string') set.notes = input.notes.slice(0, 4000);

    const [row] = await this.db
      .update(productReleases)
      .set(set)
      .where(scopedToTenant(productReleases, scope.tenantId, segmentRule(scope), eq(productReleases.id, id)))
      .returning(RELEASE_COLUMNS);
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
