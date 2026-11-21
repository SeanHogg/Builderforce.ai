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
 * - A link an OLDER build already stored under another device's id is moved to its derived id and
 *   the stray retired ({@link retireMisfiledLinks}, the one retire step the rail's ingest and the
 *   pull's repair share); a pulled unlink reaches the pair under every id it lives at here
 *   ({@link applyPulledLinkTombstone}).
 */

import { chatTicketLinkId } from './chatTicketLink.js';
import { clone } from './clone.js';
import { parseSyncId, syncIdText } from './entityId.js';
import { scanPendingOfRow } from './pendingQueries.js';
import { accountScopeOf, destinationKey, type ChatTicketLinkType, type ChatTicketLinkValue, type EntityDestination, type EntityScope, type LocalRecord } from './records.js';
import { SCAN_STOP, type LocalFirstTransaction } from './storeContract.js';
import { serverObservedProvenance, serverObservedTombstone } from './tombstone.js';

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

/**
 * The id this device derives for a pulled link the pull REFUSED to store (its own pair, in its own
 * ids), or undefined when its chat or ticket is not mapped here. The refused link's server mapping
 * is written under it, never under the pulled id (another device's), so a later unlink naming that
 * server key reaches this device's copy.
 */
export async function derivedIdOfPulledLink(
  tx: LocalFirstTransaction,
  payload: unknown,
  existing: Pick<LocalRecord, 'payload'> | undefined,
  destination: EntityDestination,
): Promise<string | undefined> {
  const link = await deviceForm(tx, payload, existing, destination);
  return link ? chatTicketLinkId(link.chatClientId, link.ticketClientId) : undefined;
}

/**
 * Whether a journal event is LIVE work (the user's edit in flight): dead letters are not. THE one
 * definition every pending check of the link code shares (the pull's merge, the ingest, the retire step).
 */
export const isLivePendingEvent = (event: { deadLetter?: unknown }): boolean => !event.deadLetter;

/** Whether row `id` has a live pending local event (never the server's to touch). */
export async function hasLivePendingOfRow(tx: LocalFirstTransaction, id: string, destination?: EntityDestination): Promise<boolean> {
  let pending = false;
  await scanPendingOfRow(tx, id, (event) => {
    if (!isLivePendingEvent(event)) return undefined;
    pending = true;
    return SCAN_STOP;
  }, destination);
  return pending;
}

const hasPendingEvent = (tx: LocalFirstTransaction, row: Pick<LocalRecord, 'id' | 'destination'>): Promise<boolean> =>
  hasLivePendingOfRow(tx, row.id, row.destination);

/**
 * THE ONE retire step for a MISFILED link: a live device-form link stored under an id that is not
 * its derived one (an older build stored another device's link under that device's id, `F`, and
 * the rail's ingest later rewrote it in this device's form). Beside its derived record `D` it
 * listed the ticket twice and double-counted the chat's progress. Each is retired, as the server's
 * word (server-observed tombstone, no journal event):
 *   - `D` is live: `F` is tombstoned.
 *   - `D` is missing: `D` is written from `F` (its payload, and `F`'s server mapping, so `D` is
 *     the link's mapping), then `F` is tombstoned.
 *   - `D` is a tombstone (this device unlinked the pair): `F` is tombstoned and `D` stays unlinked,
 *     UNLESS `F` is newer than the unlink and `D` has no pending event: the pair was linked again
 *     after the unlink, so `F` revives `D` (moved into it, as when `D` is missing).
 * A row with a pending local event is skipped. Used by the rail's ingest and the pull's repair.
 * `pairs` narrows the retire to the strays of those derived ids (the ingest checks only the pairs it
 * wrote). Returns how many links were retired.
 */
export async function retireMisfiledLinks(tx: LocalFirstTransaction, at: string, pairs?: ReadonlySet<string>): Promise<number> {
  if (pairs && pairs.size === 0) return 0;
  const misfiled: Array<LocalRecord<ChatTicketLinkValue>> = [];
  await tx.scan<ChatTicketLinkValue>('chat-ticket-link', (row) => {
    if (row.deletedAt || !isClientFormLink(row.payload)) return;
    const derivedId = chatTicketLinkId(row.payload.chatClientId, row.payload.ticketClientId);
    if (derivedId === row.id || (pairs && !pairs.has(derivedId))) return;
    misfiled.push(clone(row) as LocalRecord<ChatTicketLinkValue>);
  });
  let retired = 0;
  for (const stray of misfiled) {
    if (await hasPendingEvent(tx, stray)) continue;
    const derived = chatTicketLinkId(stray.payload.chatClientId, stray.payload.ticketClientId);
    const held = await tx.get('chat-ticket-link', derived);
    const revives = held !== undefined && typeof held.deletedAt === 'string'
      && Date.parse(stray.updatedAt) > Date.parse(held.deletedAt)
      && !(await hasPendingEvent(tx, held));
    if (!held || revives) {
      const { baseVersion: _base, ...moved } = clone(stray);
      void _base;
      await tx.put<ChatTicketLinkValue>({ ...moved, id: derived, version: held ? held.version + 1 : 1, provenance: serverObservedProvenance() });
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
 *
 * The record behind EVERY mapping of the account carrying the link's server key is reached (not only
 * the earliest mapping: a refused pull of another device's id may have mapped that id first), and so
 * is every live link of the same PAIR (a stray under another id): left live, the retire step would
 * move it into the pair's just-deleted record and the unlinked pair would reappear. The pulled
 * tombstone's payload is the server's `{ removed: true }`, so the pair is read off the records.
 */
export async function applyPulledLinkTombstone(
  tx: LocalFirstTransaction,
  remote: Pick<LocalRecord, 'id' | 'payload' | 'destination'> & { syncId?: unknown; serverId?: unknown },
  destination: EntityDestination,
  at: string,
): Promise<void> {
  const ids = new Set<string>();
  /** The pair ids (derived) the unlinked link stands for; the pulled id itself may be one. */
  const pairs = new Set<string>([remote.id]);
  const scopeText = JSON.stringify(accountScopeOf(destination) ?? null);
  const live: Array<{ id: string; destination: EntityDestination; pair?: string }> = [];
  await tx.scan<ChatTicketLinkValue>('chat-ticket-link', (row) => {
    if (row.deletedAt) return;
    live.push({
      id: row.id,
      destination: row.destination,
      ...(isClientFormLink(row.payload) ? { pair: chatTicketLinkId(row.payload.chatClientId, row.payload.ticketClientId) } : {}),
    });
  });
  const serverKey = parseSyncId(remote.syncId) ?? parseSyncId(remote.serverId);
  if (serverKey !== null) {
    for (const row of live) {
      if (JSON.stringify(accountScopeOf(row.destination) ?? null) !== scopeText) continue;
      const mapping = await tx.mapping('chat-ticket-link', row.id, row.destination);
      // A link's server key may be mapped as its SyncId or (a rail-ingested link) its id text only.
      if (mapping && (parseSyncId(mapping.syncId) ?? parseSyncId(mapping.serverId)) === serverKey) {
        ids.add(row.id);
        pairs.add(row.pair ?? row.id);
      }
    }
  }
  const existing = await tx.get('chat-ticket-link', remote.id);
  const link = await deviceForm(tx, remote.payload, existing, destination);
  if (link) {
    const pair = chatTicketLinkId(link.chatClientId, link.ticketClientId);
    ids.add(pair);
    pairs.add(pair);
  }
  for (const row of live) {
    if (row.pair !== undefined && pairs.has(row.pair)) ids.add(row.id);
  }
  ids.delete(remote.id);
  for (const id of ids) {
    const row = await tx.get('chat-ticket-link', id);
    if (!row || row.deletedAt || await hasPendingEven