/**
 * Application — the server's two sync-id rules (docs/design/typed-entity-ids.md §4, Phase B).
 *
 * `sync_entity_mappings` holds `server_id` text (every mapping, kept for older devices) and,
 * since migration 1339, `sync_id` bigint: the server row's integer key, NULL when the entity has
 * none (mirror and usage records, tier tickets, run steps).
 *
 * - {@link syncIdOf} is what the server WRITES to `sync_id` and SENDS as a receipt's / a pulled
 *   record's `syncId`. A Brain run step is stored as a `message` but its id is a
 *   `brain_chat_steps` id, not a message id, so it is never handed out as a message SyncId.
 * - {@link mappedServerKey} is how the importers READ a mapping's integer key:
 *   `COALESCE(sync_id, parseSyncId(server_id))`, because a row the old Worker wrote between the
 *   migration and the deploy has a NULL `sync_id`, and a step's row keeps its key in `server_id`.
 *
 * Both parse through THE one primitive, `parseSyncId` (`@builderforce/local-first` entityId.ts).
 */

import { parseSyncId, type SyncId } from '../../domain/sync/syncProtocol';
import { isStepId } from '../brain/chatStepStore';
import type { SyncEntityMappingRow } from './syncPorts';

/** The SyncId an imported entity's server id is, or null when it has no integer key. */
export function syncIdOf(entityType: string | null | undefined, serverId: string | null | undefined): SyncId | null {
  const id = parseSyncId(serverId);
  if (id === null) return null;
  return entityType === 'message' && isStepId(id) ? null : id;
}

/** The integer key of the server row a mapping names (`sync_id`, else the parsed `server_id`). */
export function mappedServerKey(row: Pick<SyncEntityMappingRow, 'serverId' | 'syncId'>): number | null {
  return row.syncId ?? parseSyncId(row.serverId);
}
