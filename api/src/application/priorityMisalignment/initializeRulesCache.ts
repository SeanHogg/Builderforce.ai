import type { Db } from '@neondatabase/serverless';
import { seedDefaultMisalignmentRules } from './defaultMisalignmentRules';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';

/**
 * PriorityMisalignment initialization cache.
 * - db: seeded client reference, used only for seeding rules.
 * - refresher: invoked after migrations to warm caches.
 * - tasksCache: in-memory cache of task parent IDs and priority for efficient checks.
 */
const CACHE = {
  db: null as Db | null,
  refresher: null as ((db: Db) => Promise<void>) | null,
  tasksCache: new Map<string, { parentId?: number | string | undefined; priority?: string }>(),
} as const;

/**
 * Seeds the priority misalignment rules and refreshes the parent ID cache.
 *
 * Use this after initializing the DB connection to ensure the rules are
 * present and the cache is populated.
 *
 * @param db - An open Neon DB instance.
 */
export async function initializePriorityMisalignment(db: Db): Promise<void> {
  CACHE.db = db;
  CACHE.refresher = refreshParentCache;

  // 1. Ensure default rules exist (idempotent)
  await seedDefaultMisalignmentRules(db); // Uses seeded client

  // 2. Warm caches if TaskRepository is available
  if (TaskRepository) {
    try {
      const repo = new TaskRepository(db);
      await refreshParentCache(db, repo);
    } catch (e) {
      console.warn('[init:misalignment] Failed to warm caches:', e);
    }
  }
}

/**
 * Refreshes parent ID and priority cache by loading tasks and their parents.
 * This is called after migrations and on worker restart to keep checks fast.
 *
 * @param db - An open Neon DB instance.
 * @param taskRepo - Optional TaskRepository; if omitted a new instance is created.
 */
export async function refreshParentCache(db: Db, taskRepo?: TaskRepository): Promise<void> {
  const repo = taskRepo ?? new TaskRepository(db);
  const allTasks = await repo.getAllTasks();
  CACHE.tasksCache.clear();
  for (const t of allTasks) {
    CACHE.tasksCache.set(String(t.id), {
      parentId: t.parentId,
      priority: t.priority,
    });
  }
}

/**
 * Gets the parent ID from cache or throws if unavailable.
 * Used during checks and UI hint generation.
 */
export function getParentFromCache(taskId: string | number): number | null | undefined {
  return CACHE.tasksCache.get(String(taskId))?.parentId ?? null;
}

/**
 * Gets the priority from cache or throws if unavailable.
 * Used during checks and UI hint generation.
 */
export function getPriorityFromCache(taskId: string | number): string | undefined {
  return CACHE.tasksCache.get(String(taskId))?.priority;
}

/**
 * Clears task cache (useful for long-running workers during heavy ingest).
 */
export function clearTaskCache(): void {
  CACHE.tasksCache.clear();
}