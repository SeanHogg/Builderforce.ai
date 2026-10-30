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
      // A row's `eventKey` (the step queue's, a steered message's) is KEPT: the device store saves a repeated key
      // as the same row, and the sync outbox sends the row under it, so the server upserts a late save and its retry as one.
      const rows = messages.map(({ role, content, metadata, eventKey }) => ({ role, content, ...(metadata !== undefined ? { metadata } : {}), ...(eventKey ? { eventKey } : {}) }));
      const { messages: saved, written } = await records.appendMessages(chatId, rows);
      // Only the rows STORED now go to the outbox: a row that came back as a known one (saved before under its key) is
      // already there, and a second entry for it is a second send of the same message.
      if (written.length > 0) sink.enqueue(chatId, written.map((row) => ({ kind: 'message' as const, row })));
      return saved;
    },
  };
}
