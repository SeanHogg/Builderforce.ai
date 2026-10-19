/**
 * Client-generated entity identity (G04 / G15).
 *
 * A local entity has its id before any sync. The server is never the source
 * of the id: a record written offline is synced later under the same id, and a
 * server mapping records the server row beside that id rather than replacing
 * it.
 *
 * `reusedClientId` is one client id for this installation. A restart reads it
 * back; it is not minted again. `stableClientId` does the same for a run,
 * step, or approval live key. `stableDeviceId` mints a device id only when
 * none is stored, and does not return that id until the caller's `set` has
 * resolved and a following read sees it. A crash between mint and persist
 * therefore never handed the caller an id, so the next read cannot hand out
 * a second live id.
 *
 * This module does not fetch, open a socket, or call a platform API. The
 * caller owns the store.
 */

import { mintDeviceId, resolveDeviceId } from './deviceIdentity.js';

/** Thrown when a record carries no client id at all. */
export const MISSING_CLIENT_ID = 'missing_client_id';
/** Thrown when a record carries a server-assigned id instead of a client id. */
export const SERVER_ASSIGNED_ID = 'server_assigned_id';
/**
 * Thrown when `set` settled but a following read does not see the minted id.
 * The id is not returned: the next read must not be a second live id.
 */
export const IDENTITY_NOT_DURABLE = 'identity_not_durable';
/** Thrown when a live-key kind is not run, step, or approval. */
export const LIVE_KEY_KIND_REQUIRED = 'live_key_kind_required';
/** Thrown when a run, step, or approval has no local key to reuse. */
export const LIVE_KEY_REQUIRED = 'live_key_required';
/** Thrown when the device id has no storage key. */
export const DEVICE_KEY_REQUIRED = 'device_key_required';
/** Thrown when the caller did not pass a get/set store. */
export const IDENTITY_STORE_REQUIRED = 'identity_store_required';

/** Ids the server mints are never a valid client entity id. */
export const SERVER_ID_PREFIX = 'srv_';

/** One installation client id. A restart reads this key back. */
export const CLIENT_IDENTITY_KEY = 'bf.client.id';

/**
 * Default device-id key. Hosts that already persist under another name
 * (`builderforce.localDeviceId` in the VSIX) pass that key instead.
 */
export const DEVICE_IDENTITY_KEY = 'bf.device.id';

export const LIVE_CONTRACT_KINDS = ['run', 'step', 'approval'] as const;
export type LiveContractKind = (typeof LIVE_CONTRACT_KINDS)[number];

/** The minimum shape these rules read. A `LocalRecord` satisfies it. */
export interface IdentifiedRecord {
  readonly id?: string | null;
}

/**
 * Durable id slot. `set` must resolve only after the value can be read back
 * by a later process. A rejection means the id was not stored.
 */
export interface DurableIdentityStore {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string): void | Promise<void>;
}

const INTEGER_ID_RE = /^-?\d+$/;

const flights = new WeakMap<object, Map<string, Promise<string>>>();

function identityError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function assertStore(store: DurableIdentityStore | null | undefined): DurableIdentityStore {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    identityError(IDENTITY_STORE_REQUIRED);
  }
  return store;
}

function nonBlank(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value;
}

function acceptClientId(stored: string): string {
  if (stored.startsWith(SERVER_ID_PREFIX) || INTEGER_ID_RE.test(stored.trim())) {
    identityError(SERVER_ASSIGNED_ID);
  }
  return stored;
}

function isLiveKind(kind: string): kind is LiveContractKind {
  return (LIVE_CONTRACT_KINDS as readonly string[]).includes(kind);
}

/** `bf.client.<kind>.<localKey>` — the live key, never the server id. */
export function liveClientKey(kind: LiveContractKind, localKey: string): string {
  if (!isLiveKind(kind)) identityError(LIVE_KEY_KIND_REQUIRED);
  if (typeof localKey !== 'string' || localKey.trim() === '') identityError(LIVE_KEY_REQUIRED);
  return `bf.client.${kind}.${localKey.trim()}`;
}

/** Server id stored beside a live key. Not a substitute for that key. */
export function serverMappingKey(kind: LiveContractKind, localKey: string): string {
  return `${liveClientKey(kind, localKey)}.server`;
}

function joinFlight(store: object, key: string, start: () => Promise<string>): Promise<string> {
  let byKey = flights.get(store);
  if (!byKey) {
    byKey = new Map();
    flights.set(store, byKey);
  }
  const flightsForStore = byKey;
  const existing = flightsForStore.get(key);
  if (existing) return existing;
  const run = start().finally(() => {
    if (flightsForStore.get(key) === run) flightsForStore.delete(key);
  });
  flightsForStore.set(key, run);
  return run;
}

async function readStored(store: DurableIdentityStore, key: string): Promise<string | undefined> {
  return nonBlank(await store.get(key));
}

/**
 * Mint only when nothing usable is stored. `set` is awaited, then the value
 * is read back, and only that confirmed value is returned.
 */
function loadOrMint(
  store: DurableIdentityStore,
  key: string,
  mint: () => string,
  acceptStored: (stored: string) => string,
): Promise<string> {
  const durable = assertStore(store);
  if (typeof key !== 'string' || key.trim() === '') identityError(LIVE_KEY_REQUIRED);
  return joinFlight(durable, key, async () => {
    const stored = await readStored(durable, key);
    if (stored !== undefined) return acceptStored(stored);
    const minted = mint();
    await Promise.resolve(durable.set(key, minted));
    const confirmed = await readStored(durable, key);
    if (confirmed !== minted) identityError(IDENTITY_NOT_DURABLE);
    return confirmed;
  });
}

/**
 * Mint a stable client entity id.
 *
 * `crypto.randomUUID` is local: it does not contact the network and does not
 * wait for a server round trip, so an offline create is never blocked on the
 * id. Two calls never return the same id.
 */
export function clientEntityId(): string {
  const id = crypto.randomUUID();
  if (typeof id !== 'string' || id.trim() === '') identityError(MISSING_CLIENT_ID);
  if (id.startsWith(SERVER_ID_PREFIX)) identityError(SERVER_ASSIGNED_ID);
  return id;
}

/**
 * Refuse a record that has no client id, and refuse one whose id the server
 * assigned. A missing, non-string, or whitespace-only id is
 * `missing_client_id`; an `srv_…` id is `server_assigned_id`, even when the
 * record also carries other client ids elsewhere.
 */
export function assertClientIdentity(record: IdentifiedRecord | null | undefined): void {
  const id = record?.id;
  if (typeof id !== 'string' || id.trim() === '') identityError(MISSING_CLIENT_ID);
  if (id.startsWith(SERVER_ID_PREFIX)) identityError(SERVER_ASSIGNED_ID);
}

/**
 * True only when the id survived the round trip unchanged.
 *
 * Everything else may legitimately differ after sync — version, server
 * version, updated time, payload — so only the id is compared. A record that
 * gained or lost an id, including one remapped to a server id, is `false`.
 */
export function sameIdentityAfterSync(
  before: IdentifiedRecord | null | undefined,
  after: IdentifiedRecord | null | undefined,
): boolean {
  const beforeId = before?.id;
  const afterId = after?.id;
  if (typeof beforeId !== 'string' || typeof afterId !== 'string') return false;
  if (beforeId.trim() === '' || afterId.trim() === '') return false;
  return beforeId === afterId;
}

/**
 * One client id for this installation, reused across restart.
 *
 * A stored id is returned unchanged and is not written again. An empty slot
 * is minted, and the id is returned only after `set` has been confirmed by a
 * following read.
 */
export function reusedClientId(
  store: DurableIdentityStore,
  key: string = CLIENT_IDENTITY_KEY,
): Promise<string> {
  return loadOrMint(store, key, clientEntityId, acceptClientId);
}

/**
 * The live client id for a run, step, or approval.
 *
 * Restart passes the same store and local key and gets the same id. A server
 * id is never accepted as this value.
 */
export function stableClientId(
  store: DurableIdentityStore,
  kind: LiveContractKind,
  localKey: string,
): Promise<string> {
  return loadOrMint(store, liveClientKey(kind, localKey), clientEntityId, acceptClientId);
}

/**
 * Record `serverId` beside the live key and return that same client id.
 *
 * The live key is not rewritten. A later `stableClientId` for this run, step,
 * or approval is still the id from before sync.
 */
export async function keepClientIdAcrossSync(
  store: DurableIdentityStore,
  kind: LiveContractKind,
  localKey: string,
  serverId: string,
): Promise<string> {
  if (typeof serverId !== 'string' || serverId.trim() === '') identityError(SERVER_ASSIGNED_ID);
  const durable = assertStore(store);
  const clientId = await stableClientId(durable, kind, localKey);
  if (serverId === clientId) identityError(SERVER_ASSIGNED_ID);
  await Promise.resolve(durable.set(serverMappingKey(kind, localKey), serverId));
  const again = await stableClientId(durable, kind, localKey);
  if (again !== clientId) identityError(IDENTITY_NOT_DURABLE);
  return again;
}

/**
 * Device id, persisted and awaited before it is returned.
 *
 * Hosts pass the key they already use. Nothing is returned until `set` has
 * resolved and a following `get` reads the same id. A crash in that window
 * never handed the caller an id, so the next read is not a second live id.
 * A stored id is returned as-is and is not the signed-in user.
 */
export function stableDeviceId(
  store: DurableIdentityStore,
  deviceKey: string = DEVICE_IDENTITY_KEY,
  signedInUserId?: string | null,
): Promise<string> {
  if (typeof deviceKey !== 'string' || deviceKey.trim() === '') identityError(DEVICE_KEY_REQUIRED);
  return loadOrMint(store, deviceKey, mintDeviceId, (stored) => resolveDeviceId(stored, signedInUserId));
}
