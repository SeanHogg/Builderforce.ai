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

import type { EntityDestination, LocalFirstStore, LocalFirstTransaction } from '@builderforce/local-first';
import { BOUND_ONLY_VERSION } from './journal';
import { chatRecordById } from './records';

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
  serverIdFor(localId: number): Promise<number | undefined>;
  /** The local chat's stable client id, or undefined when the store does not hold it. */
  clientIdFor(localId: number): Promise<string | undefined>;
  /**
   * Bind a local chat when signed in and allowed: an existing binding wins, else the
   * server chat is created and mapped. Concurrent calls for one chat share one request.
   * Undefined when the chat stays unbound.
   */
  bind(localId: number): Promise<number | undefined>;
  /** Record that a local chat IS an existing server chat (the host created it first). */
  adopt(localId: number, serverId: number): Promise<void>;
}

/** The server chat a chat's mapping names in `destination`, read inside a transaction. */
export async function boundServerId(tx: LocalFirstTransaction, clientId: string, destination: EntityDestination | undefined): Promise<number | undefined> {
  if (!destination || destination.kind !== 'bound') return undefined;
  const mapping = await tx.mapping('chat', clientId, destination);
  const id = mapping ? Number(mapping.serverId) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function createLocalChatIdentity(options: { store: LocalFirstStore; deviceId: string; port: ChatBindingPort }): LocalChatIdentity {
  const { store, deviceId, port } = options;
  const inFlight = new Map<number, Promise<number | undefined>>();

  const read = (localId: number) => store.read(async (tx) => {
    const chat = await chatRecordById(tx, deviceId, localId);
    return chat ? { chat, serverId: await boundServerId(tx, chat.id, port.destination()) } : undefined;
  });

  const map = async (clientId: string, destination: EntityDestination, serverId: number): Promise<void> => {
    await store.transact(async (tx) => {
      // An existing binding wins — a sync receipt may have mapped it meanwhile.
      if (await tx.mapping('chat', clientId, destination)) return;
      await tx.putMapping({ destination, entityType: 'chat', clientEntityId: clientId, serverId: String(serverId), serverVersion: BOUND_ONLY_VERSION });
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
      if (!found || !destination || destination.kind !== 'bound') return;
      await map(found.chat.id, destination, serverId);
    },
  };
}
