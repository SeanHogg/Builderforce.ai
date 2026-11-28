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

import { SCAN_STOP, dropPending, isOwnRecord, isOwnStub, queueImport, type EntityDestination, type LocalFirstStore, type LocalFirstTransaction, type LocalRecord } from '@builderforce/local-first';
import type { ChatValue, MessageValue } from './records';
import { syncsToPlatform } from './gateLedger';
import type { RunUsageValue } from './usageLedger';

/** Move this device's unbound chat rows into `destination`. Returns how many chats moved. */
export async function bindChatHistoryForSync(store: LocalFirstStore, deviceId: string, destination: EntityDestination): Promise<number> {
  if (destination.kind !== 'bound') return 0;
  // Read first: a commit notifies every store subscriber — the sync trigger among them —
  // so a pass with nothing to move must not write. One unbound row of any type is the answer.
  const anything = await store.read(async (tx) => {
    for (const type of BIND_TYPES) {
      if ((await unboundRows(tx, type, deviceId, 1)).length > 0) return true;
    }
    return false;
  });
  if (!anything) return 0;
  const rebind = async <T>(tx: LocalFirstTransaction, row: LocalRecord<T>): Promise<LocalRecord<T>> => {
    const moved = { ...row, destination };
    await tx.put(moved);
    return moved;
  };
  // Chats first, so each message and usage import can wait on its chat's.
  const chats = await bindInSlices<ChatValue>(store, 'chat', deviceId, async (tx, chat) => {
    await queueImport(tx, await rebind(tx, chat));
  });
  await bindInSlices<MessageValue>(store, 'message', deviceId, async (tx, message) => {
    await queueImport(tx, await rebind(tx, message), message.payload.chatClientId);
  });
  await bindInSlices<RunUsageValue>(store, 'usage', deviceId, async (tx, usage) => {
    const moved = await rebind(tx, usage);
    if (syncsToPlatform(usage.payload)) await queueImport(tx, moved, usage.payload.clientChatId);
    // A gateway row is never sent (the gateway logged it): its offline events would stay pending
    // forever in a partition nothing sends, so they go with the move.
    else await dropPending(tx, moved);
  });
  return chats.filter((chat) => !chat.deletedAt).length;
}

/**
 * Rows bound per commit. A long-offline history is tens of thousands of rows: ONE transaction
 * over all of them is one frame of the whole history (hundreds of MB to encode on the editor's
 * thread) and holds the writer for the whole bind. Each slice is a whole commit, so a bind cut
 * short resumes where it stopped — the next pass finds only the rows still unbound.
 */
const BIND_SLICE = 1000;

const BIND_TYPES = ['chat', 'message', 'usage'] as const;

/**
 * Up to `limit` of this device's unbound rows of `type`, cloned. Through the type's STUBS when
 * the store has them (a partitioned type: choose by `unbound`, then `get` only the chosen rows,
 * so only the chats being bound are loaded); otherwise one scan of the rows.
 */
async function unboundRows<T>(tx: LocalFirstTransaction, type: (typeof BIND_TYPES)[number], deviceId: string, limit: number): Promise<LocalRecord<T>[]> {
  const ids: string[] = [];
  let sawStubs = false;
  await tx.scanStubs?.(type, (stub) => {
    sawStubs = true;
    if (!stub.unbound || !isOwnStub(stub, deviceId)) return undefined;
    ids.push(stub.id);
    return ids.length >= limit ? SCAN_STOP : undefined;
  });
  if (sawStubs) {
    const rows: LocalRecord<T>[] = [];
    for (const id of ids) {
      const row = await tx.get<T>(type, id);
      if (row) rows.push(row);
    }
    return rows;
  }
  const rows: LocalRecord<T>[] = [];
  await tx.scan<T>(type, (row) => {
    if (row.destination.kind !== 'unbound' || !isOwnRecord(row as LocalRecord, deviceId)) return undefined;
    rows.push(row as LocalRecord<T>);
    return rows.length >= limit ? SCAN_STOP : undefined;
  });
  // Cloned before the first write: the scan handed over the store's own rows.
  return structuredClone(rows);
}

/** Bind every unbound row of `type` of this device, `BIND_SLICE` rows per commit. Returns the rows bound. */
async function bindInSlices<T>(
  store: LocalFirstStore,
  type: (typeof BIND_TYPES)[number],
  deviceId: string,
  bind: (tx: LocalFirstTransaction, row: LocalRecord<T>) => Promise<void>,
): Promise<LocalRecord<T>[]> {
  const bound: LocalRecord<T>[] = [];
  for (;;) {
    const slice = await store.transact(async (tx) => {
      const copies = await unboundRows<T>(tx, type, deviceId, BIND_SLICE);
      for (const row of copies) await bind(tx, row);
      return copies;
    });
    bound.push(...slice);
    if (slice.length < BIND_SLICE) return bound;
  }
}
