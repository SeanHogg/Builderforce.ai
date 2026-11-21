/**
 * A PULLED `chat-ticket-link` in the device's own form (`ChatTicketLinkValue`).
 *
 * The server stores (and its pull serves back) a link in its canonical SERVER form
 * `{ chatId, ticketId, linkType }` (server ids; `importSyncedChatTicketLink.ts`). Stored on the
 * device verbatim, the link lost `chatClientId` / `ticketClientId`, so every reader that selects a
 * chat's links by its client id (the rail, the chat-row summary) stopped seeing it: a ticket the
 * agent filed in a chat read "No tickets linked yet" once the next pull came back (chat #282,
 * local #165961, 2026-11-21). The pull now lands a link in the device's form, and the links an
 * earlier pull already stored in the server's form are repaired the same way.
 *
 * - The link type never downgrades: 'created' on either side stays 'created' (the server's rule).
 * - A link the device already holds in its own form keeps its client ids and server ids.
 * - Otherwise the server ids resolve through this device's chat and ticket mappings in the link's
 *   account.
 * - A link is stored ONLY under its derived id (`chatTicketLinkId` of this device's chat and ticket
 *   client ids): the one `unlinkChatTicket` / `linkChatTicketInTx` look up. A link another device
 *   authored carries THAT device's derived id; stored under it, no unlink here would ever reach it,
 *   and the rail's ingest would hold the same pair twice. Such a link (and one whose chat or ticket
 *   this device does not map) is not stored by the pull: the rail's refresh ingests it under its
 *   derived id (`ingestServerRecords`).
 */

import { chatTicketLinkId } from './chatTicketLink.js';
import { parseSyncId, syncIdText } from './entityId.js';
import { scanPendingOfRow } from './pendingQueries.js';
import { accountScopeOf, destinationKey, type ChatTicketLinkType, type ChatTicketLinkValue, type EntityDestination, type EntityScope, type LocalRecord } from './records.js';
import { SCAN_STOP, type LocalFirstTransaction } from './storeContract.js';

type Fields = Record<string, unknown>;

const asFields = (payload: unknown): Fields | undefined =>
  payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Fields : undefined;

/** Whether a link payload is in the device's form (both client ids present). */
export function isClientFormLink(payload: unknown): payload is ChatTicketLinkValue {
  const fields = asFields(payload);
  return typeof fields?.chatClientId === 'string' && typeof fields.ticketClientId === 'string';
}

/** A link's type over every side that names one: 'created' when any does. */
function linkTypeOf(...payloads: unknown[]): ChatTicketLinkType {
  return payloads.some((payload) => asFields(payload)?.linkType === 'created') ? 'created' : 'linked';
}

/** The client id this device maps a server id of `entityType` to, in `scope`. */
async function clientIdOf(tx: LocalFirstTransaction, entityType: 'chat' | 'ticket', serverId: unknown, scope: EntityScope | undefined): Promise<{ clientId: string; serverId: string } | undefined> {
  const sync = parseSyncId(serverId);
  if (sync === null) return undefined;
  const mapping = await tx.mappingByServerId(entityType, sync, scope);
  // Only a row CARRYING the SyncId (brands do not survive the store: re-read).
  if (!mapping || parseSyncId(mapping.syncId) !== sync) return undefined;
  return { clientId: mapping.clientEntityId, serverId: syncIdText(sync) };
}

/** The payload in the device's form, before the derived-id check. */
async function deviceForm(
  tx: LocalFirstTransaction,
  payload: unknown,
  existing: Pick<LocalRecord, 'payload'> | undefined,
  destination: EntityDestination,
): Promise<ChatTicketLinkValue | undefined> {
  const linkType = linkTypeOf(payload, existing?.payload);
  if (isClientFormLink(payload)) return { ...payload, linkType };
  const server = asFields(payload);
  if (!server) return undefined;
  if (existing && isClientFormLink(existing.payload)) return { ...existing.payload, linkType };
  const scope = accountScopeOf(destination);
  const chat = await clientIdOf(tx, 'chat', server.chatId, scope);
  const ticket = chat ? await clientIdOf(tx, 'ticket', server.ticketId, scope) : undefined;
  if (!chat || !ticket) return undefined;
  return {
    chatClientId: chat.clientId,
    ticketClientId: ticket.clientId,
    chatServerId: chat.serverId,
    ticketServerId: ticket.serverId,
    linkType,
  };
}

/**
 * The payload the pulled link `id` is stored with (see the module rules), or undefined when the
 * pull must not store it: not resolvable here, or `id` is not this device's derived id of the pair.
 */
export async function pulledLinkPayload(
  tx: LocalFirstTransaction,
  id: string,
  payload: unknown,
  existing: Pick<LocalRecord, 'payload'> | undefined,
  destination: EntityDestination,
): Promise<ChatTicketLinkValue | undefined> {
  const link = await deviceForm(tx, payload, existing, destination);
  return link && chatTicketLinkId(link.chatClientId, link.ticketClientId) === id ? link : undefined;
}

/** Whether the row has a pending local event (the user's edit in flight: never the server's to touch). */
async function hasPendingEvent(tx: LocalFirstTransaction, row: Pick<LocalRecord, 'id' | 'destination'>): Promise<boolean> {
  let pending = false;
  await scanPendingOfRow(tx, row.id, () => { pending = true; return SCAN_STOP; }, row.destination);
  return pending;
}

/**
 * THE ONE retire step for a MISFILED link: a live device-form link stored under an id that is not
 * its derived one (an older build stored another device's link under that device's id, `F`, and
 * the rail's ingest later rewrote it in this device's form). Beside its derived record `D` it
 * listed the ticket twice and double-counted the chat's progress. Each is retired, as the server's
 * word (server-observed tombstone, no journal event):
 *   - `D` is live: `F` is tombstoned.
 *   - `D` is missing: `D` is written from `F` (its payload, and `F`'s server mapping, so `D` is
 *     the link's mapping), then `F` is tombstoned.
 *   - `D` is a tombstone (this device unlinked the pair): `F` is tombstoned, `D` stays unlinked.
 * A row with a pending local event is skipped. Used by the rail's ingest and the pull's repair.
 * Returns how many links were retired.
 */
export async function retireMisfiledLinks(tx: LocalFirstTransaction, at: string): Promise<number> {
  const misfiled: Array<LocalRecord<ChatTicketLinkValue>> = [];
  await tx.scan<ChatTicketLinkValue>('chat-ticket-link', (row) => {
    if (row.deletedAt || !isClientFormLink(row.payload)) return;
    if (chatTicketLinkId(row.payload.chatClientId, row.payload.ticketClientId) === row.id) return;
    misfiled.push(clone(row) as LocalRecord<ChatTicketLinkValue>);
  });
  let retired = 0;
  for (const stray of misfiled) {
    if (await hasPendingEvent(tx, stray)) continue;
    const derived = chatTicketLinkId(stray.payload.chatClientId, stray.payload.ticketClientId);
    if (!(await tx.get('chat-ticket-link', derived))) {
      await tx.put({ ...clone(stray), id: derived, version: 1, provenance: serverObservedProvenance() } as LocalRecord<ChatTicketLinkValue>);
      const mapping = await tx.mapping('chat-ticket-link', stray.id, stray.destination);
      if (mapping && !(await tx.mapping('chat-ticket-link', derived, stray.destination))) {
        await tx.putMapping({
          destination: mapping.destination,
          entityType: 'chat-ticket-link',
          clientEntityId: derived,
          syncId: mapping.syncId,
          ...(mapping.serverId !== undefined ? { serverId: mapping.serverId } : {}),
          serverVersion: mapping.serverVersion,
        });
      }
    }
    await tx.put(serverObservedTombstone(stray, at));
    retired += 1;
  }
  return retired;
}

/**
 * A pulled link TOMBSTONE (the server unlinked the pair) applied to every record of this device
 * that holds the pair besides the pulled id: the client id this device maps the link's server id to,
 * and the derived id of the pair (a link another device authored lives here under it). Each live
 * one without a pending local event is tombstoned as the server's word. The caller deletes the
 * pulled id itself, as for any pulled tombstone.
 */
export async function applyPulledLinkTombstone(
  tx: LocalFirstTransaction,
  remote: Pick<LocalRecord, 'id' | 'payload' | 'destination'> & { syncId?: unknown; serverId?: unknown },
  destination: EntityDestination,
  at: string,
): Promise<void> {
  const ids = new Set<string>();
  const serverKey = parseSyncId(remote.syncId) ?? parseSyncId(remote.serverId);
  if (serverKey !== null) {
    const mapping = await tx.mappingByServerId('chat-ticket-link', serverKey, accountScopeOf(destination));
    if (mapping && parseSyncId(mapping.syncId) === serverKey) ids.add(mapping.clientEntityId);
  }
  const existing = await tx.get('chat-ticket-link', remote.id);
  const link = await deviceForm(tx, remote.payload, existing, destination);
  if (link) ids.add(chatTicketLinkId(link.chatClientId, link.ticketClientId));
  ids.delete(remote.id);
  for (const id of ids) {
    const row = await tx.get('chat-ticket-link', id);
    if (!row || row.deletedAt || await hasPendingEvent(tx, row)) continue;
    await tx.put(serverObservedTombstone(row, at));
  }
}

/**
 * Put back in the device's form every live link of `destination` an earlier pull stored in the
 * server's form. Idempotent. Left as it is: a link with a pending local event (the user's edit in
 * flight), one whose parents this device does not map, and one stored under an id that is not its
 * derived one (another device's link: the rail's ingest supplies it under the derived id). Returns
 * how many links were repaired. The record keeps its version and provenance: this is the server's
 * state re-keyed, not a local edit, so no event.
 */
export async function repairServerFormLinks(tx: LocalFirstTransaction, destination: EntityDestination): Promise<number> {
  const key = destinationKey(destination);
  const broken: LocalRecord[] = [];
  await tx.scan('chat-ticket-link', (row) => {
    if (row.deletedAt || isClientFormLink(row.payload) || destinationKey(row.destination) !== key) return;
    // The scan hands the store's own row: keep a copy.
    broken.push({ ...row });
  });
  let repaired = 0;
  for (const row of broken) {
    let pending = false;
    await scanPendingOfRow(tx, row.id, () => { pending = true; return SCAN_STOP; }, row.destination);
    if (pending) continue;
    const payload = await pulledLinkPayload(tx, row.id, row.payload, undefined, row.destination);
    if (!payload) continue;
    await tx.put({ ...row, payload });
    repaired += 1;
  }
  return repaired;
}
