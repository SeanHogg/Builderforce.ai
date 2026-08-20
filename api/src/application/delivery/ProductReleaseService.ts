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
 */
import { and, desc, eq } from 'drizzle-orm';
import { productReleases } from '../../infrastructure/database/schema';
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
  notes?: string;
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

  /** Releases for a tenant, optionally narrowed to one project (the picker's
   *  "releases for this project" mode). Newest target/release date first. */
  async list(tenantId: number, projectId?: number) {
    const where = projectId != null
      ? and(eq(productReleases.tenantId, tenantId), eq(productReleases.projectId, projectId))
      : eq(productReleases.tenantId, tenantId);
    return this.db
      .select({
        id: productReleases.id, name: productReleases.name, version: productReleases.version,
        projectId: productReleases.projectId, status: productReleases.status,
        targetDate: productReleases.targetDate, releasedAt: productReleases.releasedAt,
        releaseDate: productReleases.releaseDate, notes: productReleases.notes,
      })
      .from(productReleases)
      .where(where)
      .orderBy(desc(productReleases.targetDate), desc(productReleases.createdAt))
      .limit(500);
  }

  /** @throws never — the caller validates that `name` is present. */
  async create(tenantId: number, input: ReleaseInput & { name: string }) {
    const [row] = await this.db
      .insert(productReleases)
      .values({
        tenantId,
        name: input.name.trim().slice(0, 255),
        version: typeof input.version === 'string' ? input.version.trim().slice(0, 50) : null,
        projectId: positiveInt(input.projectId) ?? null,
        status: RELEASE_STATUSES.includes(input.status as ReleaseStatus) ? (input.status as ReleaseStatus) : 'planned',
        targetDate: parseDate(input.targetDate),
        releasedAt: parseDate(input.releasedAt),
        notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null,
      })
      .returning();
    return row!;
  }

  /** Partial update. Only keys PRESENT in `input` are written, so an omitted
   *  field keeps its value and an explicit null clears it. */
  async update(tenantId: number, id: string, input: ReleaseInput) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) set.name = input.name.trim().slice(0, 255);
    if (typeof input.version === 'string') set.version = input.version.trim().slice(0, 50);
    if ('projectId' in input) set.projectId = positiveInt(input.projectId) ?? null;
    if (RELEASE_STATUSES.includes(input.status as ReleaseStatus)) set.status = input.status;
    if ('targetDate' in input) set.targetDate = parseDate(input.targetDate);
    if ('releasedAt' in input) set.releasedAt = parseDate(input.releasedAt);
    if (typeof input.notes === 'string') set.notes = input.notes.slice(0, 4000);

    const [row] = await this.db
      .update(productReleases)
      .set(set)
      .where(and(eq(productReleases.id, id), eq(productReleases.tenantId, tenantId)))
      .returning();
    return row ?? null;
  }

  async remove(tenantId: number, id: string): Promise<void> {
    await this.db.delete(productReleases).where(and(eq(productReleases.id, id), eq(productReleases.tenantId, tenantId)));
  }
}
