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
 *
 * The bind and the chat's sync import never both mint a server chat: the bind claims the
 * chat's bind lease before its POST (`chatBindLease.ts` in local-first), and an import that
 * already went up binds the chat through its receipt instead.
 */

import { BIND_PENDING_HOLDER, BOUND_ONLY_VERSION, SCAN_STOP, claimChatBind, liveChatBindHolder, parseSyncId, queueImport, releaseChatBind, syncIdText, type EntityDestination, type EntityScope, type LocalFirstStore, type LocalFirstTransaction } from '@builderforce/local-first';
import { chatRecordById, liveRecords, scanLive, type ChatValue } from './records';
import type { ViewKey } from '../types';

/** How long a bind waits for an already-sent import's receipt to bind the chat instead. */
const IMPORT_BIND_WAIT_MS = 5_000;

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
  /**
   * The local chat bound to a server chat, or undefined. Without `scope`: the mapping in the port's
   * current destination exactly (undefined when signed out). With `scope` (the host's active
   * account, `EntityScope`): the earliest chat mapping carrying that SyncId inside it — a server
   * chat id is only unique per tenant, so another account's chat 40 is never this one.
   */
  localIdFor(serverId: number, scope?: EntityScope): Promise<ViewKey | undefined>;
  /**
   * Bind a local chat when signed in and allowed: an existing binding wins, else the
   * server chat is created and mapped. Concurrent calls for one chat share one request.
   * Undefined when the chat stays unbound.
   */
  bind(localId: ViewKey): Promise<number | undefined>;
  /**
   * Record that a local chat IS an existing server chat (the host created it first).
   * False when it could not be: signed out, the local chat is gone, or it is bound to another
   * server chat (its sync import already went up and the server minted one for it).
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

export function createLocalChatIdentity(options: { store: LocalFirstStore; deviceId: string; port: ChatBindingPort; now?: () => Date }): LocalChatIdentity {
  const { store, deviceId, port } = options;
  const now = options.now ?? (() => new Date());
  /** This window's lease holder: a second window sharing the journal has its own. */
  const windowHolder = `window:${crypto.randomUUID()}`;
  const inFlight = new Map<number, Promise<number | undefined>>();

  const read = (localId: number) => store.read(async (tx) => {
    const chat = await chatRecordById(tx, deviceId, localId);
    return chat ? { chat, serverId: await boundServerId(tx, chat.id, port.destination()) } : undefined;
  });

  const mapIn = async (tx: LocalFirstTransaction, clientId: string, destination: EntityDestination, serverId: number): Promise<void> => {
    const syncId = parseSyncId(serverId);
    if (syncId == null) return; // not a server chat id — nothing to bind to
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
  };

  /**
   * The chat's import is already materialized — it may be on the server, so it, not a POST, makes
   * the server chat: wait (bounded) for its receipt to bind the chat. Undefined when none lands.
   */
  const awaitImportBinding = (localId: number): Promise<number | undefined> => new Promise((resolve, reject) => {
    let settled = false;
    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      done();
    };
    const check = () => {
      read(localId).then((found) => {
        if (!found) settle(() => resolve(undefined));
        else if (found.serverId !== undefined) settle(() => resolve(found.serverId));
      }, (error: unknown) => settle(() => reject(error)));
    };
    const timer = setTimeout(() => settle(() => resolve(undefined)), IMPORT_BIND_WAIT_MS);
    const unsubscribe = store.subscribe(check);
    check();
  });

  /**
   * THE one way a local chat gets its server chat — a bind's POST or an adopted id alike
   * (`serverChat`). The lease keeps the chat's import back until the mapping exists, so the
   * import names this chat; refused when the import already went up (`chatBindLease.ts`), and
   * then that import's receipt binds the chat. Decided in the commit that re-reads the binding:
   * a receipt that landed since the caller's read wins. The bound server chat, or undefined.
   */
  const bindThroughLease = async (
    localId: number,
    clientId: string,
    destination: EntityDestination,
    serverChat: () => Promise<number | null>,
    adopting = false,
  ): Promise<number | undefined> => {
    const claim = await store.transact(async (tx) => {
      const bound = await boundServerId(tx, clientId, destination);
      if (bound !== undefined) return { bound };
      const at = now();
      // An adopt takes over the lease its chat's `createChat({ bindPending })` stamped; anything
      // else claims as THIS window, so a second window's bind waits for the binding.
      const holder = adopting && (await liveChatBindHolder(tx, clientId, at)) === BIND_PENDING_HOLDER ? BIND_PENDING_HOLDER : windowHolder;
      return { holder, claimed: await claimChatBind(tx, clientId, at, holder) };
    });
    if ('bound' in claim) return claim.bound;
    // Not claimed: the chat's import already went up, or another holder's bind is in flight.
    if (!claim.claimed) return awaitImportBinding(localId);
    let serverId: number | null = null;
    try {
      serverId = await serverChat();
    } finally {
      // The mapping and the release in ONE commit: no round sees the lease gone and no mapping.
      await store.transact(async (tx) => {
        if (serverId != null) await mapIn(tx, clientId, destination, serverId);
        await releaseChatBind(tx, clientId, claim.holder);
      });
    }
    if (serverId == null) return undefined;
    return (await read(localId))?.serverId;
  };

  const bindOnce = async (localId: number): Promise<number | undefined> => {
    const found = await read(localId);
    if (!found) return undefined;
    if (found.serverId !== undefined) return found.serverId;
    const destination = port.destination();
    if (!destination || destination.kind !== 'bound' || !port.allowed()) return undefined;
    const { chat } = found.chat.payload;
    return bindThroughLease(localId, found.chat.id, destination,
      () => port.createServerChat({ title: chat.title, projectId: chat.projectId ?? null }));
  };

  return {
    serverIdFor: async (localId) => (await read(localId))?.serverId,
    clientIdFor: async (localId) => (await read(localId))?.chat.id,
    localIdFor: (serverId, scope) => store.read(async (tx) => {
      if (scope !== undefined) {
        const syncId = parseSyncId(serverId);
        if (syncId === null) return undefined;
        const mapping = await tx.mappingByServerId('chat', syncId, scope);
        // Only a row CARRYING the SyncId (re-read: brands do not survive the store). The store
        // normalises every row's `syncId`, and also returns a `syncId: null` row with the same key
        // text — a different entity, never this chat.
        if (!mapping || parseSyncId(mapping.syncId) !== syncId) return undefined;
        const chat = (await liveRecords<ChatValue>(tx, 'chat', deviceId, (row) => row.id === mapping.clientEntityId))[0];
        return chat?.payload.chat.id;
      }
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
      // A chat created with `bindPending` already holds the lease; a failed adopt lets it go.
      const releaseHeld = async (): Promise<void> => {
        if (found) await store.transact((tx) => releaseChatBind(tx, found.chat.id, [BIND_PENDING_HOLDER, windowHolder]));
      };
      if (!found || !destination || destination.kind !== 'bound') { await releaseHeld(); return false; }
      // Through the same lease as a bind: an import already sent may have minted ANOTHER server
      // chat for this local chat; then this chat is not that one (false), whatever binds it.
      // A lease the chat's own createChat (`bindPending`) took is this flow's: the claim re-stamps it
      // as the same holder (`adopting`).
      const adopted = (await bindThroughLease(localId, found.chat.id, destination, async () => serverId, true)) === serverId;
      if (!adopted) await releaseHeld();
      return adopted;
    },
  };
}
