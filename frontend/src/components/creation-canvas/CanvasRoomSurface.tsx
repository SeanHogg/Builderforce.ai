/*
 * No `'use client'` here on purpose. Imported only by `CreationCanvas.tsx`, which
 * already declares the boundary — the same reason `CanvasAppSurface` and
 * `CanvasInsightsSurface` state in their own headers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import type { CanvasPresenceSpatial, CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { useTheme } from '@/lib/useTheme';
import { spatialPeers, type LivePresenceMap } from '@/lib/canvas/livePresence';
import {
  ROOM_PALETTES, assignRoomSeats, bodyColor, seatPlacement, wallPanels,
  type RoomOccupant, type RoomWallObject,
} from '@/lib/canvas/roomSeating';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import { RoomStandupBar } from './RoomStandupBar';
import { RoomScene } from './world3d/RoomScene';
import styles from './CanvasRoomSurface.module.css';

/**
 * THE ROOM — this session's people, standing in a circle, with its work on the wall.
 *
 * ── WHY A SURFACE AND NOT A DESTINATION ──────────────────────────────────────────
 * A standup already had two homes in this product and neither was the board: a
 * full-screen meeting room and a project's round table, both of which you reach by
 * navigating AWAY from the thing being discussed. That is the wrong shape for the
 * one ceremony whose entire subject is the work in front of you. A surface is the
 * right shape, and it is deliberately `scope: 'board'` for the same reason `app` is —
 * a room is about the whole session, so there is no card to enter it from and
 * pressing it with nothing selected has an answer.
 *
 * ── WHAT IT OWNS, AND WHAT IT DOES NOT ───────────────────────────────────────────
 * It owns the ROOM: where bodies stand, who is actually here, what hangs on the
 * wall, and announcing its own presence. It owns no domain at all — there is no
 * room table, no room membership and no room record, because a canvas session
 * already has a roster and the presence relay already carries who is live. A
 * second store of "who is in this standup" would be a second answer to a question
 * that already has one.
 *
 * ── WHY IT ANNOUNCES ON A HEARTBEAT ──────────────────────────────────────────────
 * The relay drops a peer after `LIVE_PRESENCE_TTL_MS` without a frame, which is
 * exactly right for a pointer (a still pointer is a stale pointer) and exactly
 * wrong for a seated person (sitting still is what a standup IS). So being in the
 * room is re-asserted on an interval well inside that window. It is one small frame
 * per person per interval, which is cheaper than the alternative — a durable
 * "in the room" flag that a closed laptop leaves set forever.
 */

/** Re-assert presence comfortably inside the relay's 30s expiry. */
const ROOM_HEARTBEAT_MS = 10_000;

/**
 * Whether this browser can actually give us a 3D context.
 *
 * Asked once, and asked by TRYING rather than by sniffing: a `webgl2` context that
 * fails to allocate on a locked-down or software-rendered machine looks exactly
 * like a supported browser right up until the canvas is black. The room has a
 * legible fallback, so the only unacceptable outcome is finding out too late.
 */
function canRenderWebgl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!context) return false;
    // Free it immediately: a probe context counts against the browser's small
    // per-page context budget, and the real canvas needs one of those.
    (context as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export interface CanvasRoomSurfaceProps {
  /** The session roster, in its own stable order. */
  members: readonly RoomOccupant[];
  currentUserId: string | null;
  /** The ephemeral presence map the host already holds. */
  live: LivePresenceMap;
  /** Publish this client's own presence. The host owns the socket. */
  onPresence: (state: CanvasPresenceState) => void;
  /** What hangs on the wall — described once by the host, for both 3D readings.
   *  Already capped to {@link ROOM_WALL_CAPACITY} by the host, which is the only
   *  place that can avoid describing objects the wall will never draw. */
  objects: readonly RoomWallObject[];
  /** Every object on the board, not just the ones handed over. The difference is
   *  what the surface reports as left off the wall — a number only the host can
   *  know, and one a wall that quietly showed ten of ninety would be lying about. */
  totalObjects: number;
  /** Selecting a panel selects the card it stands for. Absent = read-only wall. */
  onSelectObject?: ((objectId: string) => void) | undefined;
  /** The project this board itself names, when it names one. One of the three
   *  answers `resolveStandupProject` weighs — see `lib/canvas/standupProject`. */
  boardProjectId?: number | null;
  onExit: () => void;
}

export function CanvasRoomSurface({
  members,
  currentUserId,
  live,
  onPresence,
  objects,
  totalObjects,
  onSelectObject,
  boardProjectId = null,
  onExit,
}: CanvasRoomSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.room');
  const { theme } = useTheme();
  const palette = ROOM_PALETTES[theme === 'light' ? 'light' : 'dark'];

  // Asked ONCE, lazily, and never again. Safe to ask during the first render
  // because this surface is only ever reached through a `ssr: false` dynamic
  // import, so there is no server frame in which `document` is missing — and
  // the probe itself still guards for one rather than relying on that.
  const [webgl] = useState(canRenderWebgl);

  const bodies = useMemo(() => {
    const map = new Map<string, CanvasPresenceSpatial>();
    for (const peer of spatialPeers(live, currentUserId)) map.set(peer.userId, peer.spatial);
    return map;
  }, [live, currentUserId]);

  const seats = useMemo(
    () => assignRoomSeats(members, bodies, currentUserId),
    [members, bodies, currentUserId],
  );

  const panels = useMemo(() => wallPanels(objects), [objects]);
  const hidden = Math.max(0, totalObjects - panels.length);

  /**
   * MY OWN SEAT, announced.
   *
   * The index is my position in the roster, which is the same number every other
   * client would have computed for me — so if my frame never arrives, the room
   * still puts me in the right chair rather than in nobody's.
   */
  const myIndex = useMemo(
    () => Math.max(0, members.findIndex((member) => member.userId === currentUserId)),
    [members, currentUserId],
  );

  const body = useMemo<CanvasPresenceSpatial>(() => {
    const place = seatPlacement(myIndex, Math.max(1, members.length));
    return { position: place.position, yaw: place.yaw, seat: myIndex };
  }, [myIndex, members.length]);

  // Also held in a ref, because the heartbeat below must read the CURRENT body
  // without the interval restarting every time the roster is re-polled — a
  // restarting interval is an interval that never fires. Written only from an
  // effect; never during render.
  const bodyRef = useRef(body);

  // My body changed (I arrived, or somebody joined ahead of me and the ring
  // closed up): remember it, and say so immediately rather than making the room
  // wait for the next heartbeat.
  useEffect(() => {
    bodyRef.current = body;
    onPresence({ spatial: body });
  }, [body, onPresence]);

  useEffect(() => {
    const timer = window.setInterval(() => onPresence({ spatial: bodyRef.current }), ROOM_HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      // Leaving the room retracts the body immediately rather than letting it
      // stand there for the length of the TTL. `null` is the contract's own
      // "I left" — see `canvasPresenceFrame`.
      onPresence({ spatial: null });
    };
  }, [onPresence]);

  const hereCount = seats.filter((seat) => seat.live || seat.isSelf).length;

  // What the room IS doing goes in `controls`; what it is REPORTING goes in
  // `status`, which is what survives a folded bar — see `canvasSurfaceActions`.
  // The standup bar owns its own project choice and its own ceremony binding, so
  // this surface hands it the roster and learns nothing about either.
  useCanvasSurfaceActions(() => ({
    controls: <RoomStandupBar members={members} boardProjectId={boardProjectId} />,
    status: (
      <CanvasBarGroup caption={t('label')} label={t('regionLabel')}>
        <span className={styles.status} role="status">
          {t('here', { here: hereCount, total: seats.length })}
        </span>
      </CanvasBarGroup>
    ),
  }), [boardProjectId, hereCount, members, seats.length, t]);

  return (
    <section
      className={styles.surface}
      data-testid="canvas-room-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      {!webgl ? (
        <div className={styles.fallback} role="status">
          <h3>{t('noWebglTitle')}</h3>
          <p>{t('noWebglBody')}</p>
          <div className={styles.ring}>
            {seats.map((seat) => (
              <span key={seat.userId} className={styles.ringSeat} data-live={seat.live || seat.isSelf ? 'true' : 'false'}>
                <span className={styles.seatDot} style={{ background: bodyColor(seat.userId, palette, seat.isSelf) }} />
                {seat.displayName || t('unknown')}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.stage}>
          <Canvas shadows camera={{ position: [0, 3.4, 6.4], fov: 55, near: 0.1, far: 120 }}>
            <RoomScene
              seats={seats}
              panels={panels}
              palette={palette}
              unknownLabel={t('unknown')}
              onSelectObject={onSelectObject}
            />
          </Canvas>
        </div>
      )}

      <div className={styles.roster}>
        <p className={styles.rosterHead}>{t('rosterHead', { count: seats.length })}</p>
        {seats.map((seat) => (
          <div key={seat.userId} className={styles.seat} data-live={seat.live || seat.isSelf ? 'true' : 'false'}>
            <span className={styles.seatDot} style={{ background: bodyColor(seat.userId, palette, seat.isSelf) }} />
            <span className={styles.seatName}>{seat.displayName || t('unknown')}</span>
            <span className={styles.seatState}>
              {seat.isSelf ? t('you') : seat.live ? t('inRoom') : t('onBoard')}
            </span>
          </div>
        ))}
        {hidden > 0 && <p className={styles.hidden}>{t('wallOverflow', { count: hidden })}</p>}
      </div>
    </section>
  );
}

