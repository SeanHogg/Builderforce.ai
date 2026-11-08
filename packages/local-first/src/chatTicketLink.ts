/**
 * The local chat-to-ticket link (G21): `chat-ticket-link`, a many-to-many record with a
 * `linkType`, written on the device and synced like any other record.
 *
 * - Its id is DETERMINISTIC from the two client ids, so linking the same pair twice (here, or
 *   on another device) is one record. It is UUID-shaped, a CUSTOM id (version nibble 8, variant
 *   bits set; NOT a UUIDv5), because every client entity id is a UUID; the digest is four seeded
 *   passes of the package's one FNV-1a (`payloadHash.ts`), all a stable id needs (an identity, not a secret).
 * - Unlink is a TOMBSTONE (`deletedAt`), never a missing row, so a later pull cannot revive it.
 * - A link's sync event waits on BOTH the chat's and the ticket's imports (`importKey`s, the
 *   pattern `ticketWaitsOn` uses): the server resolves the link through both mappings, so it
 *   must not run before either parent has landed.
 * - Linking an existing live pair is a no-op; a 'created' link is never downgraded to 'linked'
 *   (the server's `upsertChatTicketLink` rule).
 * - The server ids of a chat / ticket the device only INGESTED ride the payload (`linkServerIds`),
 *   so the server resolves a link to a server-origin entity; a re-link of a pair the server
 *   already unlinked revives it (the importer treats a link as an idempotent relation).
 */

import { importKey, isImported, journalWrite, queueImport } from './journalRules.js';
import { fnv1a32 } from './payloadHash.js';
import type { ChatTicketLinkType, ChatTicketLinkValue, LocalRecord } from './records.js';
import { newLocalRecord, type LocalFirstStore, type LocalFirstTransaction } from './store.js';
import { tombstoneRecord } from './tombstone.js';

export interface ChatTicketLinkInput {
  chatClientId: string;
  ticketClientId: string;
  deviceId: string;
  occurredAt?: string;
}

export interface LinkChatTicketInput extends ChatTicketLinkInput {
  linkType: ChatTicketLinkType;
}

/** The stable UUID-shaped (custom, version-8 style: not a UUIDv5) id of the pair. */
export function chatTicketLinkId(chatClientId: string, ticketClientId: string): string {
  const text = `${chatClientId}:${ticketClientId}`;
  const hex = [2166136261, 3339675911, 2654435761, 1013904223]
    .map((seed) => fnv1a32(text, seed).toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The imports a link must follow: its chat's and its ticket's. */
export function chatTicketLinkWaitsOn(link: ChatTicketLinkValue): string[] {
  return [importKey('chat', link.chatClientId), importKey('ticket', link.ticketClientId)];
}

async function journalLink(
  tx: LocalFirstTransaction,
  record: LocalRecord<ChatTicketLinkValue>,
  operation: 'create' | 'update' | 'delete',
): Promise<void> {
  const waitsOn = chatTicketLinkWaitsOn(record.payload);
  if (record.destination.kind === 'bound') {
    const mapping = await tx.mapping(record.entityType, record.id, record.destination);
    if (!isImported(mapping)) {
      await queueImport(tx, record, undefined, waitsOn);
      return;
    }
  }
  await journalWrite(tx, record, operation, {
    key: `chat-ticket-link:${record.id}:v${record.version}`,
    dependsOn: waitsOn,
  });
}

/**
 * The server ids of the link's chat and ticket, for each the device holds an imported server
 * mapping of. Used by the local link write and by `ingestServerRecords` for a link row, so a
 * later unlink of an ingested link carries them too.
 */
export async function linkServerIds(
  tx: LocalFirstTransaction,
  chatClientId: string,
  ticketClientId: string,
): Promise<Pick<ChatTicketLinkValue, 'chatServerId' | 'ticketServerId'>> {
  const idOf = async (type: 'chat' | 'ticket', id: string): Promise<string | undefined> => {
    const row = await tx.get(type, id);
    if (!row) return undefined;
    const mapping = await tx.mapping(type, id, row.destination);
    return isImported(mapping) ? mapping!.serverId : undefined;
  };
  const chatServerId = await idOf('chat', chatClientId);
  const ticketServerId = await idOf('ticket', ticketClientId);
  return {
    ...(chatServerId !== undefined ? { chatServerId } : {}),
    ...(ticketServerId !== undefined ? { ticketServerId } : {}),
  };
}

function missing(code: string): never {
  throw Object.assign(new Error(code), { code });
}

/** Link a chat to a ticket on this device. Returns the live link record. */
export async function linkChatTicket(
  store: LocalFirstStore,
  input: LinkChatTicketInput,
): Promise<LocalRecord<ChatTicketLinkValue>> {
  const { chatClientId, ticketClientId, linkType, deviceId } = input;
  if (!chatClientId.trim() || !ticketClientId.trim()) missing('chat_ticket_link_ids_required');
  const id = chatTicketLinkId(chatClientId, ticketClientId);
  return store.transact(async (tx) => {
    const chat = await tx.get('chat', chatClientId);
    if (!chat) missing('chat_not_found');
    if (!(await tx.get('ticket', ticketClientId))) missing('ticket_not_found');
    const existing = await tx.get<ChatTicketLinkValue>('chat-ticket-link', id);
    const live = existing && !existing.deletedAt ? existing : undefined;
    // 'created' is the stronger lineage: re-linking never downgrades it.
    const effective: ChatTicketLinkType = live?.payload.linkType === 'created' ? 'created' : linkType;
    if (live && live.payload.linkType === effective) return live;
    const payload: ChatTicketLinkValue = {
      chatClientId,
      ticketClientId,
      ...(await linkServerIds(tx, chatClientId, ticketClientId)),
      linkType: effective,
    };
    const at = input.occurredAt ?? new Date().toISOString();
    let record: LocalRecord<ChatTicketLinkValue>;
    if (existing) {
      const { deletedAt: _dropped, ...rest } = existing;
      void _dropped;
      record = {
        ...rest,
        payload,
        version: existing.version + 1,
        baseVersion: existing.version,
        occurredAt: at,
        updatedAt: at,
        provenance: { deviceId, source: 'local' },
      };
    } else {
      record = newLocalRecord<ChatTicketLinkValue>({
        id,
        entityType: 'chat-ticket-link',
        payload,
        deviceId,
        destination: chat.destination,
        occurredAt: at,
      });
    }
    await tx.put(record);
    await journalLink(tx, record, live ? 'update' : 'create');
    return record;
  });
}

/** Unlink: tombstone the link and journal the delete. Returns whether a live link was removed. */
export async function unlinkChatTicket(store: LocalFirstStore, input: ChatTicketLinkInput): Promise<boolean> {
  const id = chatTicketLinkId(input.chatClientId, input.ticketClientId);
  return store.transact(async (tx) => {
    const existing = await tx.get<ChatTicketLinkValue>('chat-ticket-link', id);
    if (!existing || existing.deletedAt) return false;
    const at = input.occurredAt ?? new Date().toISOString();
    const gone: LocalRecord<ChatTicketLinkValue> = {
      ...tombstoneRecord(existing, at),
      occurredAt: at,
      provenance: { deviceId: input.deviceId, source: 'local' },
    };
    await tx.put(gone);
    await journalLink(tx, gone, 'delete');
    return true;
  });
}
