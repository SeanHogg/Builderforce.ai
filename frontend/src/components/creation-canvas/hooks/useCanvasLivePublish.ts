/** Publishing this board's anchor and presence into the live session around it. */
import { useEffect } from 'react';
import { getGuestDisplayName, guestMediaTransport } from '@/lib/guestRoomApi';
import type { LiveSessionValue } from '@/lib/live/LiveSessionContext';
import type { SharedCanvasRoom } from '@/domains/canvas/presentation/useSharedCanvasRoom';
import type { useTranslations } from 'next-intl';
import type { CreationSessionSummary } from '@/lib/builderforceApi';

export interface UseCanvasLivePublishDeps {
  currentUserId: string | null;
  liveSession: LiveSessionValue | null;
  members: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  persistence: 'local' | 'server';
  sharedRoom: SharedCanvasRoom;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasLivePublish({ currentUserId, liveSession, members, persistence, sharedRoom, t }: UseCanvasLivePublishDeps) {
  /**
   * The board is the source of truth for WHO IS ON IT; the shell is the source of
   * truth for who is on the CALL. Publishing the roster upward is what lets the
   * live bar show one set of people instead of the board and the room each
   * keeping their own — and it is why a teammate who navigates away from the
   * board does not vanish from the call.
   */
  /**
   * A logged-out board that has started a shared free session IS a room — it has a
   * guest room code and the guest media transport that `GuestRoomMeeting` has used
   * since guest rooms shipped. Nothing on the canvas could reach it, so the free
   * board was the one surface where people could work on the same thing and had no
   * way to talk about it. Declaring the anchor is all it takes: `useCanvasLiveRoom`
   * owns the decision and the bar's own `call` action is the control — the same one
   * every signed-in canvas uses, so the free board gains a call rather than a second
   * way of starting one.
   */
  const publishAnchor = liveSession?.publishAnchor;
  useEffect(() => {
    if (!publishAnchor) return undefined;
    if (persistence !== 'local' || !sharedRoom.code) { publishAnchor(null); return undefined; }
    publishAnchor({
      roomKey: sharedRoom.code,
      label: t('sharedCallLabel'),
      tenantId: null,
      participant: { name: getGuestDisplayName(), ref: 'self' },
      transport: guestMediaTransport,
    });
    return () => publishAnchor(null);
  }, [persistence, publishAnchor, sharedRoom.code, sharedRoom.displayName, t]);

  const publishPresence = liveSession?.publishPresence;
  useEffect(() => {
    if (!publishPresence) return;
    publishPresence(members.map((member) => ({ userId: member.userId, displayName: member.displayName })), currentUserId);
  }, [currentUserId, members, publishPresence]);
}
