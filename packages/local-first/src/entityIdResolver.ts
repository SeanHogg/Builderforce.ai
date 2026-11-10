/**
 * THE entity id resolver (docs/design/typed-entity-ids.md §3): LocalId ↔ SyncId through the
 * store's mapping rows. Every caller that held its own lookup (a `/^\d+$/` test, `Number(ref)`,
 * a `serverId` read) asks this instead; it never invents a SyncId from an id's shape.
 *
 * `destination` is optional: omitted, the resolver looks in any destination (a tool-argument
 * caller has none to pass). For `syncIdOf` that means the destination the local record lives in.
 */

import { isLocalId, parseSyncId, tierRefText, type EntityRef, type LocalId, type SyncId } from './entityId.js';
import type { EntityDestination, LocalEntityType, ServerMapping } from './records.js';
import type { LocalFirstStore, LocalFirstTransaction } from './storeContract.js';

/** The entity types a mapping can exist for — every local entity type. */
export type SyncEntityType = LocalEntityType;

export interface EntityIdResolver {
  syncIdOf(type: SyncEntityType, local: LocalId, destination?: EntityDestination): Promise<SyncId | null>;
  localIdOf(type: SyncEntityType, sync: SyncId, destination?: EntityDestination): Promise<LocalId | null>;
  resolve(type: SyncEntityType, ref: EntityRef, destination?: EntityDestination): Promise<{ localId: LocalId | null; syncId: SyncId | null }>;
}

/** A mapping's SyncId, re-checked: a row read back has lost its brand. */
const syncIdOfMapping = (mapping: ServerMapping | undefined): SyncId | null => parseSyncId(mapping?.syncId);
/** A mapping's client id when it is a LocalId; any other client key is not one. */
const localIdOfMapping = (mapping: ServerMapping | undefined): LocalId | null =>
  isLocalId(mapping?.clientEntityId) ? mapping!.clientEntityId : null;

async function mappingOfLocal(
  tx: LocalFirstTransaction,
  type: SyncEntityType,
  local: LocalId,
  destination: EntityDestination | undefined,
): Promise<ServerMapping | undefined> {
  if (destination) return tx.mapping(type, local, destination);
  const record = await tx.get(type, local);
  return record ? tx.mapping(type, local, record.destination) : undefined;
}

export function entityIdResolver(store: LocalFirstStore): EntityIdResolver {
  const syncIdOf: EntityIdResolver['syncIdOf'] = (type, local, destination) =>
    isLocalId(local)
      ? store.read(async (tx) => syncIdOfMapping(await mappingOfLocal(tx, type, local, destination)))
      : Promise.resolve(null);

  const localIdOf: EntityIdResolver['localIdOf'] = (type, sync, destination) => {
    const id = parseSyncId(sync);
    return id === null
      ? Promise.resolve(null)
      : store.read(async (tx) => localIdOfMapping(await tx.mappingByServerId(type, id, destination)));
  };

  const resolve: EntityIdResolver['resolve'] = async (type, ref, destination) => {
    if ('local' in ref) {
      if (!isLocalId(ref.local)) return { localId: null, syncId: null };
      return { localId: ref.local, syncId: await syncIdOf(type, ref.local, destination) };
    }
    if ('sync' in ref) {
      const syncId = parseSyncId(ref.sync);
      return { localId: syncId === null ? null : await localIdOf(type, syncId, destination), syncId };
    }
    const mapping = await store.read((tx) => tx.mappingByExternalRef(type, tierRefText(ref.tier), destination));
    return { localId: localIdOfMapping(mapping), syncId: syncIdOfMapping(mapping) };
  };

  return { syncIdOf, localIdOf, resolve };
}
