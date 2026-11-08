/**
 * SYNC ON ENABLE, the work slice — hand this device's projects and tickets to the account.
 *
 * The editor's agent files tickets LOCALLY (`ticket-create` writes the device store; no
 * API call per ticket). Those rows sit in the unbound partition, which the coordinator
 * never sends. Beside the chat history (`chatSync.ts`), this moves every unbound project
 * and ticket of this device into the account's destination and replaces its offline
 * journal with ONE import per row — so a program of 26 tickets is one batched push, not
 * 52 tool calls. A retry is the same import, deduplicated by the server.
 *
 * Order is what makes the server's `dependency_pending` hold only briefly: each ticket
 * import waits on its local project's, its local parent ticket's and — when it names the
 * chat it was created in — that chat's (`chatClientId`; the chats are queued first by
 * `bindChatHistoryForSync`, which the same pass runs before this). A parent is queued
 * before its children. A DECIMAL project / parent id is a server reference: nothing local
 * to wait for.
 *
 * Idempotent: a second pass finds nothing unbound.
 */

import { importKey, isOwnRecord, queueImport } from './journalRules.js';
import { chatTicketLinkWaitsOn } from './chatTicketLink.js';
import type { ChatTicketLinkValue, EntityDestination, LocalRecord, ProjectValue, TicketValue } from './records.js';
import { SCAN_STOP, selectRecords, type LocalFirstStore } from './store.js';

const SERVER_REFERENCE = /^\d+$/;

/** The import keys a ticket must follow: its local project, its local parent. */
export function ticketWaitsOn(ticket: TicketValue): string[] {
  const waits: string[] = [];
  if (!SERVER_REFERENCE.test(ticket.projectId.trim())) waits.push(importKey('project', ticket.projectId));
  const parent = ticket.parentTicketId?.trim();
  if (parent && !SERVER_REFERENCE.test(parent)) waits.push(importKey('ticket', parent));
  return waits;
}

/** Parents before children: ascending depth along `parentTicketId` among the rows being moved. */
function parentsFirst(tickets: readonly LocalRecord<TicketValue>[]): LocalRecord<TicketValue>[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const depths = new Map<string, number>();
  const depthOf = (ticket: LocalRecord<TicketValue>, seen: ReadonlySet<string> = new Set()): number => {
    const known = depths.get(ticket.id);
    if (known !== undefined) return known;
    const parent = ticket.payload.parentTicketId ? byId.get(ticket.payload.parentTicketId) : undefined;
    // A cycle cannot be ordered; treat the repeat as a root rather than recurse forever.
    const depth = parent && !seen.has(parent.id) ? depthOf(parent, new Set([...seen, ticket.id])) + 1 : 0;
    depths.set(ticket.id, depth);
    return depth;
  };
  return [...tickets].sort((a, b) => depthOf(a) - depthOf(b) || a.occurredAt.localeCompare(b.occurredAt));
}

/** Move this device's unbound project and ticket rows into `destination`. Returns how many rows moved. */
export async function bindWorkForSync(store: LocalFirstStore, deviceId: string, destination: EntityDestination): Promise<number> {
  if (destination.kind !== 'bound') return 0;
  const unbound = (row: Readonly<LocalRecord>): boolean => row.destination.kind === 'unbound' && isOwnRecord(row, deviceId);
  // Read first: a commit notifies every store subscriber — the sync trigger among them —
  // so a pass with nothing to move must not write.
  const anything = await store.read(async (tx) => {
    let found = false;
    for (const type of ['project', 'ticket', 'chat-ticket-link'] as const) {
      if (found) break;
      await tx.scan(type, (row) => { if (unbound(row)) { found = true; return SCAN_STOP; } });
    }
    return found;
  });
  if (!anything) return 0;
  return store.transact(async (tx) => {
    const rebind = async <T>(row: LocalRecord<T>): Promise<LocalRecord<T>> => {
      const moved = { ...row, destination };
      await tx.put(moved);
      return moved;
    };
    let moved = 0;
    // Projects first, so each ticket import can wait on its project's.
    for (const project of await selectRecords<ProjectValue>(tx, 'project', unbound)) {
      await queueImport(tx, await rebind(project));
      moved += 1;
    }
    for (const ticket of parentsFirst(await selectRecords<TicketValue>(tx, 'ticket', unbound))) {
      await queueImport(tx, await rebind(ticket), ticket.payload.chatClientId, ticketWaitsOn(ticket.payload));
      moved += 1;
    }
    // Links last: each waits on its chat's and its ticket's import.
    for (const link of await selectRecords<ChatTicketLinkValue>(tx, 'chat-ticket-link', unbound)) {
      await queueImport(tx, await rebind(link), undefined, chatTicketLinkWaitsOn(link.payload));
      moved += 1;
    }
    return moved;
  });
}
