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

import { SCAN_STOP, dropPending, isOwnRecord, queueImport, type EntityDestination, type LocalFirstStore, type LocalFirstTransaction, type LocalRecord } from '@builderforce/local-first';
import type { ChatValue, MessageValue } from './records';
import { syncsToPlatform } from './gateLedger';
import type { RunUsageValue } from './usageLedger';

/** Move this device's unbound chat rows into `destination`. Returns how many chats moved. */
export async function bindChatHistoryForSync(store: LocalFirstStore, deviceId: string, destination: EntityDestination): Promise<number> {
  if (destination.kind !== 'bound') return 0;
  const unbound = (row: Readonly<LocalRecord>): boolean => row.destination.kind === 'unbound' && isOwnRecord(row, deviceId);
  // Read first: a commit notifies every store subscriber — the sync trigger among them —
  // so a pass with nothing to move must not write. A scan, not a copy of every row.
  const anything = await store.read(async (tx) => {
    let found = false;
    for (const type of ['chat', 'message', 'usage'] as const) {
      if (found) break;
      await tx.scan(type, (row) => { if (unbound(row)) { found = true; return SCAN_STOP; } });
    }
    return found;
  });
  if (!anything) return 0;
  const rebind = async <T>(tx: LocalFirstTransaction, row: LocalRecord<T>): Promise<LocalRecord<T>> => {
    const moved = { ...row, destination };
    await tx.put(moved);
    return moved;
  };
  // Chats first, so each message and usage import can wait on its chat's.
  const chats = await bindInSlices<ChatValue>(store, 'chat', unbound, async (tx, chat) => {
    await queueImport(tx, await rebind(tx, chat));
  });
  await bindInSlices<MessageValue>(store, 'message', unbound, async (tx, message) => {
    await queueImport(tx, await rebind(tx, message), message.payload.chatClientId);
  });
  await bindInSlices<RunUsageValue>(store, 'usage', unbound, async (tx, usage) => {
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

/** Bind every row of `type` that `select` accepts, `BIND_SLICE` rows per commit. Returns the rows bound. */
async function bindInSlices<T>(
  store: LocalFirstStore,
  type: 'chat' | 'message' | 'usage',
  select: (row: Readonly<LocalRecord>) => boolean,
  bind: (tx: LocalFirstTransaction, row: LocalRecord<T>) => Promise<void>,
): Promise<LocalRecord<T>[]> {
  const bound: LocalRecord<T>[] = [];
  for (;;) {
    const slice = await store.transact(async (tx) => {
      const rows: LocalRecord<T>[] = [];
      await tx.scan<T>(type, (row) => {
        if (!select(row as Readonly<LocalRecord>)) return;
        rows.push(row as LocalRecord<T>);
        if (rows.length >= BIND_SLICE) return SCAN_STOP;
      });
      // Cloned before the first write: the scan handed over the store's own rows.
      const copies = structuredClone(rows);
      for (const row of copies) await bind(tx, row);
      return copies;
    });
    bound.push(...slice);
    if (slice.length < BIND_SLICE) return bound;
  }
}
