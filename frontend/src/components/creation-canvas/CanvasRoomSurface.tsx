/*
 * No `'use client'` here on purpose. Imported only by `CreationCanvas.tsx`, which
 * already declares the boundary — the same reason `CanvasAppSurface` and
 * `CanvasInsightsSurface` state in their own headers.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import {
  roomDesignGeometry, roomDesignSeats,
  type CanvasPresenceSpatial, type CanvasPresenceState,
} from '@builderforce/creation-canvas-contract';
import { canvas3dScene, type Canvas3DNode, type Canvas3DSceneInput } from '@/lib/canvas/canvas3d';
import { isTypingTarget } from '@/lib/keyboardTarget';
import { useTheme } from '@/lib/useTheme';
import { spatialPeers, type LivePresenceMap } from '@/lib/canvas/livePresence';
import { ROOM_PALETTES, assignRoomSeats, roomSeatPlacement, type RoomOccupant } from '@/lib/canvas/roomSeating';
import { DEFAULT_ROOM_SESSION_SPOT, placeSessionInRoom } from '@/lib/canvas/roomSession';
import type { RoomCreation } from '@/lib/canvas/roomCreations';
import type { RoomSpeech } from '@/lib/canvas/roomSpeech';
import { roomSpotKey } from '@/lib/canvas/roomSpots';
import { useRoomSpot } from '@/lib/canvas/useRoomSpot';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import { RoomDesignerRail } from './room/RoomDesignerRail';
import { RoomFallback } from './room/RoomFallback';
import { RoomLevelStage } from './room/RoomLevelStage';
import { RoomModeBar, type RoomMode } from './room/RoomModeBar';
import { RoomRoster } from './room/RoomRoster';
import { useBodyAnnouncer } from './room/useBodyAnnouncer';
import { useCreationLabels } from './room/useCreationLabels';
import { useFurnitureDesigner } from './room/useFurnitureDesigner';
import { useRoomDesign } from './room/useRoomDesign';
import { RoomCreationItem } from './world3d/RoomCreationItem';
import { RoomFurnitureLayer } from './world3d/RoomFurnitureLayer';
import { RoomGeometryProvider } from './world3d/roomGeometryContext';
import { RoomScene } from './world3d/RoomScene';
import { RoomSessionDiorama } from './world3d/RoomSessionDiorama';
import { RoomWalk } from './world3d/RoomWalk';
import { useDragLook } from './world3d/useDragLook';
import { WalkerTouchControls } from './world3d/WalkerTouchControls';
import { RoomStationPanel, RoomStationStands, useRoomStationInstances } from './room-stations/RoomStations';
import styles from './CanvasRoomSurface.module.css';

/**
 * THE ROOM — this session's people, in the room the session chose, with the session
 * itself placed among them, and every 3D thing the session has made standing beside it.
 *
 * ── ONE SPATIAL SURFACE ──────────────────────────────────────────────────────────
 * The room absorbed the old "3D space" entry: the session is a THING in it (a diorama
 * of the board you drag anywhere and open from its own button), and every game, world,
 * AI scene and model stands in it (`RoomCreationItem`). Nothing spatial lives beside it.
 *
 * ── WHICH ROOM ───────────────────────────────────────────────────────────────────
 * The room is DESIGNED: a `room` object on the board carries its floor, walls and
 * furniture (`roomDesign.ts` in the contract), and the one chosen most recently is the
 * room this session meets in (`useRoomDesign`). A boardroom, an office kitchen, cubicles
 * on an open floor, or a room of the reader's own — and with none, the standup circle
 * every session always had. Chairs seat the roster in the order they were placed.
 *
 * ── LOOK · WALK · DESIGN ─────────────────────────────────────────────────────────
 * Three ways to be in it, chosen on the room itself (`RoomModeBar`): orbit it to see
 * every face; walk it the way you would in Roblox — WASD, jump, right-drag or a finger
 * to look, third person by default, every wall and table solid (`RoomWalk`); or
 * rearrange it (`RoomDesignerRail`, offered only to someone who may edit the board).
 * A Roblox place standing in the room is PLAYED in it (`RoomLevelStage`): Play drops
 * you into its level on this stage, with one (X) back to the room.
 *
 * ── WHAT IT PUTS ON THE BAR, AND WHAT IT DOES NOT ────────────────────────────────
 * Only its STATUS — who is here. Its controls are on the room (the mode bar), on the
 * things in it (their captions), and in its rail. A control group on the session bar
 * once pushed the bar under the Brain panel; that is not repeated.
 *
 * ── WHY AGENTS SPEAK HERE ────────────────────────────────────────────────────────
 * When several agents answer a turn, each reply is drawn over the head of the agent
 * who gave it, and an agent still working shows that it is — handed in as `speech`,
 * which the host reads off the conversation. The room decides only where it goes.
 *
 * ── WHAT IT OWNS ─────────────────────────────────────────────────────────────────
 * Where bodies are, who is here, where the session sits, which mode the reader is in,
 * and announcing its own presence (`useBodyAnnouncer` — seated, walking, or handed to
 * the level being played). The design is the board's, read and written through the
 * board bridge; there is no room table.
 */

/**
 * Whether this browser can actually give us a 3D context — asked once, by TRYING:
 * a context that fails to allocate on a locked-down machine looks like a supported
 * browser right up until the canvas is black.
 */
function canRenderWebgl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!context) return false;
    // Free it immediately: a probe context counts against the page's small budget.
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
  /** What the board's depth projection is made from — memoise it in the host. */
  sceneInput: Canvas3DSceneInput<T>;
  /** The session at full size, handed its way back into the room. */
  renderSession: (frame: { onMinimize: () => void; exitLabel: string }) => ReactNode;
  /** Every 3D creation on the board, in board order. */
  creations: readonly RoomCreation[];
  /** Open one at full size, in the surface its kind has. */
  onOpenCreation: (creation: RoomCreation) => void;
  /** Put the room's design on sale. Absent when this viewer cannot publish. */
  onPublishRoom?: ((roomObjectId: string) => void) | undefined;
  /**
   * What each agent at the table is saying — its reply to the latest turn, or that it
   * is still working — keyed by seat. Read off the conversation by the host
   * (`lib/canvas/roomSpeech.ts`); the room only draws it over the right head.
   */
  speech?: ReadonlyMap<string, RoomSpeech>;
  /** Arrive with the session already open — a model comparison lands in depth. */
  sessionInitiallyOpen?: boolean;
  /** Show a speech bubble's source message in the chat. */
  onSelectSpeech?: (messageId: number) => void;
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
  onPublishRoom,
  speech,
  sessionInitiallyOpen = false,
  onSelectSpeech,
  onExit,
}: CanvasRoomSurfaceProps<T>) {
  const t = useTranslations('creationCanvas.surface.room');
  const { theme } = useTheme();
  const palette = ROOM_PALETTES[theme === 'light' ? 'light' : 'dark'];
  // Safe during the first render: this surface is only reached through a `ssr: false`
  // dynamic import, and the probe guards for a missing document anyway.
  const [webgl] = useState(canRenderWebgl);
  const stageRef = useRef<HTMLDivElement>(null);

  const [sessionOpen, setSessionOpen] = useState(sessionInitiallyOpen);
  const openSession = useCallback(() => setSessionOpen(true), []);
  const minimizeSession = useCallback(() => setSessionOpen(false), []);
  const [level, setLevel] = useState<RoomCreation | null>(null);
  const closeLevel = useCallback(() => setLevel(null), []);
  const [chosenMode, setMode] = useState<RoomMode>('look');
  const [cameraView, setCameraView] = useState<'first' | 'third'>('third');
  const [respawnNonce, setRespawnNonce] = useState(0);

  // THE ROOM'S DESIGN — the active `room` object on the board, or the standup room —
  // and the designer's hands on it. While a piece is being dragged the designer's
  // preview is what is drawn, so every reading below uses `design`.
  const room = useRoomDesign();
  // A viewer whose edit rights went away mid-design is back to looking — derived from
  // the rights, never reset by an effect, so there is no render where both are true.
  const mode: RoomMode = chosenMode === 'design' && !room.editable ? 'look' : chosenMode;
  const designing = mode === 'design';
  const designer = useFurnitureDesigner(room.design, room.change, designing);
  const design = designer.shown;
  const geometry = useMemo(() => roomDesignGeometry(design), [design]);
  const designSeats = useMemo(() => roomDesignSeats(design), [design]);

  const [spot, placeSession] = useRoomSpot(roomSpotKey(sessionId), DEFAULT_ROOM_SESSION_SPOT);
  const placement = useMemo(() => placeSessionInRoom(spot, geometry), [spot, geometry]);
  const [dragging, setDragging] = useState(false);

  // The STATIONS — registry data read off the board bridge, never branched on here.
  const stations = useRoomStationInstances();
  const [stationKey, setStationKey] = useState<string | null>(null);
  const openStation = stations.find((station) => station.key === stationKey) ?? null;
  const closeStation = useCallback(() => setStationKey(null), []);

  const labelsOf = useCreationLabels();
  /** A Roblox place is played HERE; everything else opens into its own surface. */
  const playOrOpen = useCallback((creation: RoomCreation) => {
    if (creation.placeUrl) setLevel(creation); else onOpenCreation(creation);
  }, [onOpenCreation]);

  // Bodies in the ROOM (no space): someone walking a level is not standing in here.
  const bodies = useMemo(() => {
    const map = new Map<string, CanvasPresenceSpatial>();
    for (const peer of spatialPeers(live, currentUserId)) map.set(peer.userId, peer.spatial);
    return map;
  }, [live, currentUserId]);
  const seats = useMemo(
    () => assignRoomSeats(members, bodies, currentUserId, designSeats),
    [members, bodies, currentUserId, designSeats],
  );

  /**
   * MY OWN PLACE — my position in the roster, which every other client computes for
   * me too, so if my frame never arrives the room still puts me in the right chair.
   */
  const myIndex = useMemo(
    () => Math.max(0, members.findIndex((member) => member.userId === currentUserId)),
    [members, currentUserId],
  );
  const body = useMemo<CanvasPresenceSpatial>(() => {
    const place = roomSeatPlacement(myIndex, Math.max(1, members.length), designSeats);
    return { position: place.position, yaw: place.yaw, seat: myIndex };
  }, [designSeats, myIndex, members.length]);

  // The room announces my body unless a level is being played in it — the level's
  // own walker announces me in THAT space then (`useSpacePresence`).
  const announce = useBodyAnnouncer(onPresence, level === null);
  const walking = mode === 'walk' && !level && !sessionOpen;
  useEffect(() => { if (!walking && !level) announce(body); }, [announce, body, level, walking]);
  const walkMove = useCallback((position: [number, number, number], yaw: number) => announce({ position, yaw }), [announce]);

  // Roblox's look: right-drag, a finger, and the wheel for distance. The left button
  // stays free for the room's own buttons and drags.
  useDragLook(stageRef, { buttons: 'touchAndSecondary', enabled: walking });
  const toggleCamera = useCallback(() => setCameraView((view) => (view === 'first' ? 'third' : 'first')), []);
  const toDoor = useCallback(() => setRespawnNonce((value) => value + 1), []);
  useEffect(() => {
    if (!walking) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.code === 'KeyV' && !isTypingTarget(event.target)) toggleCamera(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCamera, walking]);

  const hereCount = seats.filter((seat) => seat.present).length;
  const objectCount = sceneInput.nodes.length;
  // Laid out only while the diorama is on screen: the open session computes its own.
  const scene = useMemo(() => (sessionOpen ? null : canvas3dScene(sceneInput)), [sceneInput, sessionOpen]);

  // What the room is REPORTING goes in `status` — see the header.
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
  const overlay = session ?? (level
    ? <RoomLevelStage creation={level} title={labelsOf(level).title} onBack={closeLevel} onOpenFull={() => { setLevel(null); onOpenCreation(level); }} />
    : null);

  return (
    <section
      className={styles.surface}
      data-testid="canvas-room-surface"
      data-session={sessionOpen ? 'open' : 'placed'}
      data-mode={level ? 'level' : mode}
      aria-label={t('regionLabel')}
      // Escape steps OUT one level at a time, innermost first, so a keyboard user never
      // skips the room on the way back to the board.
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (openStation) closeStation();
        else if (level) closeLevel();
        else if (sessionOpen) minimizeSession();
        else if (mode !== 'look') setMode('look');
        else onExit();
      }}
    >
      {!webgl ? (
        <div className={styles.fallback} role="status">
          {session ?? <RoomFallback seats={seats} palette={palette} creations={creations} onOpenSession={openSession} onOpenCreation={onOpenCreation} />}
        </div>
      ) : (
        <div className={styles.stage} ref={stageRef}>
          {overlay ?? (
            <>
              <Canvas
                shadows
                camera={{ position: [0, 3.4, 6.4], fov: 55, near: 0.1, far: 160 }}
                {...(designing ? { onPointerMissed: () => designer.select(null) } : {})}
              >
                <RoomGeometryProvider geometry={geometry}>
                  <RoomScene
                    seats={seats}
                    palette={palette}
                    design={design}
                    unknownLabel={t('unknown')}
                    controlsEnabled={!dragging}
                    orbit={!walking}
                    hiddenUserId={walking ? currentUserId : null}
                    speech={speech}
                    thinkingLabel={t('thinking')}
                    onSelectSpeech={onSelectSpeech}
                    selectSpeechLabel={t('showReplyInChat')}
                  >
                    <RoomFurnitureLayer design={design} palette={palette} designing={designing ? designer.designing : undefined} />
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
                            label: labels.openLabel,
                            name: labels.openName,
                            testId: 'room-creation-open',
                            onOpen: () => playOrOpen(creation),
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
                    {walking && <RoomWalk design={design} cameraView={cameraView} walkerColor={palette.self} walkerFaceUrl={seats.find((seat) => seat.isSelf)?.avatarUrl ?? null} respawnNonce={respawnNonce} onMove={walkMove} />}
                  </RoomScene>
                </RoomGeometryProvider>
              </Canvas>
              <RoomModeBar mode={mode} onMode={setMode} walk={{ cameraView, onToggleCamera: toggleCamera, onRespawn: toDoor }} />
              <p className={styles.hint}>{t(walking ? 'walkHint' : designing ? 'design.hint' : 'navigateHint')}</p>
              {walking && <WalkerTouchControls />}
            </>
          )}
        </div>
      )}

      {!overlay && (designing
        ? <RoomDesignerRail room={room} designer={designer} palette={palette} onPublishRoom={onPublishRoom} />
        : <RoomRoster seats={seats} palette={palette} stations={stations} onOpenStation={setStationKey} />)}
      <RoomStationPanel instance={openStation} onClose={closeStation} />
    </section>
  );
}
