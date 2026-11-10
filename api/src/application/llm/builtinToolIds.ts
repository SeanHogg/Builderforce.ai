/**
 * Application — the built-in tools' ONE id shape (docs/design/typed-entity-ids.md §5).
 *
 * - {@link idArg} reads an id ARGUMENT (taskId, id, parentTaskId, chatId, projectId…) through
 *   THE server-id parse, `parseSyncId`. A non-id fails with a message the model can act on,
 *   instead of `Number()` turning a client UUID or a "kind:ref" into NaN and the tool failing
 *   somewhere downstream. Counts and amounts (`limit`, `offset`, `position`, costs) are not ids
 *   and keep the service's plain `num()`.
 * - {@link withTicketSyncIds} adds `syncId` to chat-ticket rows whose ref is a `tasks.id`
 *   (task / epic / gap), so a caller reads one field rather than guessing from `ref`'s shape.
 */

import { TASK_TABLE_KINDS, parseSyncId } from '../../domain/sync/syncProtocol';

/** How much of a rejected argument the error repeats. */
const ECHO_MAX = 60;

/** An id argument as a SyncId (a positive safe integer, or its decimal text); throws otherwise. */
export function idArg(v: unknown, name: string): number {
  const id = parseSyncId(v);
  if (id !== null) return id;
  const echoed = (typeof v === 'string' ? JSON.stringify(v) : String(v)).slice(0, ECHO_MAX);
  throw new Error(`${name} must be a server id (a positive whole number), got ${echoed}. A local id (UUID) is not synced yet — use the local ticket tools, or wait for sync.`);
}

/** `{ syncId }` for a result that returns a server entity, or `{}` when its id is not one. */
export function syncIdField(id: unknown): { syncId?: number } {
  const syncId = parseSyncId(id);
  return syncId === null ? {} : { syncId };
}

/** Each row, plus `syncId` when its ref is a task-table id. Other fields are kept as they are. */
export function withTicketSyncIds<T extends { kind: string; ref: string }>(rows: readonly T[]): Array<T & { syncId?: number }> {
  return rows.map((row) => {
    const syncId = TASK_TABLE_KINDS.has(row.kind) ? parseSyncId(row.ref) : null;
    return syncId === null ? row : { ...row, syncId };
  });
}
