/**
 * Renaming a board column — the other half of the lane/ticket relationship.
 *
 * A swimlane has two names: the `name` a person reads, and the `key` that IS the
 * status every resident ticket holds. Editing the first has always been safe and
 * has always been offered. Editing the second was neither: changing the key would
 * have left every ticket in the lane holding a status no lane defined, and there
 * was no way to even enumerate those tickets except by the very string being
 * changed. So a board whose custom column was called `qa_pass` when it should have
 * been `qa` could be created and never corrected.
 *
 * `tasks.swimlane_id` (migration 1115) is what makes the rename expressible: the
 * lane's residents are a REFERENCE, so they can be found and moved with the key
 * rather than despite it.
 *
 * A lane key is not only carried by its tickets. Three other live rows point at a
 * lane BY KEY, and a rename that misses any of them silently breaks the thing it
 * configures — so the cascade is the operation, not a follow-up to it:
 *   • `swimlanes.action_target` — a sibling lane's "move ticket to <key>" action,
 *   • `boards.needs_attention_lane` — where a paused/failed run is parked,
 *   • `qa_routing_settings.target_lane_key` — where QA findings are routed.
 *
 * `task_status_transitions` and `ticket_role_signoffs` deliberately are NOT
 * rewritten: they are append-only ledgers of what happened under the name the lane
 * had at the time, and history that edits itself is not history.
 */
import { and, eq, or, sql } from 'drizzle-orm';
import {
  boards,
  qaRoutingSettings,
  swimlanes,
  tasks,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';

/** Max length of `swimlanes.key` (varchar(120)) — the ceiling `tasks.status` shares. */
export const LANE_KEY_MAX_LENGTH = 64;

/**
 * Normalise operator input into a lane key: lowercase, non-alphanumerics folded to
 * single underscores, edges trimmed.
 *
 * The SAME derivation the lane editor applies when it mints a key from a new
 * column's name, so a key typed by hand and a key derived from a name can never
 * disagree about what is legal. Capped at `tasks.status`'s varchar(64) rather than
 * `swimlanes.key`'s varchar(120): a key longer than the column that has to CARRY it
 * would rename the lane and then fail on the first ticket. Returns null when
 * nothing survives normalisation.
 */
export function normalizeLaneKey(raw: string): string | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, LANE_KEY_MAX_LENGTH)
    .replace(/_+$/g, '');
  return key.length > 0 ? key : null;
}

export type LaneKeyChange =
  | { ok: true; key: string; changed: boolean }
  | { ok: false; error: 'invalid_key' | 'duplicate_key' };

/**
 * Decide whether a requested key change is legal, without touching the database.
 *
 * `siblingKeys` is every OTHER lane's key on the board — the UNIQUE(board_id, key)
 * constraint restated where it can produce a 400 instead of a 500. A no-op rename
 * (same key) is legal and reports `changed: false`, so a client that PATCHes the
 * whole lane on every edit does not pay for a cascade it did not ask for.
 */
export function validateLaneKeyChange(args: {
  requested: string;
  currentKey: string;
  siblingKeys: string[];
}): LaneKeyChange {
  const key = normalizeLaneKey(args.requested);
  if (!key) return { ok: false, error: 'invalid_key' };
  if (key === args.currentKey) return { ok: true, key, changed: false };
  if (args.siblingKeys.includes(key)) return { ok: false, error: 'duplicate_key' };
  return { ok: true, key, changed: true };
}

export interface LaneRenameResult {
  /** The key the lane now carries. */
  key: string;
  /** Tickets whose status was moved onto the new key. */
  movedTasks: number;
  /** Sibling lanes whose `move ticket to …` action was re-pointed. */
  movedLaneActions: number;
  /** True when the board's needs-attention lane pointed at the old key. */
  movedNeedsAttention: boolean;
  /** True when the project's QA routing target pointed at the old key. */
  movedQaRouting: boolean;
}

/**
 * Rename a lane's key and carry everything that pointed at it.
 *
 * ORDER MATTERS. The tickets move FIRST, while the lane still holds the old key:
 * `trg_swimlanes_relink_tasks` fires on the lane's key UPDATE and re-points every
 * ticket carrying the new key at this lane, so the ticket rows land back on the
 * lane in the same statement that renames it. Renaming the lane first would make
 * its residents momentarily homeless and rely on a second write to rescue them.
 *
 * The caller is responsible for having validated the key
 * ({@link validateLaneKeyChange}) — this performs the change it is given.
 */
export async function renameLaneKey(
  db: Db,
  args: { tenantId: number; boardId: string; laneId: string; oldKey: string; newKey: string },
): Promise<LaneRenameResult> {
  const { tenantId, boardId, laneId, oldKey, newKey } = args;
  const idle: LaneRenameResult = {
    key: oldKey, movedTasks: 0, movedLaneActions: 0, movedNeedsAttention: false, movedQaRouting: false,
  };

  const [board] = await db
    .select({ projectId: boards.projectId, needsAttentionLane: boards.needsAttentionLane })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
  if (!board) return idle;

  // The lane's residents by REFERENCE, plus anything still holding the old key that
  // the FK never linked (a ticket created before the board had this lane). Both, so
  // the rename is complete on a board whose data predates migration 1115.
  const moved = await db
    .update(tasks)
    .set({ status: newKey, updatedAt: new Date() })
    .where(scopedToTenant(
      tasks,
      tenantId,
      eq(tasks.projectId, board.projectId),
      or(eq(tasks.swimlaneId, laneId), eq(tasks.status, oldKey)),
    ))
    .returning({ id: tasks.id });

  await db
    .update(swimlanes)
    .set({ key: newKey, updatedAt: new Date() })
    .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));

  // Sibling lanes whose end-of-stage action moves a ticket INTO this one.
  const actions = await db
    .update(swimlanes)
    .set({ actionTarget: newKey, updatedAt: new Date() })
    .where(scopedToTenant(
      swimlanes,
      tenantId,
      eq(swimlanes.boardId, boardId),
      eq(swimlanes.actionType, 'move_ticket'),
      eq(swimlanes.actionTarget, oldKey),
    ))
    .returning({ id: swimlanes.id });

  let movedNeedsAttention = false;
  if (board.needsAttentionLane === oldKey) {
    await db
      .update(boards)
      .set({ needsAttentionLane: newKey, updatedAt: new Date() })
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    movedNeedsAttention = true;
  }

  const qa = await db
    .update(qaRoutingSettings)
    .set({ targetLaneKey: newKey, updatedAt: new Date() })
    .where(scopedToTenant(
      qaRoutingSettings,
      tenantId,
      eq(qaRoutingSettings.projectId, board.projectId),
      eq(qaRoutingSettings.targetLaneKey, oldKey),
    ))
    .returning({ id: qaRoutingSettings.id });

  return {
    key: newKey,
    movedTasks: moved.length,
    movedLaneActions: actions.length,
    movedNeedsAttention,
    movedQaRouting: qa.length > 0,
  };
}
