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
import { mintClientEntityId } from './clientEntityIdentity.js';
import { canonicalPayloadHash } from './payloadHash.js';
import type { ChatTicketLinkValue, EntityDestination, LocalEntityType, LocalRecord } from './records.js';
import type { LocalFirstTransaction } from './storeContract.js';
import type { LocalFirstStore } from './store.js';
import { tombstoneRecord } from './tombstone.js';

export interface ServerRecordRow {
  entityType: LocalEntityType;
  /** The server's id for the record (numeric text for a ticket, run or link). */
  serverId: string;
  payload: unknown;
  /** When the server last changed the record (ISO). */
  updatedAt: string;
  destination: EntityDestination;
}

export interface IngestServerRecordsOptions {
  /** The rows are the COMPLETE ticket list of this chat; links the server dropped are tombstoned. */
  completeListFor?: { chatClientId: string; total: number };
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
  return mintClientEntityId();
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
    for (const row of rows) {
      const mapping = await tx.mappingByServerId(row.entityType, row.serverId);
      const clientId = mapping?.clientEntityId ?? newClientId(row);
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
      const next = materialize(
        {
          clientEntityId: clientId,
          entityType: row.entityType,
          payload: await withServerIds(tx, row),
          updatedAt: row.updatedAt,
          destination: row.destination,
          provenance: { deviceId: SERVER_DEVICE, source: 'imported', evidence: 'server-observed' },
        },
        existing,
      );
      if (!next) continue;
      const unchanged = existing !== undefined
        && !existing.deletedAt
        && existing.provenance?.evidence === 'server-observed'
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
        if (!known || known.serverId !== row.serverId || known.serverVersion < 1) {
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

    if (options.completeListFor && incomingTickets.size >= options.completeListFor.total) {
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
    return result;
  });
}
