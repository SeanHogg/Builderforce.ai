/**
 * BOARD CONFLICTS — what a person sees when two writers touched the SAME object, and how they settle it.
 *
 * The server's rule (`conflictPolicy`): a writer whose `baseVersion` is behind gets a `conflict`
 * receipt; the event is HELD (not lost, not retried blindly). Nothing is dropped and nothing is
 * decided by timestamp. This module turns each held canvas event into a `SyncConflict` record that
 * keeps BOTH payloads — the local record stays rendered; the server's value is retrievable — and
 * gives the three settlements the side panel offers:
 *
 *   - `mine`          keep this device's value: the held event is replaced by one based on the server's version;
 *   - `theirs`        take the server's value locally (no event: it is the server's word);
 *   - `restore-copy`  for edit-vs-delete (delete wins, policy rule 1): the edit is kept as a NEW object, since
 *                     a tombstoned id can never be revived.
 *
 * Two edits to DIFFERENT objects never reach here: per-object records exist so they simply merge.
 * The remote value comes from the reconcile source's fresh snapshot (`captureBoardConflicts`).
 */

import {
  CANVAS_ENTITY_TYPES,
  type JournalEvent,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
  type SyncConflict,
} from '@builderforce/local-first';
import { appendRecordEvent, writeRecord, type JournalContext } from './boardJournal';
import {
  CANVAS_BOARD,
  CANVAS_EDGE,
  CANVAS_OBJECT,
  edgePayloadOf,
  objectPayloadOf,
  syncedBoardPayload,
  type BoardPayload,
  type EdgePayload,
  type ObjectPayload,
  type ServerBoardSnapshot,
} from './boardRecords';

export type ConflictChoice = 'mine' | 'theirs' | 'restore-copy';

const SERVER_OBSERVED = { deviceId: 'server', source: 'imported', evidence: 'server-observed' } as const;
const canvasTypes: ReadonlySet<string> = new Set(CANVAS_ENTITY_TYPES);

const conflictIdOf = (event: Pick<JournalEvent, 'eventId'>): string => `canvas:${event.eventId}`;

const isHeldConflict = (event: Readonly<JournalEvent>): boolean =>
  !event.deadLetter && event.holdKind === 'conflict' && canvasTypes.has(event.entityType);

/** The record the server holds for an entity, rebuilt from its snapshot; a tombstone when the snapshot omits it. */
function remoteRecordOf(snapshot: ServerBoardSnapshot, local: LocalRecord, at: string): LocalRecord {
  const version = snapshot.versions?.[local.id] ?? snapshot.revision;
  const base = { id: local.id, entityType: local.entityType, schemaVersion: local.schemaVersion, version, destination: local.destination, occurredAt: at, updatedAt: at, provenance: { ...SERVER_OBSERVED } };
  if (local.entityType === CANVAS_OBJECT) {
    const object = snapshot.graph.objects.find((row) => row.id === local.id);
    return object
      ? { ...base, payload: objectPayloadOf(snapshot.id, { ...object, canvasData: object.canvasData ?? {}, content: object.content ?? {} }) }
      : { ...base, payload: local.payload, deletedAt: at };
  }
  if (local.entityType === CANVAS_EDGE) {
    const connection = snapshot.graph.connections.find((row) => row.id === local.id);
    return connection
      ? { ...base, payload: edgePayloadOf(snapshot.id, { ...connection, metadata: connection.metadata ?? {} }) }
      : { ...base, payload: local.payload, deletedAt: at };
  }
  return { ...base, payload: { title: snapshot.title } };
}

/**
 * Record a `SyncConflict` for every held-in-conflict canvas event of this board that has none yet,
 * with the server's value from `remote` beside the local one. Returns how many were recorded.
 */
export async function captureBoardConflicts(
  store: LocalFirstStore,
  remote: ServerBoardSnapshot,
  options: { now?: () => Date } = {},
): Promise<number> {
  const at = (options.now?.() ?? new Date()).toISOString();
  return store.transact(async (tx) => {
    const known = new Set((await tx.conflicts()).map((conflict) => conflict.id));
    const held: JournalEvent[] = [];
    await tx.scanPending((event) => { if (isHeldConflict(event)) held.push(event as JournalEvent); });
    let recorded = 0;
    for (const event of held) {
      const id = conflictIdOf(event);
      if (known.has(id)) continue;
      const local = await tx.get(event.entityType, event.clientEntityId);
      if (!local) continue;
      const owner = event.entityType === CANVAS_BOARD ? event.clientEntityId : (event.payload as { boardId?: string } | null)?.boardId;
      if (owner !== remote.id) continue;
      const theirs = remoteRecordOf(remote, local, at);
      await tx.putConflict({
        id,
        clientEntityId: local.id,
        entityType: local.entityType,
        local,
        remote: theirs,
        reason: theirs.deletedAt ? 'edit_vs_remote_delete' : 'same_object_edited',
        createdAt: at,
      });
      recorded += 1;
    }
    return recorded;
  });
}

const TAB_REASON = 'concurrent_tab_edit';

/**
 * Two tabs of one browser edited the SAME object. The store serialises their commits, so the second
 * tab would silently overwrite the first; instead its proposed value is kept beside the stored one
 * as a conflict (`local` = this tab's proposal, `remote` = what the other tab committed) and the
 * stored value stays. Same side panel, same three settlements, as a conflict with the server.
 */
export async function recordTabConflict(
  tx: LocalFirstTransaction,
  ctx: JournalContext,
  existing: LocalRecord,
  proposed: unknown,
): Promise<void> {
  const at = (ctx.now?.() ?? new Date()).toISOString();
  await tx.putConflict({
    id: `tab:${existing.entityType}:${existing.id}:${existing.version}`,
    clientEntityId: existing.id,
    entityType: existing.entityType,
    local: { ...existing, version: existing.version + 1, baseVersion: existing.version, updatedAt: at, payload: proposed },
    remote: existing,
    reason: TAB_REASON,
    createdAt: at,
  });
}

/** The unresolved conflicts of a board, oldest first — what the notice and its side panel list. */
export async function listBoardConflicts(store: LocalFirstStore, boardId: string): Promise<SyncConflict[]> {
  const all = await store.read((tx) => tx.conflicts());
  return all
    .filter((conflict) => !conflict.resolvedAt && canvasTypes.has(conflict.entityType))
    .filter((conflict) => {
      const payload = conflict.local.payload as { boardId?: string } | undefined;
      return conflict.entityType === CANVAS_BOARD ? conflict.clientEntityId === boardId : payload?.boardId === boardId;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface ConflictResolveContext extends JournalContext {
  store: LocalFirstStore;
  newId?: () => string;
}

/** Settle one conflict. Throws when the conflict is unknown or already settled. */
export async function resolveBoardConflict(ctx: ConflictResolveContext, conflictId: string, choice: ConflictChoice): Promise<void> {
  const stamp = (ctx.now?.() ?? new Date()).toISOString();
  await ctx.store.transact(async (tx) => {
    const conflict = (await tx.conflicts()).find((row) => row.id === conflictId);
    if (!conflict || conflict.resolvedAt) throw new Error(`conflict_not_open: ${conflictId}`);
    const { local, remote } = conflict;
    const current = await tx.get(local.entityType, local.id);
    if (!current) throw new Error(`conflict_record_missing: ${conflictId}`);
    if (conflict.reason === TAB_REASON) {
      // The other tab's value is already the stored one; "mine" re-applies this tab's proposal as a normal edit.
      if (choice === 'mine') {
        await writeRecord(tx, ctx, current, {
          entityType: current.entityType,
          id: current.id,
          payload: local.payload,
          destination: current.destination,
          ...(current.entityType === CANVAS_BOARD ? { syncPayload: syncedBoardPayload(local.payload as BoardPayload) } : { boardId: (local.payload as { boardId: string }).boardId }),
        });
      } else if (choice === 'restore-copy') {
        throw new Error(`conflict_choice_unsupported: ${choice}`);
      }
      await tx.putConflict({ ...conflict, resolvedAt: stamp });
      return;
    }
    const heldEvents: JournalEvent[] = [];
    await tx.scanPending((event) => {
      if (!event.deadLetter && event.clientEntityId === local.id && event.entityType === local.entityType) heldEvents.push(event as JournalEvent);
    });
    await tx.acknowledge(heldEvents.map((event) => event.eventId));
    const remoteDeleted = Boolean(remote.deletedAt);

    if (choice === 'theirs') {
      await tx.put({ ...current, version: current.version + 1, baseVersion: current.version, updatedAt: stamp, payload: remote.payload, ...(remoteDeleted ? { deletedAt: stamp } : { deletedAt: undefined }), provenance: { ...SERVER_OBSERVED } }, current.version);
      await tx.putMapping({ destination: current.destination, entityType: current.entityType, clientEntityId: current.id, serverId: current.id, serverVersion: remote.version });
    } else if (choice === 'mine' && !remoteDeleted) {
      // The server's version is the new base, so the re-sent write is the NEXT one, not a second conflict.
      await tx.putMapping({ destination: current.destination, entityType: current.entityType, clientEntityId: current.id, serverId: current.id, serverVersion: remote.version });
      const rewritten: LocalRecord = { ...current, version: current.version + 1, baseVersion: current.version, updatedAt: stamp };
      await tx.put(rewritten, current.version);
      await appendRecordEvent(
        tx,
        rewritten,
        current.entityType === CANVAS_BOARD
          ? { syncPayload: syncedBoardPayload(current.payload as BoardPayload) }
          : { boardId: (current.payload as { boardId: string }).boardId },
      );
    } else {
      // restore-copy (and `mine` against a delete, which can only mean this): the edit lives on under a new id.
      const copyId = (ctx.newId ?? (() => crypto.randomUUID()))();
      const boardId = (current.payload as { boardId: string }).boardId;
      await tx.put({ ...current, version: current.version + 1, baseVersion: current.version, updatedAt: stamp, deletedAt: stamp, provenance: { ...SERVER_OBSERVED } }, current.version);
      await writeRecord<ObjectPayload | EdgePayload>(tx, ctx, undefined, {
        entityType: current.entityType,
        id: copyId,
        payload: current.payload as ObjectPayload | EdgePayload,
        destination: current.destination,
        boardId,
      });
    }
    await tx.putConflict({ ...conflict, resolvedAt: stamp });
  });
}
