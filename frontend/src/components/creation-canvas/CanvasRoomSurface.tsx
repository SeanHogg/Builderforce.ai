/*
 * No `'use client'` here on purpose. Imported only by `CreationCanvas.tsx`, which
 * already declares the boundary — the same reason `CanvasAppSurface` and
 * `CanvasInsightsSurface` state in their own headers.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import type { CanvasPresenceSpatial, CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { canvas3dScene, type Canvas3DNode, type Canvas3DSceneInput } from '@/lib/canvas/canvas3d';
import { useTheme } from '@/lib/useTheme';
import { spatialPeers, type LivePresenceMap } from '@/lib/canvas/livePresence';
import {
  ROOM_PALETTES, assignRoomSeats, bodyColor, seatPlacement,
  type RoomOccupant,
} from '@/lib/canvas/roomSeating';
import { DEFAULT_ROOM_SESSION_SPOT, placeSessionInRoom } from '@/lib/canvas/roomSession';
import type { RoomCreation } from '@/lib/canvas/roomCreations';
import { roomSpotKey } from '@/lib/canvas/roomSpots';
import { useRoomSpot } from '@/lib/canvas/useRoomSpot';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import { RoomCreationItem } from './world3d/RoomCreationItem';
import { RoomScene } from './world3d/RoomScene';
import { RoomSessionDiorama } from './world3d/RoomSessionDiorama';
import { RoomStationList, RoomStationPanel, RoomStationStands, useRoomStationInstances } from './room-stations/RoomStations';
import styles from './CanvasRoomSurface.module.css';

/**
 * THE ROOM — this session's people, standing in a circle, with the session itself
 * placed among them, and every 3D thing the session has made standing beside it.
 *
 * ── WHY THE ROOM AND THE 3D SPACE ARE ONE SURFACE ────────────────────────────────
 * They shipped as two rail entries. "3D space" projected the board's objects through
 * depth; "Room" seated the people and hung a capped wall of the same objects behind
 * them. That was two 3D readings of one board with two cameras, and a person in one
 * could not see the other. Now there is ONE spatial surface: the room, where the
 * session is a THING — a diorama of the board's projection that you drag anywhere in
 * the room, open at full size from its own button, and minimise back to where you
 * left it. The full-size projection is still `Canvas3DView`, wearing the room's
 * (X) on the corner of its own planes; the host hands it in through
 * `renderSession` and this surface decides when it is up. See
 * `lib/canvas/roomSession.ts` for the placement arithmetic.
 *
 * ── WHY 3D CREATIONS STAND IN IT ─────────────────────────────────────────────────
 * A game, a world, an AI scene and a model are the things on a board that HAVE
 * depth, and they used to be flat cards that each opened into a surface of their own
 * — so the one spatial surface never showed the spatial work. Each now stands in the
 * room (`RoomCreationItem`): dragged like the session, opened from its own button
 * into the surface its kind already has, and — through the host — minimised back
 * here rather than onto the board. A Brain turn that makes one brings the reader
 * here. Which kinds, and where they first stand, is `lib/canvas/roomCreations.ts`.
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
  /** The session roster, in its own stable order, then the agents on the board. */
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
   * The session at full size, handed its way back into the room. Inside the room
   * there is no rail entry to press — the session is a thing IN the room, not a
   * surface beside it — so the session draws that way back itself: Escape calls
   * `onMinimize`, and so does an (X) named `exitLabel`, pinned to the corner of the
   * session's own planes. It used to be pinned to this frame's corner instead,
   * which on a wide screen left it floating in empty space far from what it closes.
   */
  renderSession: (frame: { onMinimize: () => void; exitLabel: string }) => ReactNode;
  /**
   * Every 3D creation on the board — games, worlds, AI scenes, models — in board
   * order. Each stands in the room beside the session (see the header).
   */
  creations: readonly RoomCreation[];
  /**
   * Open one at full size, in the surface its kind has. Only offered for a creation
   * whose `surface` is set; the host routes its way back to the room.
   */
  onOpenCreation: (creation: RoomCreation) => void;
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
  creations,
  onOpenCreation,
  sessionInitiallyOpen = false,
  onExit,
}: CanvasRoomSurfaceProps<T>) {
  const t = useTranslations('creationCanvas.surface.room');
  const tCanvas = useTranslations('creationCanvas');
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

  // Where the session sits — the same per-browser spot every creation keeps, under
  // the key the session has always had.
  const [spot, placeSession] = useRoomSpot(roomSpotKey(sessionId), DEFAULT_ROOM_SESSION_SPOT);
  const placement = useMemo(() => placeSessionInRoom(spot), [spot]);
  const [dragging, setDragging] = useState(false);

  // The STATIONS standing in the room — the approval desk, the metrics board, widgets
  // on stands — declared as registry data (`lib/canvas/roomStations.ts` +
  // `room-stations/registry.tsx`), read off the board bridge, never branched on here.
  const stations = useRoomStationInstances();
  const [stationKey, setStationKey] = useState<string | null>(null);
  const openStation = stations.find((station) => station.key === stationKey) ?? null;
  const closeStation = useCallback(() => setStationKey(null), []);

  /** What one creation is called, what it is, and how its Open button is named. */
  const labelsOf = useCallback((creation: RoomCreation) => {
    const title = creation.title || t('creation.untitled');
    return { title, kind: tCanvas(`object.${creation.kind}`), openName: t('creation.openNamed', { title }) };
  }, [t, tCanvas]);

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

  const hereCount = seats.filter((seat) => seat.present).length;
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
    <div className={styles.sessionFrame} data-testid="room-session-frame">
      {renderSession({ onMinimize: minimizeSession, exitLabel: t('session.back') })}
    </div>
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
        // An open station panel is the innermost level, so Escape closes it first.
        if (openStation) closeStation(); else if (sessionOpen) minimizeSession(); else onExit();
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
                  <span key={seat.userId} className={styles.ringSeat} data-live={seat.present ? 'true' : 'false'}>
                    <span className={styles.seatDot} style={{ background: bodyColor(seat.userId, palette, seat.isSelf) }} />
                    {seat.displayName || t('unknown')}
                  </span>
                ))}
              </div>
              {/* The projection is DOM, not WebGL, so the session still opens here. */}
              <button type="button" className={styles.fallbackOpen} onClick={openSession}>
                {t('session.open')}
              </button>
              {/* So do the creations: each surface they open into has its own reading
                  for a device without WebGL, so the room still lists them with the
                  same Open their 3D stands carry. */}
              {creations.length > 0 && (
                <ul className={styles.creations} aria-label={t('creation.head', { count: creations.length })}>
                  {creations.map((creation) => {
                    const labels = labelsOf(creation);
                    return (
                      <li key={creation.id} className={styles.creation} data-testid="room-creation">
                        <span className={styles.creationName}>
                          <strong>{labels.title}</strong>
                          <small>{labels.kind}</small>
                        </span>
                        {creation.surface && (
                          <button type="button" className={styles.creationOpen} onClick={() => onOpenCreation(creation)} aria-label={labels.openName}>
                            {t('session.openButton')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
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
                  {creations.map((creation, index) => {
                    const labels = labelsOf(creation);
                    return (
                      <RoomCreationItem
                        key={creation.id}
                        sessionId={sessionId}
                        creation={creation}
                        index={index}
                        palette={palette}
                        title={labels.title}
                        hint={t('creation.hint', { kind: labels.kind })}
                        open={creation.surface ? {
                          label: t('session.openButton'),
                          name: labels.openName,
                          testId: 'room-creation-open',
                          onOpen: () => onOpenCreation(creation),
                        } : undefined}
                        onDragChange={setDragging}
                      />
                    );
                  })}
                  <RoomStationStands
                    instances={stations}
                    sessionId={sessionId}
                    palette={palette}
                    openKey={stationKey}
                    onOpen={setStationKey}
                    onDragChange={setDragging}
                  />
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
            <div key={seat.userId} className={styles.seat} data-live={seat.present ? 'true' : 'false'} data-kind={seat.kind}>
              <span className={styles.seatDot} style={{ background: bodyColor(seat.userId, palette, seat.isSelf) }} />
              <span className={styles.seatName}>{seat.displayName || t('unknown')}</span>
              <span className={styles.seatState}>
                {seat.isSelf ? t('you') : seat.kind === 'agent' ? t('agent') : seat.live ? t('inRoom') : t('onBoard')}
              </span>
            </div>
          ))}
          {/* Every station, as a row with its Open — the keyboard and screen-reader path
              to each, and the whole of them on a device without WebGL. */}
          <RoomStationList instances={stations} onOpen={setStationKey} />
        </div>
      )}
      <RoomStationPanel instance={openStation} onClose={closeStation} />
    </section>
  );
}
