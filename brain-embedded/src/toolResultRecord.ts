import { isLocalId, parseEntityRef, parseSyncId, type LocalId, type SyncId } from '@builderforce/local-first';

/**
 * A host tool's result as an object. The editor's local executors hand results back as JSON
 * TEXT, the account's relay as objects; every reader that needs a field off a result (an id,
 * `autoRun.dispatched`, an error) reads it through this one parse.
 */
export function toolResultRecord(result: unknown): Record<string, unknown> | null {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
}

/** The ids a tool result names for the entity it created or returned. */
export interface ResultEntityIds {
  readonly localId: LocalId | null;
  readonly syncId: SyncId | null;
}

/**
 * THE reader of an entity id off a tool result (docs/design/typed-entity-ids.md §5). Nothing
 * else reads `id` / `taskId` / `syncId` off a result.
 *
 * - `syncId`: the result's `syncId`, else `taskId` (`builtin_tickets_from_delta` answers
 *   `{ deltaId, taskId }` — reading only `id` minted 17 duplicates in chat #61651), else a
 *   numeric `id` (a number or its decimal text).
 * - `localId`: the result's `localId`, else a UUID `id`.
 *
 * Results may be JSON text or objects; an id never comes from a guess at a string's shape
 * beyond `parseSyncId` / `isLocalId`.
 */
export function entityIdsOf(result: unknown): ResultEntityIds {
  const record = toolResultRecord(result);
  if (!record) return { localId: null, syncId: null };
  const idRef = parseEntityRef(record.id);
  const syncId = parseSyncId(record.syncId)
    ?? parseSyncId(record.taskId)
    ?? (idRef && 'sync' in idRef ? idRef.sync : null);
  const localId = isLocalId(record.localId)
    ? record.localId
    : idRef && 'local' in idRef ? idRef.local : null;
  return { localId, syncId };
}
