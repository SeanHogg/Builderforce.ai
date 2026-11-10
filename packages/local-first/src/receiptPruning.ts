/**
 * Receipts a compacted base no longer needs (2026-11-10).
 *
 * The coordinator keeps one `SyncReceipt` per event the server answered, forever: a drained
 * history of 88k imports left 88k receipts (21.5 MB) in the base, parsed on every open, beside the
 * 88k mappings that already say the same thing. Every status read derives a row's status from its
 * MAPPING when it has no pending event and no receipt (`syncStatus.ts` rule 5: mapped ⇒ synced) —
 * in this build and in older ones, whose `deriveRecordSyncStatus` is identical — so a settled
 * receipt of a row the server imported is redundant: dropping it changes no status anywhere.
 *
 * A receipt is pruned only when ALL hold:
 *   - it is settled (`accepted` / `duplicate`) and names its row (`entityType` + `clientEntityId`);
 *   - the row has an IMPORTED mapping (server version ≥ 1) — the same test the status reads use;
 *   - the row has no pending event (a pending event's status reads its receipt);
 *   - EVERY receipt of that row is settled (a rejected / conflict / held receipt beside it would
 *     decide differently without the settled one).
 * The newest settled receipt of the whole store is always kept: it is "the last time the platform
 * took a push" (`clients/vscode/src/sync/syncSummary.ts`).
 *
 * Pure. The compaction writes the pruned snapshot as the new base.
 */

import type { LocalFirstSnapshot } from './storeContract.js';
import type { SyncReceipt } from './records.js';
import { isImported } from './journalRules.js';

const rowKey = (entityType: string, clientEntityId: string): string => `${entityType}\u0000${clientEntityId}`;
const settles = (receipt: SyncReceipt): boolean => receipt.status === 'accepted' || receipt.status === 'duplicate';

export function pruneSettledReceipts<S extends Pick<LocalFirstSnapshot, 'receipts' | 'mappings' | 'events'>>(snapshot: S): S {
  if (snapshot.receipts.length === 0) return snapshot;
  const imported = new Set<string>();
  for (const mapping of snapshot.mappings) {
    if (isImported(mapping)) imported.add(rowKey(mapping.entityType, mapping.clientEntityId));
  }
  const pendingRows = new Set(snapshot.events.map((event) => rowKey(event.entityType, event.clientEntityId)));
  const unsettledRows = new Set<string>();
  for (const receipt of snapshot.receipts) {
    if (!settles(receipt) && receipt.entityType && receipt.clientEntityId) unsettledRows.add(rowKey(receipt.entityType, receipt.clientEntityId));
  }
  let newest: SyncReceipt | undefined;
  for (const receipt of snapshot.receipts) {
    if (settles(receipt) && (!newest || receipt.receivedAt > newest.receivedAt)) newest = receipt;
  }
  const kept = snapshot.receipts.filter((receipt) => {
    if (receipt === newest || !settles(receipt) || !receipt.entityType || !receipt.clientEntityId) return true;
    const row = rowKey(receipt.entityType, receipt.clientEntityId);
    return !imported.has(row) || pendingRows.has(row) || unsettledRows.has(row);
  });
  return kept.length === snapshot.receipts.length ? snapshot : { ...snapshot, receipts: kept };
}
