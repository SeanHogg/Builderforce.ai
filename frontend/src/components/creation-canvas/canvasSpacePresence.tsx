import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { spatialPeers, type LivePresenceMap } from '@/lib/canvas/livePresence';
import { ROOM_PALETTES, bodyColor } from '@/lib/canvas/roomSeating';
import { useTheme } from '@/lib/useTheme';
import { useBodyAnnouncer } from './room/useBodyAnnouncer';

/**
 * WHO ELSE IS IN THIS SPACE — for any walker, wherever it is mounted.
 *
 * ── WHY A CONTEXT ────────────────────────────────────────────────────────────
 * A level played in the room and a game played on its own surface are the same
 * runtime (`WorldViewport`) and both need the same three things from the canvas:
 * the live presence map, who "me" is, and the socket to send my body on. Handed
 * down as props, each would be three more props through every surface between the
 * canvas and the viewport. The canvas already holds all three, so it publishes them
 * ONCE here, and a viewport asks for the peers in ITS space by id — the way the
 * stations read the board through `CanvasBoardBridgeProvider`.
 *
 * Outside a canvas (a marketplace preview, a test) there is no provider, and the
 * hook returns null: the walker walks alone, which is exactly right there.
 */

export interface CanvasSpacePresenceValue {
  live: LivePresenceMap;
  selfId: string | null;
  members: ReadonlyArray<{ userId: string; displayName?: string | null; avatarUrl?: string | null }>;
  send: (state: CanvasPresenceState) => void;
}

const SpacePresenceContext = createContext<CanvasSpacePresenceValue | null>(null);

export function CanvasSpacePresenceProvider({ value, children }: { value: CanvasSpacePresenceValue; children: ReactNode }) {
  return <SpacePresenceContext.Provider value={value}>{children}</SpacePresenceContext.Provider>;
}

/** Another person, drawn in a walked space. */
export interface WorldPeer {
  userId: string;
  label: string;
  color: string;
  /** Their profile picture, worn as the figure's face. */
  avatarUrl: string | null;
  position: [number, number, number];
  yaw: number;
}

export interface SpacePresence {
  peers: readonly WorldPeer[];
  /** My own picture, for my walker's face in third person. */
  selfAvatarUrl: string | null;
  /** The walker moved: announce it, throttled, in this space. */
  onMove: (position: [number, number, number], yaw: number) => void;
}

const noop = () => {};

/**
 * The peers in `space`, and the sender for my own body there. Null when there is
 * no canvas to be present on, or no space named (the walker is not walking).
 */
export function useSpacePresence(space: string | undefined): SpacePresence | null {
  const value = useContext(SpacePresenceContext);
  const t = useTranslations('creationCanvas.surface.room');
  const { theme } = useTheme();
  const palette = ROOM_PALETTES[theme === 'light' ? 'light' : 'dark'];
  const active = !!value && !!space;
  const announce = useBodyAnnouncer(value?.send ?? noop, active);

  const peers = useMemo<WorldPeer[]>(() => {
    if (!value || !space) return [];
    const byId = new Map(value.members.map((member) => [member.userId, member]));
    return spatialPeers(value.live, value.selfId, space).map((peer) => ({
      userId: peer.userId,
      label: byId.get(peer.userId)?.displayName || t('unknown'),
      color: bodyColor(peer.userId, palette, false),
      avatarUrl: byId.get(peer.userId)?.avatarUrl || null,
      position: peer.spatial.position,
      yaw: peer.spatial.yaw,
    }));
  }, [palette, space, t, value]);

  const onMove = useCallback((position: [number, number, number], yaw: number) => {
    if (space) announce({ position, yaw, space });
  }, [announce, space]);

  const selfAvatarUrl = useMemo(
    () => value?.members.find((member) => member.userId === value.selfId)?.avatarUrl || null,
    [value],
  );

  return active ? { peers, selfAvatarUrl, onMove } : null;
}
