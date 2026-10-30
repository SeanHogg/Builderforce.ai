import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';

/** A stored message as callers see it: without the store's own bookkeeping (`chatId`, `eventKey`). */
export function publicMessage({ chatId: _c, eventKey: _k, ...message }: BrainMessage & { chatId: number; eventKey?: string }): BrainMessage {
  return message;
}
