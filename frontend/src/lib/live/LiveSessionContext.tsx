'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useMediaRoom, type MediaPathEvidence, type MediaRoomTransport, type RemoteTile } from '@/lib/useMediaRoom';
import { useDisplayCapture } from '@/lib/useDisplayCapture';
import { useMediaRecorderSink, type SavedMediaRecording } from '@/lib/useMediaRecorder';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

/**
 * The live session — hoisted OUT of the canvas so a call outlives a navigation.
 *
 * Presence, follow, present-mode, camera and screen share were `useState` inside
 * `CreationCanvas`. Leaving `/create/<id>` unmounted the component and the room
 * died with it, which made "hold on, let me show you the runway" a way to END the
 * call. Worse, presence could only ever mean "present the board", because the
 * only thing that knew a room existed was the board.
 *
 * Here the room is shell state, so:
 *  - navigating anywhere keeps the call up (the media socket is never unmounted);
 *  - "presenting" can broadcast ANY surface, not just the canvas;
 *  - one definition of "on camera" is shared by the canvas, the meeting panel and
 *    the live bar, instead of one per surface.
 *
 * WHAT THIS OWNS vs WHAT THE CANVAS OWNS. This owns the ROOM: the media socket,
 * mic/camera/screen, who is on the call, whose viewport you are following, and
 * whether you are presenting. The canvas remains the source of truth for BOARD
 * presence (cursors, selections, typing) because that is server state polled per
 * board — it publishes its roster in here via {@link publishPresence} so the live
 * bar and the board show one roster rather than two.
 *
 * TENANT IS THE ONLY AXIS THAT DROPS A ROOM. A room belongs to the workspace that
 * created it, so switching tenant leaves it; project and company are filters
 * inside one identity and never touch the call. See `lib/canvasScopePolicy.ts`,
 * which states all four axes in one place so this provider and the switcher
 * cannot drift apart.
 */

/** Who is in the room, merged from board presence and media peers. */
export interface LiveMember {
  userId: string;
  displayName: string | null;
  /** Present on the media room (has a peer connection), not just on the board. */
  onCall: boolean;
  camOn: boolean;
  micOn: boolean;
  /** Publishing a screen right now. */
  sharing: boolean;
  /** This is you. */
  isSelf: boolean;
}

/** What the room is anchored to — a board, a meeting, or a ceremony. */
export interface LiveRoomTarget {
  /** Room key for the media relay. Stable per surface. */
  roomKey: string;
  /** Human label for the live chip and the ring ("Bakery landing page"). */
  label: string;
  /** Where the room lives, for the leave-confirm and the ring subtitle. */
  scopeLabel?: string;
  /** The tenant that owns the room; a switch away from it ends the call. */
  tenantId: string | null;
  /** Deep link back into the surface the room is anchored to. */
  href?: string;
  /** Surface-specific media configuration; transport is only different for guests. */
  participant?: { name: string; ref: string };
  audioOnly?: boolean;
  privacyMode?: 'direct-only' | 'relay-fallback';
  transport?: MediaRoomTransport;
  /** Surface bookkeeping (attendance/UI), invoked by every leave affordance. */
  onLeave?: () => void | Promise<void>;
}

export interface LiveSessionValue {
  /** The room, or null when there is no call. */
  room: LiveRoomTarget | null;
  live: boolean;
  connected: boolean;
  members: LiveMember[];
  /** Media tiles for the filmstrip. */
  tiles: RemoteTile[];
  localStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  /** Broadcasting a screen. */
  sharing: boolean;
  /** This browser can capture a screen at all — controls self-gate on it. */
  canShare: boolean;
  /** The last capture failure, for a human-readable notice. Null when fine. */
  shareError: string | null;
  mediaError: string | null;
  captions: Record<string, string>;
  speaking: Set<string>;
  mediaPaths: MediaPathEvidence[];
  canRecord: boolean;
  recording: boolean;
  recordingSaving: boolean;
  recordingError: string | null;
  /**
   * Presentation mode: the shell chrome recedes and everyone following sees this
   * surface. Shell state so it survives leaving the board.
   */
  presentMode: boolean;
  /** Whose viewport this person is following, or null. */
  followingUserId: string | null;

  start: (target: LiveRoomTarget) => void;
  leave: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  /** Open the screen picker and publish; stops if already sharing. */
  toggleShare: () => Promise<void>;
  toggleRecording: () => void;
  setPresentMode: (on: boolean) => void;
  setFollowing: (userId: string | null) => void;
  /**
   * The board publishes its roster here. Called by the canvas on every presence
   * tick; the live bar reads the merged result.
   */
  publishPresence: (members: Array<{ userId: string; displayName: string | null }>, currentUserId: string | null) => void;
}

const LiveSessionContext = createContext<LiveSessionValue | null>(null);

/** Merge board presence with media peers so the room has ONE roster. */
export function mergeRoster(
  board: Array<{ userId: string; displayName: string | null }>,
  tiles: readonly RemoteTile[],
  currentUserId: string | null,
  self: { camOn: boolean; micOn: boolean; sharing: boolean; onCall: boolean },
): LiveMember[] {
  const byRef = new Map(tiles.map((tile) => [tile.ref, tile]));
  const members: LiveMember[] = board.map((member) => {
    const tile = byRef.get(member.userId);
    const isSelf = currentUserId != null && member.userId === currentUserId;
    return {
      userId: member.userId,
      displayName: member.displayName,
      onCall: isSelf ? self.onCall : tile != null,
      camOn: isSelf ? self.camOn : tile?.camOn ?? false,
      micOn: isSelf ? self.micOn : tile?.micOn ?? false,
      sharing: isSelf ? self.sharing : tile?.sharing ?? false,
      isSelf,
    };
  });
  // Someone on the CALL who is not on the board is still in the room — a guest
  // who joined by link, or a teammate who navigated away from the board. Showing
  // only board members is how a call appears to lose people who are still talking.
  const known = new Set(members.map((member) => member.userId));
  for (const tile of tiles) {
    if (known.has(tile.ref)) continue;
    members.push({
      userId: tile.ref || tile.peerId,
      displayName: tile.name,
      onCall: true,
      camOn: tile.camOn,
      micOn: tile.micOn,
      sharing: tile.sharing,
      isSelf: false,
    });
  }
  return members;
}

export function LiveSessionProvider({ children }: { children: React.ReactNode }) {
  const { user, tenant } = useAuth();
  const canvas = useOptionalActiveCanvas();
  const scope = useOptionalProjectScope();
  const [room, setRoom] = useState<LiveRoomTarget | null>(null);
  const [presentMode, setPresentModeState] = useState(false);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [boardMembers, setBoardMembers] = useState<Array<{ userId: string; displayName: string | null }>>([]);
  const [boardUserId, setBoardUserId] = useState<string | null>(null);

  const authenticatedMe = useMemo(
    () => ({ name: user?.name || user?.email || 'You', ref: user?.id != null ? String(user.id) : 'me' }),
    [user?.name, user?.email, user?.id],
  );

  const me = room?.participant ?? authenticatedMe;
  const media = useMediaRoom(room?.roomKey ?? null, me, {
    enabled: room != null,
    audioOnly: room?.audioOnly,
    privacyMode: room?.privacyMode,
    transport: room?.transport,
  });
  const { publishDisplay, unpublishDisplay } = media;

  // The browser's own "Stop sharing" bar must take the room with it, or the live
  // bar keeps claiming a presentation nobody is receiving.
  const onCaptureStopped = useCallback(() => { unpublishDisplay(); }, [unpublishDisplay]);
  const display = useDisplayCapture(onCaptureStopped);
  const recordingProjectId = scope?.currentProjectId ?? (canvas?.projectIds.length === 1 ? canvas.projectIds[0] : null);
  const onRecordingSaved = useCallback((recording: SavedMediaRecording) => {
    if (!canvas?.active) return;
    window.dispatchEvent(new CustomEvent('builderforce:media-recording-saved', {
      detail: { ...recording, sessionId: canvas.active.sessionId },
    }));
  }, [canvas?.active]);
  const recorder = useMediaRecorderSink(display.stream ?? media.localStream, recordingProjectId, onRecordingSaved);

  const leave = useCallback(() => {
    if (recorder.recording) recorder.stop();
    display.stop();
    unpublishDisplay();
    void room?.onLeave?.();
    setRoom(null);
    setPresentModeState(false);
    setFollowingUserId(null);
    setShareError(null);
  }, [display, recorder, room, unpublishDisplay]);

  const start = useCallback((target: LiveRoomTarget) => {
    setShareError(null);
    setRoom((current) => {
      if (current && current.roomKey !== target.roomKey) void current.onLeave?.();
      return target;
    });
  }, []);

  // A room belongs to the workspace that made it. Switching tenant is the ONE
  // scope change that is an identity change, so the call cannot follow you across
  // it — see `canvasScopePolicy`. The confirm lives at the switcher (it is the
  // interrupting, destructive action); this is the invariant that backs it up, so
  // a switch by any other path (deep link, session expiry) still ends the call
  // rather than leaving a socket open on a workspace you left.
  const roomTenantId = room?.tenantId ?? null;
  const activeTenantId = tenant?.id ?? null;
  useEffect(() => {
    if (room && roomTenantId != null && roomTenantId !== activeTenantId) leave();
  }, [activeTenantId, leave, room, roomTenantId]);

  const toggleShare = useCallback(async () => {
    if (display.active) {
      display.stop();
      unpublishDisplay();
      return;
    }
    const stream = await display.start();
    if (!stream) {
      // `useDisplayCapture` reports null for a cancelled picker, which is not a
      // failure worth surfacing — only a real error sets `error`.
      setShareError(display.error);
      return;
    }
    setShareError(null);
    publishDisplay(stream);
  }, [display, publishDisplay, unpublishDisplay]);

  const toggleRecording = useCallback(() => {
    if (recorder.recording) recorder.stop(); else recorder.start();
  }, [recorder]);

  const publishPresence = useCallback(
    (members: Array<{ userId: string; displayName: string | null }>, currentUserId: string | null) => {
      setBoardMembers(members);
      setBoardUserId(currentUserId);
    },
    [],
  );

  const setPresentMode = useCallback((on: boolean) => setPresentModeState(on), []);
  const setFollowing = useCallback((userId: string | null) => setFollowingUserId(userId), []);

  const selfId = boardUserId ?? me.ref;
  const members = useMemo(
    () => mergeRoster(boardMembers, media.tiles, selfId, {
      camOn: media.camOn,
      micOn: media.micOn,
      sharing: display.active,
      onCall: room != null,
    }),
    [boardMembers, display.active, media.camOn, media.micOn, media.tiles, room, selfId],
  );

  // A person you were following who leaves the room must not leave the viewport
  // pinned to a ghost.
  const followingRef = useRef(followingUserId);
  followingRef.current = followingUserId;
  useEffect(() => {
    const target = followingRef.current;
    if (target && !members.some((member) => member.userId === target)) setFollowingUserId(null);
  }, [members]);

  const value = useMemo<LiveSessionValue>(() => ({
    room,
    live: room != null,
    connected: media.connected,
    members,
    tiles: media.tiles,
    localStream: media.localStream,
    micOn: media.micOn,
    camOn: media.camOn,
    sharing: display.active,
    canShare: display.supported,
    shareError,
    mediaError: media.mediaError,
    captions: media.captions,
    speaking: media.speaking,
    mediaPaths: media.mediaPaths,
    canRecord: recorder.supported,
    recording: recorder.recording,
    recordingSaving: recorder.saving,
    recordingError: recorder.error,
    presentMode,
    followingUserId,
    start,
    leave,
    toggleMic: media.toggleMic,
    toggleCam: media.toggleCam,
    toggleShare,
    toggleRecording,
    setPresentMode,
    setFollowing,
    publishPresence,
  }), [
    display.active, display.supported, followingUserId, leave, media.camOn, media.connected, media.localStream,
    media.captions, media.mediaError, media.mediaPaths, media.micOn, media.speaking, media.tiles, media.toggleCam, media.toggleMic, members, presentMode,
    recorder.error, recorder.recording, recorder.saving, recorder.supported,
    publishPresence, room, setFollowing, setPresentMode, shareError, start, toggleRecording, toggleShare,
  ]);

  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>;
}

/**
 * Non-throwing by design. The canvas renders in the app shell AND in the
 * logged-out marketing shell (an anonymous board), and a surface that only
 * sometimes has a room must degrade rather than crash.
 */
export function useOptionalLiveSession(): LiveSessionValue | null {
  return useContext(LiveSessionContext);
}

export function useLiveSession(): LiveSessionValue {
  const ctx = useContext(LiveSessionContext);
  if (!ctx) throw new Error('useLiveSession must be used within a LiveSessionProvider');
  return ctx;
}
