/**
 * How the local domain tools (`localDomainTools.ts`) read an entity reference a tool call hands
 * them, and which ids a write's result reports — both through the ONE entity id primitive and
 * resolver in `@builderforce/local-first` (docs/design/typed-entity-ids.md §2–§3, §5). No regex,
 * no `Number()` guess: a SyncId is `parseSyncId`, a LocalId is `isLocalId`, and the mapping is
 * read by `entityIdResolver`.
 */

import {
  entityIdResolver,
  isIntegerIdText,
  isLocalId,
  parseSyncId,
  syncIdText,
  type EntityScope,
  type LocalFirstStore,
  type LocalId,
  type LocalRecord,
  type SyncId,
} from "@builderforce/local-first";

/**
 * The panel's selected project (and any ticket the model read from the platform) is surfaced as
 * a NUMERIC server id (see `activeProjectDirective`), but the local store keys records by
 * LocalId. A SyncId resolves to the live LocalId of its mirror when this device has one (its
 * mapping row). With no mirror the integer text passes through VERBATIM (trimmed): the repository
 * treats a decimal id as a server reference and the sync importer resolves it as the tenant's
 * own. Any other reference is returned as given — a UUID is validated by the repository.
 * `scope` is the active account (`activeEntityScope`): SyncIds are per tenant, so another
 * account's mirror of the same number is never picked.
 */
export async function resolveLocalReference(
  store: LocalFirstStore,
  entityType: "project" | "ticket",
  reference: string,
  scope?: EntityScope,
): Promise<string> {
  const raw = typeof reference === "string" ? reference.trim() : "";
  if (!isIntegerIdText(raw)) return reference;
  const sync = parseSyncId(raw);
  if (sync === null) return raw;
  const localId = await entityIdResolver(store).localIdOf(entityType, sync, scope);
  if (localId) {
    const target = await store.read((tx) => tx.get(entityType, localId));
    if (target && !target.deletedAt) return localId;
  }
  return raw;
}

/** An id that is still integer text after resolution names a record only the account holds. */
export const namesServerOnlyRecord = (id: string): boolean => isIntegerIdText(id.trim());

/** The ids a write's result reports: its LocalId, and its SyncId once a sync receipt mapped it. */
export interface WrittenEntityIds {
  localId?: LocalId;
  syncId?: SyncId;
  /** LEGACY: the SyncId as text, kept for one release beside `syncId`. */
  serverId?: string;
}

export async function writtenEntityIds(store: LocalFirstStore, record: LocalRecord | undefined): Promise<WrittenEntityIds> {
  if (!record || !isLocalId(record.id)) return {};
  const syncId = await entityIdResolver(store).syncIdOf(record.entityType, record.id, record.destination);
  return syncId === null
    ? { localId: record.id }
    : { localId: record.id, syncId, serverId: syncIdText(syncId) };
}
