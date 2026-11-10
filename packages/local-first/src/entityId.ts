/**
 * THE entity id primitive (docs/design/typed-entity-ids.md §2).
 *
 * - A **LocalId** is the UUID the device that created an entity minted. It never changes.
 * - A **SyncId** is the positive integer the server assigned when it imported the entity.
 *
 * Every UUID check and every "is this a server integer id" parse goes through here; no other
 * file keeps its own regex. Brands do not survive JSON, `postMessage` or IndexedDB: a value
 * read back is re-checked with `isLocalId` / `parseSyncId`.
 *
 * No dependencies. Absorbs the former `clientEntityIdentity.ts` (G04).
 */

export type LocalId = string & { readonly __brand: 'LocalId' };
export type SyncId = number & { readonly __brand: 'SyncId' };

/** A reference to an entity: its device id, its server id, or a planning tier's `kind:ref`. */
export type EntityRef =
  | { local: LocalId }
  | { sync: SyncId }
  | { tier: { kind: string; ref: string } };

/** Thrown when the local id source does not produce a UUID string. */
export const CLIENT_ID_NOT_UUID = 'client_id_not_uuid';

/** Any UUID version, any case. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Integer text of any sign: what must never be used as a client key. */
const INTEGER_ID_RE = /^-?\d+$/;
/** A SyncId as text: positive, no leading zero, no sign, no whitespace. */
const SYNC_ID_TEXT_RE = /^[1-9]\d*$/;
/** A planning tier reference: `spec:5`, `objective:Q3-growth`. */
const TIER_REF_RE = /^([A-Za-z][\w-]*):(\S.*)$/;

/** Mint a LocalId: `crypto.randomUUID()`, lower-case. Local only, never waits on a server. */
export function mintLocalId(): LocalId {
  const id: unknown = crypto.randomUUID();
  if (typeof id !== 'string') throw Object.assign(new Error(CLIENT_ID_NOT_UUID), { code: CLIENT_ID_NOT_UUID });
  const lower = id.toLowerCase();
  if (!isLocalId(lower)) throw Object.assign(new Error(CLIENT_ID_NOT_UUID), { code: CLIENT_ID_NOT_UUID });
  return lower;
}

/** THE UUID check (case-insensitive). */
export function isLocalId(v: unknown): v is LocalId {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** A SyncId from a positive safe integer or its decimal text (`/^[1-9]\d*$/`); anything else is null. */
export function parseSyncId(v: unknown): SyncId | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? (v as SyncId) : null;
  if (typeof v !== 'string' || !SYNC_ID_TEXT_RE.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? (n as SyncId) : null;
}

/** The one place a SyncId becomes wire / payload text. */
export function syncIdText(id: SyncId): string {
  return String(id);
}

/**
 * Integer text of any sign (`42`, `-3`, `0`). Not a SyncId test — use `parseSyncId` for that.
 * Answers "was a server-shaped number handed in where a client key belongs?".
 */
export function isIntegerIdText(v: unknown): v is string {
  return typeof v === 'string' && INTEGER_ID_RE.test(v);
}

/**
 * Read a reference of unknown shape: a UUID → `local`, a positive integer (or its text) →
 * `sync`, `kind:ref` → `tier`. An `EntityRef` object is re-validated (brands do not survive
 * a round-trip). Anything else is null — never a guess.
 */
export function parseEntityRef(v: unknown): EntityRef | null {
  if (typeof v === 'number') {
    const sync = parseSyncId(v);
    return sync === null ? null : { sync };
  }
  if (typeof v === 'string') {
    if (isLocalId(v)) return { local: v };
    const sync = parseSyncId(v);
    if (sync !== null) return { sync };
    const tier = TIER_REF_RE.exec(v);
    return tier ? { tier: { kind: tier[1]!, ref: tier[2]! } } : null;
  }
  if (typeof v === 'object' && v !== null) {
    const ref = v as Record<string, unknown>;
    if ('local' in ref) return isLocalId(ref.local) ? { local: ref.local } : null;
    if ('sync' in ref) {
      const sync = parseSyncId(ref.sync);
      return sync === null ? null : { sync };
    }
    if ('tier' in ref && typeof ref.tier === 'object' && ref.tier !== null) {
      const { kind, ref: tierRef } = ref.tier as Record<string, unknown>;
      if (typeof kind === 'string' && kind !== '' && typeof tierRef === 'string' && tierRef !== '') {
        return { tier: { kind, ref: tierRef } };
      }
    }
  }
  return null;
}

/** The `kind:ref` text of a tier reference — how it is stored as a mapping's `externalRef`. */
export function tierRefText(tier: { kind: string; ref: string }): string {
  return `${tier.kind}:${tier.ref}`;
}
