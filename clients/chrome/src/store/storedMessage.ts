import type { BrainMessage, KeyedSlot } from '@seanhogg/builderforce-brain-embedded';
import type { MessageInput } from './records';

/** A stored message as callers see it: without the store's own bookkeeping (`chatId`, `eventKey`). */
export function publicMessage({ chatId: _c, eventKey: _k, ...message }: BrainMessage & { chatId: number; eventKey?: string }): BrainMessage {
  return message;
}

/** What an append did: the rows as saved (request order), and which of the REQUESTED rows were stored now - a row sent again under its key is not. */
export interface AppendResult {
  messages: BrainMessage[];
  written: MessageInput[];
}

/**
 * THE answer to an append, for both Rovr stores: each keyed slot (`slotKeyedRows`) becomes the saved row it stands for -
 * a known key the row saved before, a repeat within the batch the earlier row, a new one what `store` wrote - in request
 * order, and the rows actually written are told apart from those that were not (the sync outbox sends only the former).
 */
export function assembleAppend<R extends MessageInput, P>(
  slots: ReadonlyArray<KeyedSlot<R, P>>,
  known: (prior: P) => BrainMessage,
  store: (row: R, key: string | undefined) => BrainMessage,
): AppendResult {
  const messages: BrainMessage[] = [];
  const written: MessageInput[] = [];
  for (const slot of slots) {
    if (slot.kind === 'known') messages.push(known(slot.prior));
    else if (slot.kind === 'repeat') messages.push(messages[slot.of]!);
    else {
      messages.push(store(slot.row, slot.key));
      written.push(slot.row);
    }
  }
  return { messages, written };
}
