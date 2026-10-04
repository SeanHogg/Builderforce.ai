/** Who is here — following a collaborator's viewport, the self id, the live member list. */
import { type RefObject, useEffect, useMemo } from 'react';
import { type LivePresenceEntry, mergeLivePresence } from '@/lib/canvas/livePresence';
import type { CreationSessionDetail, CreationSessionSummary } from '@/lib/builderforceApi';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { SharedCanvasRoom } from '@/domains/canvas/presentation/useSharedCanvasRoom';

export interface UseCanvasPresenceDeps {
  currentUserId: string | null;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  followingUserId: string | null;
  inRoom: boolean;
  livePresence: Readonly<Record<string, LivePresenceEntry>>;
  members: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  sharedRoom: SharedCanvasRoom;
}

export function useCanvasPresence({ currentUserId, flowRef, followingUserId, inRoom, livePresence, members, sharedRoom }: UseCanvasPresenceDeps) {
  /**
   * Follow, driven live. The poll's copy of this only runs when the relay is down,
   * so a follower moves WITH the person they are following rather than catching up
   * to where they were.
   */
  const followedViewport = followingUserId ? livePresence[followingUserId]?.viewport : undefined;
  useEffect(() => {
    if (!followedViewport) return;
    void flowRef.current?.setViewport(followedViewport, { duration: 120 });
  }, [flowRef, followedViewport]);

  /**
   * Who "you" are in the live roster. A saved board keys the viewer by account; an
   * account-less guest room keys every person by `guestRoomOccupantId`, so the viewer
   * is the room's own answer (`sharedRoom.selfId`).
   */
  const presenceSelfId = inRoom ? sharedRoom.selfId : currentUserId;
  /**
   * One roster to draw. Identity (name, role) comes from the poll — or, in a guest
   * room, from the room's roster; position comes from the relay. Merging rather than
   * keeping two lists is why a name and a pointer can never disagree — see
   * `lib/canvas/livePresence`. (Unretracted pointers are retired by `useLivePresence`.)
   */
  const liveMembers = useMemo(
    () => mergeLivePresence<CreationSessionDetail['members'][number]>(inRoom ? sharedRoom.roster : members, livePresence, presenceSelfId),
    [inRoom, livePresence, members, presenceSelfId, sharedRoom.roster],
  );
  return { liveMembers, presenceSelfId };
}
