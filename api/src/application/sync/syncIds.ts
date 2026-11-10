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
 *   `COALESCE(parseSyncId(server_id), sync_id)`. `server_id` is still written on EVERY mapping, and
 *   the old Worker (between the migration and the deploy, or after a rollback) rewrites it without
 *   touching `sync_id` — a revived chat-ticket link gets a new link row id — so `sync_id` can be
 *   stale while `server_id` cannot. A step's row keeps its key in `server_id` only. Flip the order
 *   to `sync_id` first at the contract push that stops writing `server_id`.
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

/** The integer key of the server row a mapping names (the parsed `server_id`, else `sync_id`). */
export function mappedServerKey(row: Pick<SyncEntityMappingRow, 'serverId' | 'syncId'>): number | null {
  return parseSyncId(row.serverId) ?? row.syncId ?? null;
}
