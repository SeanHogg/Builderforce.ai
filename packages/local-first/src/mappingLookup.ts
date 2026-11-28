/**
 * The reverse lookups over a transaction's mappings (`mappingByServerId`, `mappingByExternalRef`):
 * the EARLIEST row (`compareMappingAge`) of an entity type, inside a scope, that matches a
 * server key. Pure over the mapping rows, so the transaction only supplies its own view of them.
 * The rows returned are the caller's own: the transaction clones what it hands out.
 */

import { earliestMapping, type EntityScope, type LocalEntityType, type ServerMapping } from './records.js';
import { parseEntityRef, parseSyncId, syncIdText, tierRefText } from './entityId.js';

/** `mappings` is a function: a lookup may walk the rows twice, and an iterator is spent after one walk. */
type MappingRows = () => Iterable<ServerMapping>;

export function findByServerId(
  mappings: MappingRows,
  entityType: LocalEntityType,
  serverId: string | number,
  scope?: EntityScope,
): ServerMapping | undefined {
  const earliest = (match: (mapping: ServerMapping) => boolean): ServerMapping | undefined =>
    earliestMapping(mappings(), entityType, scope, match);
  const syncId = parseSyncId(serverId);
  if (syncId !== null) {
    // A row carrying the SyncId wins. Failing that, a row whose server said "not a SyncId of this
    // type" (`syncId: null`, a run step) but whose key text is this number: the same server row,
    // so an ingest of it must land on that row, not mint a second LocalId.
    const text = syncIdText(syncId);
    return earliest((mapping) => mapping.syncId === syncId)
      ?? earliest((mapping) => (mapping.syncId ?? null) === null && mapping.serverId === text);
  }
  if (typeof serverId !== 'string' || serverId.trim() === '') return undefined;
  const tier = parseEntityRef(serverId);
  const externalRef = tier && 'tier' in tier ? tierRefText(tier.tier) : undefined;
  return earliest((mapping) => mapping.serverId === serverId || (externalRef !== undefined && mapping.externalRef === externalRef));
}

export function findByExternalRef(
  mappings: MappingRows,
  entityType: LocalEntityType,
  externalRef: string,
  scope?: EntityScope,
): ServerMapping | undefined {
  if (typeof externalRef !== 'string' || externalRef.trim() === '') return undefined;
  return earliestMapping(mappings(), entityType, scope, (mapping) => mapping.externalRef === externalRef);
}
