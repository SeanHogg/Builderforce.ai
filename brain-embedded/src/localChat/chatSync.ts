/**
 * SYNC ON ENABLE, the chat slice (PRD 36 §36.4) — hand this device's local chats to the
 * account once the person has turned sync on.
 *
 * A chat written offline lives in the unbound partition, which the coordinator never
 * sends. This moves every unbound chat, message and usage row of this device into the
 * account's destination and replaces its offline journal with ONE import per row
 * (`journal.ts`): the server receives the chat's history as it is now, not as a replay
 * of every edit it went through — so a chat that was bound by sign-in is adopted rather
 * than duplicated, and a retry is the same import, deduplicated by the server.
 *
 * Gateway usage rows move with their chat but are never sent: the gateway logged them.
 * Idempotent: a second pass finds nothing unbound.
 */

import type { EntityDestination, LocalFirstStore, LocalRecord } from '@builderforce/local-first';
import { queueImport } from './journal';
import { isOwnRecord, type ChatValue, type MessageValue } from './records';
import type { RunUsageValue } from './usageLedger';

/** Move this device's unbound chat rows into `destination`. Returns how many chats moved. */
export async function bindChatHistoryForSync(store: LocalFirstStore, deviceId: string, destination: EntityDestination): Promise<number> {
  if (destination.kind !== 'bound') return 0;
  return store.transact(async (tx) => {
    const unbound = <T>(rows: LocalRecord<T>[]) => rows.filter((row) => row.destination.kind === 'unbound' && isOwnRecord(row, deviceId));
    const rebind = async <T>(row: LocalRecord<T>): Promise<LocalRecord<T>> => {
      const moved = { ...row, destination };
      await tx.put(moved);
      return moved;
    };
    const chats = unbound(await tx.list<ChatValue>('chat'));
    // Chats first, so each message and usage import can wait on its chat's.
    for (const chat of chats) await queueImport(tx, await rebind(chat));
    for (const message of unbound(await tx.list<MessageValue>('message'))) {
      await queueImport(tx, await rebind(message), message.payload.chatClientId);
    }
    for (const usage of unbound(await tx.list<RunUsageValue>('usage'))) {
      const moved = await rebind(usage);
      if (usage.payload.route !== 'gateway') await queueImport(tx, moved, usage.payload.clientChatId);
    }
    return chats.filter((chat) => !chat.deletedAt).length;
  });
}
