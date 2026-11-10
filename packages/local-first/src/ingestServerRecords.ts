/**
 * Ingest records the SERVER reported (G21): a rail read, and later a pull, hand the device
 * rows it did not author. They land in the local store as `imported` / `server-observed`
 * records with their server-id mapping, in ONE store transaction, so the rail can answer
 * offline and a record the server already holds presents as `synced`.
 *
 * - The client id is the one `mappingByServerId` already names; otherwise a stable new one is
 *   minted and mapped, so a second ingest of the same rows reaches the same records.
 * - Payloads normalize through `materialize` (the one record-shaping step `applyServerCursor`
 *   uses), never a copy of it.
 * - A record with a pending local event is SKIPPED: an unsynced local edit is never overwritten.
 * - An equal payload writes nothing (no version bump), so ingesting the same rows twice is a no-op
 *   and a subscriber is not woken for it.
 * - A row's `merge` over a record the device authored keeps that record's provenance (the rail
 *   owns a few fields, not the record), and an identical merge writes nothing.
 * - With `completeListFor`, the rows are the COMPLETE set of a chat's tickets: each local
 *   `chat-ticket-link` of that chat whose ticket the server no longer lists is tombstoned, but ONLY
 *   when the batch lists at least `total` distinct tickets (a paged or truncated read tombstones
 *   nothing: absence from a partial list is not a deletion).
 *
 * A failure mid-batch throws out of the transaction and nothing is written.
 */

import { materialize } from './applyServerCursor.js';
import { chatTicketLinkId, linkServerIds } from './chatTicketLink.js';
import { clone } from './clone.js';
import { mintLocalId, parseEntityRef, parseSyncId, tierRefText } from './entityId.js';
import { canonicalPayloadHash } from './payloadHash.js';
import type { ChatTicketLinkValue, EntityDestination, LocalEntityType, LocalRecord, ServerMapping } from './records.js';
import type { LocalFirstTransaction } from './storeContract.js';
import type { LocalFirstStore } from './store.js';
import { tombstoneRecord } from './tombstone.js';

export interface ServerRecordRow {
  entityType: LocalEntityType;
  /** The server's id for the record (numeric text for a ticket, run or link). */
  serverId: string;
  /**
   * The server's form of the record. A FUNCTION is evaluated in the batch's transaction with the
   * client id every EARLIER row resolved to (in input order, including a row skipped for a pending
   * local edit), so a row can name another row of the same batch (a link naming its ticket). It may
   * answer `undefined` to leave the row out.
   */
  payload: unknown | ((resolvedClientIds: ReadonlyArray<string | undefined>) => unknown);
  /**
   * How the server's payload lands on a record the device already holds. Omitted, the server's form
   * REPLACES it (the server owns the whole record). A row that owns only some fields (the rail owns a
   * ticket's title, status and progress, not its project or description) merges them over `existing`.
   */
  merge?: (existing: unknown, incoming: unknown) => unknown;
  /** When the server last changed the record (ISO). */
  updatedAt: string;
  destination: EntityDestination;
}

export interface IngestServerRecordsOptions {
  /** The rows are the COMPLETE ticket list of this chat; links the server dropped are tombstoned. */
  completeListFor?: { chatClientId: string; total?: number };
  /** Record this read as completed now (`setReadMark(key, now)`) in the SAME transaction as its rows. */
  markRead?: string;
  now?: () => Date;
}

export interface IngestServerRecordsResult {
  written: number;
  unchanged: number;
  skippedPending: number;
  tombstoned: number;
  /** The client id each row resolved to, in input order (undefined for a skipped row). */
  clientIds: Array<string | undefined>;
}

/** Device id stamped on a record the server reported: not any device, so it is never "own". */
const SERVER_DEVICE = 'server';

/**
 * The client id of a row the device has no mapping for: minted, except a chat-ticket link,
 * whose id is DERIVED from its two client ids so it lands on the link the device may already hold.
 */
function newClientId(row: ServerRecordRow): string {
  if (row.entityType === 'chat-ticket-link') {
    const link = row.payload as Partial<ChatTicketLinkValue> | null;
    if (typeof link?.chatClientId === 'string' && typeof link.ticketClientId === 'string') {
      return chatTicketLinkId(link.chatClientId, link.ticketClientId);
    }
  }
  return mintLocalId();
}

/**
 * A link row's payload with the server ids of its chat and ticket (when this device maps them),
 * so a later local unlink or re-link of the ingested link carries them. List the chat and its
 * tickets BEFORE the links in one batch: a ticket ingested earlier in the batch is already mapped.
 */
async function withServerIds(tx: LocalFirstTransaction, row: ServerRecordRow): Promise<unknown> {
  if (row.entityType !== 'chat-ticket-link') return row.payload;
  const link = row.payload as Partial<ChatTicketLinkValue> | null;
  if (typeof link?.chatClientId !== 'string' || typeof link.ticketClientId !== 'string') return row.payload;
  return { ...(await linkServerIds(tx, link.chatClientId, link.ticketClientId)), ...link };
}

const pendingKey = (entityType: string, id: string): string => `${entityType}\u0000${id}`;

/**
 * The mapping a server row already has, in any destination (earliest wins): a tier ticket's
 * `kind:ref` is its `externalRef`; anything else is its server key (`syncId`, or legacy text).
 */
/** Whether `mapping` already names the server key `serverId` (its SyncId, tier ref, or text). */
function sameServerKey(mapping: ServerMapping, serverId: string): boolean {
  const ref = parseEntityRef(serverId);
  if (ref && 'sync' in ref) return parseSyncId(mapping.syncId) === ref.sync || mapping.serverId === serverId;
  if (ref && 'tier' in ref) return mapping.externalRef === tierRefText(ref.tier);
  return mapping.serverId === serverId;
}

function mappingOfRow(tx: LocalFirstTransaction, row: ServerRecordRow): ReturnType<LocalFirstTransaction['mappingByServerId']> {
  const ref = parseEntityRef(row.serverId);
  return ref && 'tier' in ref
    ? tx.mappingByExternalRef(row.entityType, tierRefText(ref.tier))
    : tx.mappingByServerId(row.entityType, row.serverId);
}

export async function ingestServerRecords(
  store: LocalFirstStore,
  rows: readonly ServerRecordRow[],
  options: IngestServerRecordsOptions = {},
): Promise<IngestServerRecordsResult> {
  const at = (options.now ?? (() => new Date()))().toISOString();
  return store.transact(async (tx) => {
    const result: IngestServerRecordsResult = { written: 0, unchanged: 0, skippedPending: 0, tombstoned: 0, clientIds: [] };
    const hasPending = new Set<string>();
    await tx.scanPending((event) => {
      if (!event.deadLetter) hasPending.add(pendingKey(event.entityType, event.clientEntityId));
    });

    const incomingTickets = new Set<string>();
    /** The client id each row resolved to, skipped rows included: what a later row's payload may name. */
    const resolvedIds: Array<string | undefined> = [];
    for (const source of rows) {
      const payload = typeof source.payload === 'function' ? source.payload(resolvedIds) : source.payload;
      if (payload === undefined) {
        resolvedIds.push(undefined);
        result.clientIds.push(undefined);
        continue;
      }
      const row: ServerRecordRow & { payload: unknown } = { ...source, payload };
      const mapping = await mappingOfRow(tx, row);
      const clientId = mapping?.clientEntityId ?? newClientId(row);
      resolvedIds.push(clientId);
      if (row.entityType === 'ticket') incomingTickets.add(clientId);
      if (row.entityType === 'chat-ticket-link') {
        const link = row.payload as Partial<ChatTicketLinkValue> | null;
        const listed = options.completeListFor === undefined || link?.chatClientId === options.completeListFor.chatClientId;
        if (listed && typeof link?.ticketClientId === 'string') incomingTickets.add(link.ticketClientId);
      }
      if (hasPending.has(pendingKey(row.entityType, clientId))) {
        result.skippedPending += 1;
        result.clientIds.push(undefined);
        continue;
      }
      result.clientIds.push(clientId);
      const existing = await tx.get(row.entityType, clientId);
      const incoming = await withServerIds(tx, row);
      const merged = Boolean(row.merge && existing && !existing.deletedAt);
      // A merge over a record the device authored keeps the device's provenance: the server owns
      // only the merged fields, not the record, so it stays the device's work (Unfiled, own).
      const keepsProvenance = merged && existing?.provenance !== undefined && existing.provenance.evidence !== 'server-observed';
      const next = materialize(
        {
          clientEntityId: clientId,
          entityType: row.entityType,
          payload: merged ? row.merge!(existing!.payload, incoming) : incoming,
          updatedAt: row.updatedAt,
          destination: row.destination,
          provenance: keepsProvenance
            ? { ...existing!.provenance! }
            : { deviceId: SERVER_DEVICE, source: 'imported', evidence: 'server-observed' },
        },
        existing,
      );
      if (!next) continue;
      // A merge compares payloads whatever the provenance (it never changes it), so an identical
      // merge writes nothing; a replace also adopts the server's provenance, so it compares only
      // over a record that already has it.
      const unchanged = existing !== undefined
        && !existing.deletedAt
        && (merged || existing.provenance?.evidence === 'server-observed')
        && canonicalPayloadHash(existing.payload) === canonicalPayloadHash(next.payload);
      if (unchanged) {
        result.unchanged += 1;
      } else {
        const record: LocalRecord = {
          ...next,
          version: existing ? existing.version + 1 : 1,
          ...(existing ? { baseVersion: existing.version } : {}),
          occurredAt: existing?.occurredAt ?? next.occurredAt,
        };
        await tx.put(record);
        result.written += 1;
      }
      if (!mapping) {
        // A derived link id may already be mapped (this device linked it and the server imported
        // it): keep that mapping's version, only learn the server id; never reset it to 1.
        const known = await tx.mapping(row.entityType, clientId, row.destination);
        if (!known || !sameServerKey(known, row.serverId) || known.serverVersion < 1) {
          await tx.putMapping({
            destination: row.destination,
            entityType: row.entityType,
            clientEntityId: clientId,
            serverId: row.serverId,
            serverVersion: Math.max(known?.serverVersion ?? 0, 1),
          });
        }
      }
    }

    if (options.completeListFor && incomingTickets.size >= (options.completeListFor.total ?? 0)) {
      const { chatClientId } = options.completeListFor;
      const dropped: LocalRecord<ChatTicketLinkValue>[] = [];
      await tx.scan<ChatTicketLinkValue>('chat-ticket-link', (link) => {
        if (link.deletedAt || link.payload.chatClientId !== chatClientId) return;
        if (incomingTickets.has(link.payload.ticketClientId)) return;
        // An unsynced local link is the user's, not the server's to drop.
        if (hasPending.has(pendingKey('chat-ticket-link', link.id))) return;
        dropped.push(clone(link) as LocalRecord<ChatTicketLinkValue>);
      });
      for (const link of dropped) {
        const gone = tombstoneRecord(link, at);
        await tx.put({
          ...gone,
          provenance: { deviceId: SERVER_DEVICE, source: 'imported', evidence: 'server-observed' },
        });
        result.tombstoned += 1;
      }
    }
    if (options.markRead !== undefined && (await tx.readMark(options.markRead)) !== at) {
      await tx.setReadMark(options.markRead, at);
    }
    return result;
  });
}
