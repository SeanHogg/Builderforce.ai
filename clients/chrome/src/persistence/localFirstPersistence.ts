/**
 * The Brain loop's persistence port, LOCAL FIRST: a turn or step row is written to the
 * device record (`RovrRecords`) and handed to the sync outbox — in that order, and the
 * run never waits on the network. Offline, a conversation is exactly as complete on
 * screen as online; it reaches the platform chat when the connection does.
 *
 * Layering with the shared step outbox (brain-embedded `stepOutbox.ts`): the loop wraps
 * this port in its batched, durable step queue (installed per host with
 * `installIndexedDbStepDurability`). For Rovr THIS port is that queue's sender, and it is
 * always reachable — so the step queue is given an always-online signal, and the network
 * connectivity gates the ONE place that talks to the network, the sync outbox.
 */
import type { BrainMessage, BrainRunPersistence } from '@seanhogg/builderforce-brain-embedded';
import type { MessageInput, RovrRecords } from '../store/records';
import type { SyncSink } from '../sync/runtimeMessages';

export function createLocalFirstPersistence(records: RovrRecords, sink: SyncSink): BrainRunPersistence {
  return {
    async sendMessages(chatId: number, messages: MessageInput[]): Promise<BrainMessage[]> {
      // Rows arriving from the step queue carry its `eventKey`; the sync outbox mints its
      // own per entry, so only the row itself is kept.
      const rows = messages.map(({ role, content, metadata }) => ({ role, content, ...(metadata !== undefined ? { metadata } : {}) }));
      const saved = await records.appendMessages(chatId, rows);
      sink.enqueue(chatId, rows.map((row) => ({ kind: 'message' as const, row })));
      return saved;
    },
  };
}
