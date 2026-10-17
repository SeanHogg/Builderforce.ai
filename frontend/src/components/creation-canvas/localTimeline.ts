/**
 * The transcript in the two shapes it lives in: the board's (`CanvasTimelineMessage`,
 * `messageRole`) and a device-only board's stored snapshot (`LocalCreationSnapshot`,
 * `role`). ONE pair of mappers, so the load, the save, the room adoption and the
 * off-screen settle (`sessionBoardWriters`) cannot drift apart field by field.
 */
import type { LocalCreationSnapshot } from '@/domains/canvas/infrastructure/localCanvasStore';
import type { CanvasTimelineMessage } from './canvasBoardTypes';

type LocalTimeline = NonNullable<LocalCreationSnapshot['timeline']>;

export function timelineFromLocal(stored: LocalCreationSnapshot['timeline']): CanvasTimelineMessage[] {
  return (stored ?? []).map((message) => ({
    clientMessageId: message.clientMessageId,
    messageRole: message.role,
    body: message.body,
    metadata: message.metadata ?? {},
    createdAt: message.createdAt,
  }));
}

export function timelineToLocal(timeline: readonly CanvasTimelineMessage[]): LocalTimeline {
  return timeline.map((message) => ({
    clientMessageId: message.clientMessageId,
    role: message.messageRole,
    body: message.body,
    metadata: message.metadata,
    createdAt: message.createdAt,
  }));
}
