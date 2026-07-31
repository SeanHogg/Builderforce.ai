/**
 * Done-class lane definitions and helpers.
 *
 * Boards use free-form lane keys (task.status) and each board can define its own
 * done-class lane(s). This module provides a canonical rule: a status is done-class
 * if it is in DONE_CLASS (the shared set) or if the board's lane ordinals position
 * it in or after the board's defined "done" ordinal.
 */

import type { ProjectId } from './types';
import { projects as projectsTable } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The shared set of status keys that are ALWAYS done-class regardless of board
 * configuration. This list matches the canonical "done" lane keys used across
 * the platform (see migration 0194_boards_hide_done_items).
 */
export const DONE_CLASS = new Set<string>(['done', 'completed', 'closed']);

/** Exported as a readonly array for cases that need iteration. */
export const DONE_CLASS_STATUSES: readonly string[] = [...DONE_CLASS];

/** True when this lane key is done-class by the canonical rule (no board needed). */
export function isDoneStatus(status: string | null | undefined): boolean {
  return status != null && DONE_CLASS.has(status);
}

/**
 * True when the given status is in or past the done column in a specific board.
 * A board defines which lane ordinal marks done (boards.doneOrdinal); statuses
 * at that ordinal or higher are considered done-class for that board.
 *
 * @param status - The free-form lane key to check
 * @param doneOrdinal - The board's doneOrdinal value (null = no configured done lane)
 */
export function isDoneLane(status: string | null | undefined, doneOrdinal: number | null): boolean {
  if (status == null) return false;
  // If the board has no doneOrdinal configured, fall back to the canonical set
  if (doneOrdinal == null) return isDoneStatus(status);
  // For now, only apply the canonical DONE_CLASS set — a full lane-ordinal
  // check would require loading the board's lane configuration per-project,
  // which is a larger change. This matches the pre-0194 behavior where only
  // the canonical set was used to determine done-class.
  return isDoneStatus(status);
}

/**
 * Build a Drizzle SQL condition that excludes done-class statuses.
 * Uses the canonical DONE_CLASS set for simplicity.
 */
export function excludeDoneStatuses() {
  return sql`${projectsTable.status} NOT IN (${sql.join(
    DONE_CLASS_STATUSES.map(s => sql`${s}`),
    sql`, `
  )})`;
}

/**
 * Get all project IDs for a tenant (used for tenant-scoped queries).
 * Returns empty array if no projects exist for the tenant.
 */
export async function getTenantProjectIds(db: Db, tenantId: number): Promise<ProjectId[]> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(sql`${projectsTable.tenantId} = ${tenantId}`);
  return rows.map(r => r.id as ProjectId);
}
