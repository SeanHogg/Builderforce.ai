/**
 * Task key allocation for the DIRECT-INSERT paths.
 *
 * Most task creation goes through TaskService (which allocates keys via the
 * domain entity + TaskRepository.maxKeySeqByProject). A few subsystems insert
 * into `tasks` directly because they need to set columns the domain entity does
 * not carry — notably `source`, the provenance/behaviour marker that decides
 * whether autonomy may touch a ticket at all. Those paths still need the same
 * gap-safe, collision-retrying key sequence, so it lives here once instead of
 * being re-derived (this regex was duplicated in ManagerService).
 */

import { eq, sql } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/** How many sequence numbers a direct insert walks forward on a key collision. */
export const KEY_COLLISION_ATTEMPTS = 3;

/** Next gap-safe key sequence base for a project (mirrors TaskRepository.maxKeySeqByProject). */
export async function nextProjectKeySeqBase(db: Db, projectId: number): Promise<number> {
  const [seqRow] = await db
    .select({
      value: sql<number>`COALESCE(MAX(CASE WHEN regexp_replace(${tasks.key}, '^.*-', '') ~ '^[0-9]+$'
        THEN CAST(regexp_replace(${tasks.key}, '^.*-', '') AS INTEGER) END), 0)`,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
  return Number(seqRow?.value ?? 0) + 1;
}

/** Format a task key for a project (`PROJ-007`) at a given sequence number. */
export function formatTaskKey(projectKey: string, seq: number): string {
  return `${projectKey}-${String(seq).padStart(3, '0')}`;
}

/**
 * Run `insert` with successive candidate keys until one lands, walking the
 * sequence forward on a unique-key collision (a concurrent create took it).
 * Returns null when every attempt collided.
 */
export async function withDirectTaskKey<T>(
  db: Db,
  projectId: number,
  projectKey: string,
  insert: (key: string) => Promise<T>,
): Promise<T | null> {
  const baseSeq = await nextProjectKeySeqBase(db, projectId);
  for (let attempt = 0; attempt < KEY_COLLISION_ATTEMPTS; attempt++) {
    try {
      return await insert(formatTaskKey(projectKey, baseSeq + attempt));
    } catch {
      /* likely a unique-key collision — try the next sequence number */
    }
  }
  return null;
}
