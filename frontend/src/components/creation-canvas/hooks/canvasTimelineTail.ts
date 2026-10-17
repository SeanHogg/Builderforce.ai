/**
 * The canvas timeline, read incrementally.
 *
 * A `timeline.changed` frame used to re-read the WHOLE transcript — every message
 * of a long session, per frame, per collaborator. The route already pages by id
 * (`?after=`), so a frame now asks only for rows past the highest id this client
 * holds and folds them in.
 */
import { creationSessionsApi } from '@/lib/builderforceApi';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';

/** A burst bigger than this many pages is caught up by the next frame, not one call. */
const MAX_TAIL_PAGES = 5;

/** The highest server id held — the `after` cursor. An optimistic row (no id yet) does not count. */
export function timelineCursor(messages: readonly CanvasTimelineMessage[]): number {
  let max = 0;
  for (const message of messages) if (typeof message.id === 'number' && message.id > max) max = message.id;
  return max;
}

/**
 * Fold server rows into the held timeline. A row whose `clientMessageId` is already
 * held replaces it in place (the optimistic echo becomes the saved row); the rest
 * append in the order the server returned them (ascending id).
 */
export function mergeTimelineTail(current: CanvasTimelineMessage[], incoming: readonly CanvasTimelineMessage[]): CanvasTimelineMessage[] {
  if (!incoming.length) return current;
  const pending = new Map(incoming.map((message) => [message.clientMessageId, message]));
  const merged = current.map((message) => {
    const saved = pending.get(message.clientMessageId);
    if (!saved) return message;
    pending.delete(message.clientMessageId);
    return saved;
  });
  return pending.size ? [...merged, ...pending.values()] : merged;
}

/** Every row after `after`, following `hasMore` for a bounded number of pages. */
export async function fetchTimelineTail(sessionId: string, after: number): Promise<CanvasTimelineMessage[]> {
  const rows: CanvasTimelineMessage[] = [];
  let cursor = after;
  for (let page = 0; page < MAX_TAIL_PAGES; page += 1) {
    const result = await creationSessionsApi.timeline.list(sessionId, cursor);
    rows.push(...result.messages);
    if (!result.hasMore || result.lastId <= cursor) break;
    cursor = result.lastId;
  }
  return rows;
}
