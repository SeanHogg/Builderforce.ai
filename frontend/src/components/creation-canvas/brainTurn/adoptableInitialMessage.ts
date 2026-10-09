import type { CanvasTimelineMessage } from '../canvasBoardTypes';

/**
 * The board's seeded first message (`initial:` / `claim:`) that a turn sending `requestText`
 * ADOPTS as its own request, instead of adding a second copy of it.
 *
 * Only while it is still unanswered. Every reply a turn writes is keyed off the request id
 * (`<id>:assistant`, `<id>:unanswered`, `<id>:error`…), so a later turn that re-sent the
 * same text reused that id, and its answer was dropped as a duplicate of the first one
 * (session `local-148925cf`: a sixteen-step build turn ended with no reply at all).
 */
export function adoptableInitialMessage(timeline: readonly CanvasTimelineMessage[], requestText: string): CanvasTimelineMessage | undefined {
  const answered = (id: string) => timeline.some((message) => message.clientMessageId.startsWith(`${id}:`));
  return timeline.find((message) => (message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'))
    && message.body === requestText
    && !answered(message.clientMessageId));
}
