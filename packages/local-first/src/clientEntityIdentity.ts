/**
 * Stable client entity identity across restart and sync (G04).
 *
 * Server numeric ids are not the live key. `mintClientEntityId` returns a
 * UUID string. `rememberServerId` records a server id beside that UUID and
 * does not replace it. The only store is the map argument: this module keeps
 * no mapping of its own, so a restart is passing that same map back in.
 */

/** Returned when a client id is already mapped to a different server id. */
export const MAPPING_CONFLICT = 'mapping_conflict';

/** Thrown when a client id is missing or blank. */
export const CLIENT_ID_REQUIRED = 'client_id_required';

/**
 * Thrown when a caller tries to use a server numeric id (positive, negative,
 * or zero) as the live client key.
 */
export const SERVER_NUMERIC_ID = 'server_numeric_id';

/** Thrown when a server id is missing or blank. */
export const SERVER_ID_REQUIRED = 'server_id_required';

/** Thrown when the local id source does not produce a UUID string. */
export const CLIENT_ID_NOT_UUID = 'client_id_not_uuid';

/**
 * Explicit client id → server id pairs. Keys are client ids. Values are
 * server ids. Serialize this value and pass it back after a restart.
 */
export interface ClientEntityMap {
  readonly [clientId: string]: string;
}

export type RememberServerIdResult =
  | {
      readonly ok: true;
      readonly map: ClientEntityMap;
      /** Live key. Never rewritten to `serverId`. */
      readonly clientId: string;
      readonly serverId: string;
    }
  | {
      readonly ok: false;
      readonly conflict: typeof MAPPING_CONFLICT;
      /** The map argument, unchanged. */
      readonly map: ClientEntityMap;
      readonly clientId: string;
      /** Server id already stored for `existingClientId`. */
      readonly existingServerId: string;
      /** Client id that already owns `existingServerId`. */
      readonly existingClientId: string;
      /** Server id that was refused. */
      readonly rejectedServerId: string;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_ID_RE = /^-?\d+$/;

function identityError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function assertClientId(clientId: string): void {
  if (typeof clientId !== 'string' || clientId.trim() === '' || clientId !== clientId.trim()) {
    identityError(CLIENT_ID_REQUIRED);
  }
  if (INTEGER_ID_RE.test(clientId)) identityError(SERVER_NUMERIC_ID);
}

function assertServerId(serverId: string): void {
  if (typeof serverId !== 'string' || serverId.trim() === '') identityError(SERVER_ID_REQUIRED);
}

/**
 * Mint a stable client entity id.
 *
 * The result is a UUID string from `crypto.randomUUID`. It is never a
 * positive integer, and it does not wait on a server.
 */
export function mintClientEntityId(): string {
  const id = crypto.randomUUID();
  if (typeof id !== 'string' || !UUID_RE.test(id) || INTEGER_ID_RE.test(id)) {
    identityError(CLIENT_ID_NOT_UUID);
  }
  return id;
}

/**
 * Record `serverId` beside `clientId`.
 *
 * The returned map still keys the row by `clientId`. Applying a different
 * server id for a client id that already has one returns `mapping_conflict`
 * and the original map. Applying the same pair again is the same mapping.
 * A server id already owned by another client id is also a conflict, so a
 * reverse lookup stays unambiguous. The input map is not mutated.
 */
export function rememberServerId(
  map: ClientEntityMap,
  clientId: string,
  serverId: string,
): RememberServerIdResult {
  assertClientId(clientId);
  assertServerId(serverId);

  const existing = serverIdFor(map, clientId);
  if (existing !== undefined) {
    if (existing === serverId) {
      return { ok: true, map, clientId, serverId };
    }
    return {
      ok: false,
      conflict: MAPPING_CONFLICT,
      map,
      clientId,
      existingServerId: existing,
      existingClientId: clientId,
      rejectedServerId: serverId,
    };
  }

  const owner = clientIdFor(map, serverId);
  if (owner !== undefined) {
    return {
      ok: false,
      conflict: MAPPING_CONFLICT,
      map,
      clientId,
      existingServerId: serverId,
      existingClientId: owner,
      rejectedServerId: serverId,
    };
  }

  const next: Record<string, string> = {};
  for (const key of Object.keys(map)) {
    const value = map[key];
    if (typeof value === 'string') next[key] = value;
  }
  next[clientId] = serverId;
  return { ok: true, map: next, clientId, serverId };
}

/** Server id stored for `clientId`, or `undefined` when this map has none. */
export function serverIdFor(map: ClientEntityMap, clientId: string): string | undefined {
  if (typeof clientId !== 'string' || !Object.prototype.hasOwnProperty.call(map, clientId)) {
    return undefined;
  }
  const serverId = map[clientId];
  return typeof serverId === 'string' ? serverId : undefined;
}

/** Client id that owns `serverId` in this map, or `undefined`. */
export function clientIdFor(map: ClientEntityMap, serverId: string): string | undefined {
  if (typeof serverId !== 'string') return undefined;
  for (const clientId of Object.keys(map)) {
    if (map[clientId] === serverId) return clientId;
  }
  return undefined;
}
