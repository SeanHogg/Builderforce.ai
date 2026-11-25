/**
 * THE REST RECONCILE SOURCE — a board's server copy, read through the calls the canvas has always
 * made (`creationSessionsApi.get` + `timeline.list`), handed to `boardOpen` as a `ServerBoardSnapshot`.
 *
 * This is the one module that changes when `/api/sync/v1/pull` can serve boards (design §2). It also
 * reports each fresh server detail (role, roster, personal viewport — facts about the SESSION that are
 * not board records) to the caller, so opening a board is one read of the server, not two.
 */

import { normalizeChatMode } from '@/lib/brain';
import { creationSessionsApi, type CreationSessionDetail } from '@/lib/builderforceApi';
import type { BoardReconcileSource } from './boardOpen';
import type { ServerBoardSnapshot } from './boardRecords';

export interface RestBoardSourceHooks {
  /** The session facts of each read: role, roster, personal viewport. */
  onDetail?: (detail: CreationSessionDetail) => void;
  /** The snapshot each read produced, before it is reconciled (the place held conflicts are captured). */
  onSnapshot?: (snapshot: ServerBoardSnapshot) => Promise<unknown>;
}

export function createRestBoardSource({ onDetail, onSnapshot }: RestBoardSourceHooks = {}): BoardReconcileSource {
  return {
    async read(boardId: string): Promise<ServerBoardSnapshot> {
      const [detail, transcript] = await Promise.all([creationSessionsApi.get(boardId), creationSessionsApi.timeline.list(boardId)]);
      onDetail?.(detail);
      const snapshot: ServerBoardSnapshot = {
        id: detail.session.id,
        title: detail.session.title,
        mode: normalizeChatMode(detail.session.mode),
        // `canvasRevision` is the board's; `revision` counts everything the session has ever done.
        revision: detail.session.canvasRevision ?? detail.session.revision ?? 1,
        graph: { objects: detail.objects, connections: detail.connections },
        timeline: transcript.messages.map((message) => ({
          clientMessageId: message.clientMessageId,
          role: message.messageRole,
          body: message.body,
          ...(message.metadata ? { metadata: message.metadata } : {}),
          createdAt: message.createdAt,
        })),
      };
      await onSnapshot?.(snapshot);
      return snapshot;
    },
  };
}
