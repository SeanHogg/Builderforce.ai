/*
 * No `'use client'` here on purpose. Imported only by `CreationCanvas.tsx`, which
 * already declares the boundary — the same reason `CanvasAppSurface` and
 * `CanvasInsightsSurface` state in their own headers.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import type { CanvasPresenceSpatial, CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { canvas3dScene, type Canvas3DNode, type Canvas3DSceneInput } from '@/components/canvas/canvas3d';
import { useTheme } from '@/lib/useTheme';
import { spatialPeers, type LivePresenceMap } from '@/lib/canvas/livePresence';
import {
  ROOM_PALETTES, assignRoomSeats, bodyColor, seatPlacement,
  type RoomOccupant,
} from '@/lib/canvas/roomSeating';
import {
  DEFAULT_ROOM_SESSION_SPOT, placeSessionInRoom, readRoomSessionSpot, writeRoomSessionSpot,
  type RoomSessionSpot,
} from '@/lib/canvas/roomSession';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import { RoomSessionFrame } from './RoomSessionFrame';
import { RoomScene } from './world3d/RoomScene';
import { RoomSessionDiorama } from './world3d/RoomSessionDiorama';
import styles from './CanvasRoomSurface.module.css';

/**
 * THE ROOM — this session's people, standing in a circle, with the session itself
 * placed among them.
 *
 * ── WHY THE ROOM AND THE 3D SPACE ARE ONE SURFACE ────────────────────────────────
 * They shipped as two rail entries. "3D space" projected the board's objects through
 * depth; "Room" seated the people and hung a capped wall of the same objects behind
 * them. That was two 3D readings of one board with two cameras, and a person in one
 * could not see the other. Now there is ONE spatial surface: the room, where the
 * session is a THING — a diorama of the board's projection that you drag anywhere in
 * the room, open at full size from its own button, and minimise back to where you
 * left it. The full-size projection is still `Canvas3DView`, unchanged; the host
 * hands it in through `renderSession` and this surface decides when it is up. See
 * `lib/canvas/roomSession.ts` for the placement arithmetic.
 *
 * ── WHAT IT PUTS ON THE BAR, AND WHAT IT DOES NOT ────────────────────────────────
 * Only its STATUS — who is here. It used to publish a session group and a standup
 * group as controls too, which pushed the one bar out under the Brain panel. The
 * session's controls are on the session itself (drag it, press Open), and the
 * standup is a session action beside the call (`useCanvasStandupAction`) — offered
 * on every surface, because a standup is people agreeing to talk about this canvas,
 * not a feature of the room.
 *
 * ── WHAT IT OWNS, AND WHAT IT DOES NOT ───────────────────────────────────────────
 * It owns the ROOM: where bodies stand, who is actually here, where the session
 * sits, whether it is open, and announcing its own presence. It owns no domain at
 * all — there is no room table, no room membership and no room record, because a
 * canvas session already has a roster and the presence relay already carries who
 * is live. Where the session sits is a per-browser reading preference, kept the way
 * the surface preference is.
 *
 * ── WHY IT ANNOUNCES ON A HEARTBEAT ──────────────────────────────────────────────
 * The relay drops a peer after `LIVE_PRESENCE_TTL_MS` without a frame, which is
 * exactly right for a pointer (a still pointer is a stale pointer) and exactly
 * wrong for a seated person (sitting still is what a standup IS). So being in the
 * room is re-asserted on an interval well inside that window — and it keeps being
 * asserted while the session is open at full size, because opening the work does
 * not leave the room.
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

export interface CanvasRoomSurfaceProps<T extends Canvas3DNode> {
  /** Keys where THIS viewer left the session in THIS room. */
  sessionId: string;
  sessionTitle: string;
  /** The session roster, in its own stable order. */
  members: readonly RoomOccupant[];
  currentUserId: string | null;
  /** The ephemeral presence map the host already holds. */
  live: LivePresenceMap;
  /** Publish this client's own presence. The host owns the socket. */
  onPresence: (state: CanvasPresenceState) => void;
  /**
   * What the board's depth projection is made from — the same input `Canvas3DView`
   * takes. The layout is computed HERE, and only while the diorama is drawn, so a
   * board being dragged on the flat surface never pays for a room it is not in.
   * Memoise it in the host: a fresh object every render is a fresh layout.
   */
  sceneInput: Canvas3DSceneInput<T>;
  /**
   * The session at full size. Handed the frame's own way back so that Escape inside
   * the projection minimises it into the room rather than leaving the surface.
   */
  renderSession: (frame: { onMinimize: () => void }) => ReactNode;
  /** Arrive with the session already open — a model comparison lands in depth. */
  sessionInitiallyOpen?: boolean;
  onExit: () => void;
}

export function CanvasRoomSurface<T extends Canvas3DNode>({
  sessionId,
  sessionTitle,
  members,
  currentUserId,
  live,
  onPresence,
  sceneInput,
  renderSession,
  sessionInitiallyOpen = false,
  onExit,
}: CanvasRoomSurfaceProps<T>) {
  const t = useTranslations('creationCanvas.surface.room');
  const { theme } = useTheme();
  const palette = ROOM_PALETTES[theme === 'light' ? 'light' : 'dark'];

  // Asked ONCE, lazily, and never again. Safe to ask during the first render
  // because this surface is only ever reached through a `ssr: false` dynamic
  // import, so there is no server frame in which `document` is missing — and
  // the probe itself still guards for one rather than relying on that.
  const [webgl] = useState(canRenderWebgl);

  const [sessionOpen, setSessionOpen] = useState(sessionInitiallyOpen);
  const openSession = useCallback(() => setSessionOpen(true), []);
  const minimizeSession = useCallback(() => setSessionOpen(false), []);

  // Where the session sits. Restored in an effect rather than as the initial state,
  // the same way the folded bar and the phase are: storage is a per-browser fact
  // and reading it during render is the pattern the hooks ratchet exists to stop.
  const [spot, setSpot] = useState<RoomSessionSpot>(DEFAULT_ROOM_SESSION_SPOT);
  useEffect(() => { setSpot(readRoomSessionSpot(sessionId)); }, [sessionId]);
  const placeSession = useCallback((next: RoomSessionSpot) => {
    setSpot(next);
    writeRoomSessionSpot(sessionId, next);
  }, [sessionId]);
  const placement = useMemo(() => placeSessionInRoom(spot), [spot]);
  const [dragging, setDragging] = useState(false);

  const bodies = useMemo(() => {
    const map = new Map<string, CanvasPresenceSpatial>();
    for (const peer of spatialPeers(live, currentUserId)) map.set(peer.userId, peer.spatial);
    return map;
  }, [live, currentUserId]);

  const seats = useMemo(
    () => assignRoomSeats(members, bodies, currentUserId),
    [members, bodies, currentUserId],
  );

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
  const objectCount = sceneInput.nodes.length;
  // Laid out only while the diorama is on screen: the open session computes its own
  // projection from the same input, and the room draws nothing of the board then.
  const scene = useMemo(() => (sessionOpen ? null : canvas3dScene(sceneInput)), [sceneInput, sessionOpen]);

  // What the room is REPORTING goes in `status`, which is what survives a folded
  // bar — see `canvasSurfaceActions`. It contributes no controls: see the header.
  useCanvasSurfaceActions(() => ({
    status: (
      <CanvasBarGroup caption={t('label')} label={t('regionLabel')}>
        <span className={styles.status} role="status">
          {t('here', { here: hereCount, total: seats.length })}
        </span>
      </CanvasBarGroup>
    ),
  }), [hereCount, seats.length, t]);

  const session = sessionOpen ? (
    <RoomSessionFrame title={sessionTitle} objectCount={objectCount} onMinimize={minimizeSession} onClose={onExit}>
      {renderSession({ onMinimize: minimizeSession })}
    </RoomSessionFrame>
  ) : null;

  return (
    <section
      className={styles.surface}
      data-testid="canvas-room-surface"
      data-session={sessionOpen ? 'open' : 'placed'}
      aria-label={t('regionLabel')}
      // Escape steps OUT one level: the open session minimises into the room, and
      // the room hands the board back. The projection's own Escape calls the same
      // minimise, so a keyboard user never skips the room on the way out.
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (sessionOpen) minimizeSession(); else onExit();
      }}
    >
      {!webgl ? (
        <div className={styles.fallback} role="status">
          {session ?? (
            <>
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
              {/* The projection is DOM, not WebGL, so the session still opens here. */}
              <button type="button" className={styles.fallbackOpen} onClick={openSession}>
                {t('session.open')}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={styles.stage}>
          {session ?? (
            <>
              <Canvas shadows camera={{ position: [0, 3.4, 6.4], fov: 55, near: 0.1, far: 120 }}>
                <RoomScene
                  seats={seats}
                  palette={palette}
                  unknownLabel={t('unknown')}
                  controlsEnabled={!dragging}
                >
                  {scene && <RoomSessionDiorama
                    scene={scene}
                    placement={placement}
                    palette={palette}
                    title={sessionTitle}
                    hint={t('session.hint', { count: objectCount })}
                    openLabel={t('session.openButton')}
                    onPlace={placeSession}
                    onOpen={openSession}
                    onDragChange={setDragging}
                  />}
                </RoomScene>
              </Canvas>
              <p className={styles.hint}>{t('navigateHint')}</p>
            </>
          )}
        </div>
      )}

      {!sessionOpen && (
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
        </div>
      )}
    </section>
  );
}
