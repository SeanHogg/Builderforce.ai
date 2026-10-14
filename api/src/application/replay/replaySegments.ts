/**
 * Saved segments — a named `ReplayFilter` per site (PRD 33 §2.1 "Filters + saved
 * segments", §3.2 `replay_segments`).
 *
 * Definitions live on CORE; the route has already proved the site is the caller's
 * workspace's (`getSiteForTenant`), and every statement here is bound to that site.
 * The filter is validated by the contract's `parseReplayFilter` AND by the compiler
 * (a filter that cannot compile is never saved). Names are unique per site. Reads
 * are cached under the site version; every write bumps it.
 */

import { and, asc, eq } from 'drizzle-orm';
import { parseReplayFilter, type ReplayFilter, type ReplaySegmentDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replaySegments } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { bumpSiteVersion, replayReadKeys } from './replayCacheKeys';
import { compileReplayFilter } from './replayFilterCompiler';

export const SEGMENT_NAME_MAX = 120;
/** Most segments one site may save. */
export const MAX_SEGMENTS_PER_SITE = 100;

const TTL = { kvTtlSeconds: 600, l1TtlMs: 30_000 };

type SegmentRow = typeof replaySegments.$inferSelect;

function toDto(row: SegmentRow): ReplaySegmentDto {
  return {
    id: row.id,
    name: row.name,
    filter: parseReplayFilter(row.filter) ?? { all: [] },
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt))).toISOString(),
  };
}

export function validateSegmentName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new ValidationError('A segment needs a name');
  if (name.length > SEGMENT_NAME_MAX) throw new ValidationError(`A segment name is at most ${SEGMENT_NAME_MAX} characters`);
  return name;
}

/** Contract-valid AND compilable (smart-event names compile against any rule set). */
export function validateSegmentFilter(raw: unknown): ReplayFilter {
  const filter = parseReplayFilter(raw);
  if (!filter) throw new ValidationError('That filter is not valid');
  const { rejected } = compileReplayFilter(filter);
  if (rejected.length) throw new ValidationError(rejected.map((r) => r.reason).join('; '));
  return filter;
}

const conflict = (name: string) => new ConflictError(`A segment named "${name}" already exists on this site`);

export async function listSegments(env: Env, db: Db, scope: ReplayScope): Promise<ReplaySegmentDto[]> {
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.segments(), async () => {
    const rows = await db
      .select()
      .from(replaySegments)
      .where(eq(replaySegments.siteId, scope.siteId))
      .orderBy(asc(replaySegments.name))
      .limit(MAX_SEGMENTS_PER_SITE);
    return rows.map(toDto);
  }, TTL);
}

export async function createSegment(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { name: unknown; filter: unknown; userId: string | null },
): Promise<ReplaySegmentDto> {
  const name = validateSegmentName(input.name);
  const filter = validateSegmentFilter(input.filter);
  if ((await listSegments(env, db, scope)).length >= MAX_SEGMENTS_PER_SITE) {
    throw new ValidationError(`A site keeps at most ${MAX_SEGMENTS_PER_SITE} segments`);
  }
  try {
    const [row] = await db
      .insert(replaySegments)
      .values({ siteId: scope.siteId, name, filter, createdBy: input.userId })
      .returning();
    await bumpSiteVersion(env, scope.siteId);
    return toDto(row!);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(name);
    throw error;
  }
}

/** Rename and/or replace the filter. 404 for a segment not on this site. */
export async function updateSegment(
  env: Env,
  db: Db,
  scope: ReplayScope,
  segmentId: string,
  patch: { name?: unknown; filter?: unknown },
): Promise<ReplaySegmentDto> {
  if (!isUuid(segmentId)) throw new NotFoundError('Segment', segmentId);
  const set: { name?: string; filter?: ReplayFilter } = {};
  if (patch.name !== undefined) set.name = validateSegmentName(patch.name);
  if (patch.filter !== undefined) set.filter = validateSegmentFilter(patch.filter);
  if (!set.name && !set.filter) throw new ValidationError('Nothing to change');
  try {
    const [row] = await db
      .update(replaySegments)
      .set(set)
      .where(and(eq(replaySegments.siteId, scope.siteId), eq(replaySegments.id, segmentId)))
      .returning();
    if (!row) throw new NotFoundError('Segment', segmentId);
    await bumpSiteVersion(env, scope.siteId);
    return toDto(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(set.name ?? '');
    throw error;
  }
}

export async function deleteSegment(env: Env, db: Db, scope: ReplayScope, segmentId: string): Promise<void> {
  if (!isUuid(segmentId)) throw new NotFoundError('Segment', segmentId);
  const removed = await db
    .delete(replaySegments)
    .where(and(eq(replaySegments.siteId, scope.siteId), eq(replaySegments.id, segmentId)))
    .returning({ id: replaySegments.id });
  if (removed.length === 0) throw new NotFoundError('Segment', segmentId);
  await bumpSiteVersion(env, scope.siteId);
}
