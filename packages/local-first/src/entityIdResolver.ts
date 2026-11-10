/**
 * THE entity id resolver (docs/design/typed-entity-ids.md §3): LocalId ↔ SyncId through the
 * store's mapping rows. Every caller that held its own lookup (a `/^\d+$/` test, `Number(ref)`,
 * a `serverId` read) asks this instead; it never invents a SyncId from an id's shape.
 *
 * Where it looks is an `EntityScope` (records.ts):
 * - a destination — exactly that one;
 * - `{ tenantId, accountId? }` — that account's destinations plus unbound. A tool-argument caller
 *   (`resolveLocalReference`, `ticketClientId`) has no destination, but it MUST pass its tenant:
 *   SyncIds are per tenant, and the store cannot tell which account is active;
 * - omitted — every destination (legacy; can resolve another tenant's entity).
 * `syncIdOf` without an exact destination reads the mapping in the record's own destination, if
 * that destination is in scope.
 */

import { isLocalId, parseSyncId, tierRefText, type EntityRef, type LocalId, type SyncId } from './entityId.js';
import { inEntityScope, type EntityScope, type LocalEntityType, type ServerMapping } from './records.js';
import type { LocalFirstStore, LocalFirstTransaction } from './storeContract.js';

/** The entity types a mapping can exist for — every local entity type. */
export type SyncEntityType = LocalEntityType;

export interface EntityIdResolver {
  syncIdOf(type: SyncEntityType, local: LocalId, destination?: EntityScope): Promise<SyncId | null>;
  localIdOf(type: SyncEntityType, sync: SyncId, destination?: EntityScope): Promise<LocalId | null>;
  resolve(type: SyncEntityType, ref: EntityRef, destination?: EntityScope): Promise<{ localId: LocalId | null; syncId: SyncId | null }>;
}

/** A mapping's SyncId, re-checked: a row read back has lost its brand (undefined reads as null). */
const syncIdOfMapping = (mapping: ServerMapping | undefined): SyncId | null => parseSyncId(mapping?.syncId);
/** A mapping's client id when it is a LocalId; any other client key is not one. */
const localIdOfMapping = (mapping: ServerMapping | undefined): LocalId | null =>
  isLocalId(mapping?.clientEntityId) ? mapping!.clientEntityId : null;

async function mappingOfLocal(
  tx: LocalFirstTransaction,
  type: SyncEntityType,
  local: LocalId,
  scope: EntityScope | undefined,
): Promise<ServerMapping | undefined> {
  if (scope && 'kind' in scope) return tx.mapping(type, local, scope);
  const record = await tx.get(type, local);
  if (!record || !inEntityScope(record.destination, scope)) return undefined;
  return tx.mapping(type, local, record.destination);
}

/** Only `read` is used: a host may hand any reader of the store. */
export function entityIdResolver(store: Pick<LocalFirstStore, 'read'>): EntityIdResolver {
  const syncIdOf: EntityIdResolver['syncIdOf'] = (type, local, scope) =>
    isLocalId(local)
      ? store.read(async (tx) => syncIdOfMapping(await mappingOfLocal(tx, type, local, scope)))
      : Promise.resolve(null);

  const localIdOf: EntityIdResolver['localIdOf'] = (type, sync, scope) => {
    const id = parseSyncId(sync);
    return id === null
      ? Promise.resolve(null)
      : store.read(async (tx) => {
        const mapping = await tx.mappingByServerId(type, id, scope);
        // Only a row that CARRIES this SyncId: `mappingByServerId` also returns a `syncId: null` row
        // with the same key text (a run step), which is a different entity of the same type.
        return syncIdOfMapping(mapping) === id ? localIdOfMapping(mapping) : null;
      });
  };

  const resolve: EntityIdResolver['resolve'] = async (type, ref, scope) => {
    if ('local' in ref) {
      if (!isLocalId(ref.local)) return { localId: null, syncId: null };
      return { localId: ref.local, syncId: await syncIdOf(type, ref.local, scope) };
    }
    if ('sync' in ref) {
      const syncId = parseSyncId(ref.sync);
      return { localId: syncId === null ? null : await localIdOf(type, syncId, scope), syncId };
    }
    const mapping = await store.read((tx) => tx.mappingByExternalRef(type, tierRefText(ref.tier), scope));
    return { localId: localIdOfMapping(mapping), syncId: syncIdOfMapping(mapping) };
  };

  return { syncIdOf, localIdOf, resolve };
}
