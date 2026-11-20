/**
 * W2: the blueprint store. Detection itself is pure and host-neutral
 * (`detectApp` in `@builderforce/app-detect`); `readBlueprintSources` fetches a repo's
 * files, and `detectBlueprintForProject` is the one use case that wires a project's
 * repo + credential through both and stores the result here.
 */

import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { projectAppBlueprints } from '../../infrastructure/database/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import type { Env } from '../../env';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';

/**
 * Get a stored blueprint for a project at a specific commit.
 */
export async function getBlueprint(env: Env, projectId: number, commitSha: string): Promise<AppBlueprint | null> {
  const db = buildDatabase(env);
  const row = await db
    .select()
    .from(projectAppBlueprints)
    .where(and(
      eq(projectAppBlueprints.projectId, projectId),
      eq(projectAppBlueprints.commitSha, commitSha)
    ))
    .limit(1);
  
  if (!row[0]) {
    return null;
  }
  
  return row[0].blueprint as unknown as AppBlueprint;
}

/**
 * The version token behind a project's cached latest blueprint. `storeBlueprint` BUMPS it,
 * which orphans every cached read at once (both layers, every isolate) — a delete of one
 * key could race a read that re-filled it with the old row.
 */
export const latestBlueprintVersionKey = (projectId: number): string => `project:blueprint:${projectId}`;

/**
 * Get the latest blueprint for a project. Read through the cache: the run loop reads it
 * every time a preview opens, and it changes only when detection stores a new one.
 * The value is boxed so "no blueprint yet" caches too.
 */
export async function getLatestBlueprint(env: Env, projectId: number): Promise<AppBlueprint | null> {
  const version = await getCacheVersion(env, latestBlueprintVersionKey(projectId));
  const boxed = await getOrSetCached(env, `${latestBlueprintVersionKey(projectId)}:v:${version}`, async () => {
    const db = buildDatabase(env);
    const row = await db
      .select()
      .from(projectAppBlueprints)
      .where(eq(projectAppBlueprints.projectId, projectId))
      .orderBy(desc(projectAppBlueprints.detectedAt))
      .limit(1);
    return { blueprint: (row[0]?.blueprint ?? null) as unknown as AppBlueprint | null };
  }, { kvTtlSeconds: 60 * 60 });
  return boxed.blueprint;
}

/**
 * Store a blueprint in the database, and bump the cached latest read's version so the
 * next one sees it (`env` absent = no cache: unit tests, non-Worker callers).
 */
export async function storeBlueprint(
  db: Db,
  projectId: number,
  commitSha: string,
  blueprint: AppBlueprint,
  env?: Env,
): Promise<void> {
  await storeBlueprintRow(db, projectId, commitSha, blueprint);
  await bumpCacheVersion(env, latestBlueprintVersionKey(projectId));
}

async function storeBlueprintRow(db: Db, projectId: number, commitSha: string, blueprint: AppBlueprint): Promise<void> {
  await db
    .insert(projectAppBlueprints)
    .values({
      projectId,
      commitSha,
      blueprint,
      detectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [projectAppBlueprints.projectId, projectAppBlueprints.commitSha],
      set: {
        blueprint,
        detectedAt: new Date(),
      },
    });
}
