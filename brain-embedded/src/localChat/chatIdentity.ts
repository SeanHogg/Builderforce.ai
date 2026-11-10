/**
 * CHAT IDENTITY (PRD 36 §3.1) — which SERVER chat a local chat is, and the one way it
 * comes to be one.
 *
 * A local chat's `id` is a view key that never leaves the machine. It reaches the
 * platform only through a BINDING: the local store's mapping
 * `('chat', clientId, destination) → serverChatId`, written either here (bind on the
 * first run while signed in — `POST /api/brain/chats` with the title and project, never
 * the transcript) or by a sync receipt (`journal.ts`). The mapping is the one fact; a
 * chat row never stores a server id (persistence projects it as `BrainChat.serverId`).
 *
 * The destination is the ACCOUNT the chat binds into (platform + workspace), read live
 * from the host, so a chat bound in workspace A is not named in workspace B.
 */

import { BOUND_ONLY_VERSION, SCAN_STOP, parseSyncId, queueImport, syncIdText, type EntityDestination, type LocalFirstStore, type LocalFirstTransaction } from '@builderforce/local-first';
import { chatRecordById, liveRecords, scanLive, type ChatValue } from './records';
import type { ViewKey } from '../types';

/** What a host supplies so a local chat can be bound. */
export interface ChatBindingPort {
  /** The account destination chats bind into now; undefined when signed out. */
  destination(): EntityDestination | undefined;
  /** Whether the platform policy allows a bind right now. */
  allowed(): boolean;
  /** Create the server chat — title and project only. Null when it could not be made. */
  createServerChat(input: { title: string; projectId: number | null }): Promise<number | null>;
}

export interface LocalChatIdentity {
  /** The bound server chat of a local chat, in the current account; undefined when unbound. */
  serverIdFor(localId: ViewKey): Promise<number | undefined>;
  /** The local chat's stable client id, or undefined when the store does not hold it. */
  clientIdFor(localId: ViewKey): Promise<string | undefined>;
  /** The local chat bound to a server chat in the current account, or undefined. */
  localIdFor(serverId: number): Promise<ViewKey | undefined>;
  /**
   * Bind a local chat when signed in and allowed: an existing binding wins, else the
   * server chat is created and mapped. Concurrent calls for one chat share one request.
   * Undefined when the chat stays unbound.
   */
  bind(localId: ViewKey): Promise<number | undefined>;
  /**
   * Record that a local chat IS an existing server chat (the host created it first).
   * False when it could not be: signed out, or the local chat is gone.
   */
  adopt(localId: ViewKey, serverId: number): Promise<boolean>;
}

/** The server chat a chat's mapping names in `destination`, read inside a transaction. */
export async function boundServerId(tx: LocalFirstTransaction, clientId: string, destination: EntityDestination | undefined): Promise<number | undefined> {
  if (!destination || destination.kind !== 'bound') return undefined;
  const mapping = await tx.mapping('chat', clientId, destination);
  // Brands do not survive the store: the row is re-read (`syncId`, else the legacy `serverId` text).
  return (mapping ? parseSyncId(mapping.syncId ?? mapping.serverId) : null) ?? undefined;
}

export function createLocalChatIdentity(options: { store: LocalFirstStore; deviceId: string; port: ChatBindingPort }): LocalChatIdentity {
  const { store, deviceId, port } = options;
  const inFlight = new Map<number, Promise<number | undefined>>();

  const read = (localId: number) => store.read(async (tx) => {
    const chat = await chatRecordById(tx, deviceId, localId);
    return chat ? { chat, serverId: await boundServerId(tx, chat.id, port.destination()) } : undefined;
  });

  const map = async (clientId: string, destination: EntityDestination, serverId: number): Promise<void> => {
    const syncId = parseSyncId(serverId);
    if (syncId == null) return; // not a server chat id — nothing to bind to
    await store.transact(async (tx) => {
      // An existing binding wins — a sync receipt may have mapped it meanwhile.
      if (await tx.mapping('chat', clientId, destination)) return;
      // Both fields for one release: older windows sharing the journal read `serverId` text.
      await tx.putMapping({ destination, entityType: 'chat', clientEntityId: clientId, syncId, serverId: syncIdText(syncId), serverVersion: BOUND_ONLY_VERSION });
      // A sync pass may have queued the chat's import before this binding existed: re-queue
      // it so it names the server chat (and the server adopts it, not mints a second one).
      let queued = false;
      await tx.scanPending((event) => {
        if (event.entityType === 'chat' && event.clientEntityId === clientId && event.operation === 'import') { queued = true; return SCAN_STOP; }
      });
      const record = queued ? (await liveRecords<ChatValue>(tx, 'chat', deviceId, (row) => row.id === clientId))[0] : undefined;
      if (record) await queueImport(tx, record);
    });
  };

  const bindOnce = async (localId: number): Promise<number | undefined> => {
    const found = await read(localId);
    if (!found) return undefined;
    if (found.serverId !== undefined) return found.serverId;
    const destination = port.destination();
    if (!destination || destination.kind !== 'bound' || !port.allowed()) return undefined;
    const { chat } = found.chat.payload;
    const serverId = await port.createServerChat({ title: chat.title, projectId: chat.projectId ?? null });
    if (serverId == null) return undefined;
    await map(found.chat.id, destination, serverId);
    return (await read(localId))?.serverId;
  };

  return {
    serverIdFor: async (localId) => (await read(localId))?.serverId,
    clientIdFor: async (localId) => (await read(localId))?.chat.id,
    localIdFor: (serverId) => store.read(async (tx) => {
      const destination = port.destination();
      // Just each chat's two ids — a scan, not a copy of every chat row.
      const chats: Array<{ clientId: string; localId: number }> = [];
      await scanLive<ChatValue>(tx, 'chat', deviceId, (row) => { chats.push({ clientId: row.id, localId: row.payload.chat.id }); });
      for (const chat of chats) {
        if ((await boundServerId(tx, chat.clientId, destination)) === serverId) return chat.localId;
      }
      return undefined;
    }),
    bind(localId) {
      const running = inFlight.get(localId);
      if (running) return running;
      const next = bindOnce(localId).finally(() => inFlight.delete(localId));
      inFlight.set(localId, next);
      return next;
    },
    async adopt(localId, serverId) {
      const destination = port.destination();
      const found = await read(localId);
      if (!found || !destination || destination.kind !== 'bound') return false;
      await map(found.chat.id, destination, serverId);
      return true;
    },
  };
}
