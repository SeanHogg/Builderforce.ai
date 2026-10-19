/**
 * G14: a domain write and its sync enqueue commit together.
 *
 * `store.transact` is the only commit boundary. `put` runs before `append`,
 * so a put failure never enqueues. If append throws, the transaction rejects
 * before the store publishes the draft, so the put is not committed either.
 */

import type { JournalEvent, LocalRecord } from './records.js';
import type { LocalFirstStore } from './store.js';

export type EnqueueEvent<T = unknown> = Omit<JournalEvent<T>, 'localSequence' | 'payloadHash'> & {
  payloadHash?: string;
};

export function commitWriteAndEnqueue<TRecord = unknown, TEvent = unknown>(
  store: LocalFirstStore,
  record: LocalRecord<TRecord>,
  event: EnqueueEvent<TEvent>,
): Promise<JournalEvent<TEvent>> {
  return store.transact(async (tx) => {
    await tx.put(record);
    return tx.append(event);
  });
}
