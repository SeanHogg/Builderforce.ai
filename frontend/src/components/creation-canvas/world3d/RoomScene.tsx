/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo, type ReactNode } from 'react';
import { OrbitControls } from '@react-three/drei';
import { roomDesignSeats, type CanvasRoomDesign } from '@builderforce/creation-canvas-contract';
import {
  ROOM_EYE_HEIGHT, ROOM_SEAT_RADIUS,
  bodyColor, seatPlacement,
  type RoomPalette, type RoomSeat,
} from '@/lib/canvas/roomSeating';
import type { RoomSpeech } from '@/lib/canvas/roomSpeech';
import { PeerAvatar } from './PeerAvatar';

/**
 * THE ROOM — a floor, its walls, a ring (or the chairs) of people, and whatever the
 * surface puts in it.
 *
 * Presentational by contract: it draws the SHELL of the design it is handed — the
 * floor at the design's size, the walls at its height, in its colours or the theme's
 * — and the bodies {@link assignRoomSeats} placed. The furniture, the session, the
 * creations and the stations are `children`, so this scene stays about the room and
 * never learns what stands in it.
 *
 * ── WHY EVERY MEMBER GETS A PLACE, NOT ONLY THE LIVE ONES ────────────────────
 * A standup where people appear only once they move is a standup where you cannot
 * tell "nobody joined" from "nobody has spoken". So the room places the whole roster
 * and marks who is actually HERE — a lit plate for a peer the relay has heard from, a
 * dimmed one for a member who is on the board rather than in the room.
 *
 * ── WHY AGENTS SPEAK OVER THEIR HEADS ────────────────────────────────────────
 * When several agents answer one turn, a room where the only sign any of them
 * spoke is a scroll of text in a side panel is not a meeting. So each reply is
 * drawn over the head of the agent who gave it, and an agent still working says
 * so. What each seat is saying is read off the conversation by the host
 * (`lib/canvas/roomSpeech.ts`); this scene only puts it over the right seat.
 *
 * ── LOOKING AND WALKING ──────────────────────────────────────────────────────
 * The camera orbits by default — the right way to see every face at a standup. When
 * the reader chooses to walk, the walker owns the camera (`orbit: false`), and the
 * reader's own body is theirs to draw (`hiddenUserId`), not a figure parked in a chair.
 */

export interface RoomSceneProps {
  seats: readonly RoomSeat[];
  palette: RoomPalette;
  design: CanvasRoomDesign;
  /** Label for a peer the roster has not named yet. Translated by the host. */
  unknownLabel: string;
  /** Whether the orbit camera answers the pointer — false while something is dragged. */
  controlsEnabled?: boolean;
  /** False while walking: the walker owns the camera. */
  orbit?: boolean;
  /** A body NOT drawn at its seat — the viewer's, while their walker is their body. */
  hiddenUserId?: string | null;
  /** What each seat is saying, keyed by `RoomSeat.userId` (`lib/canvas/roomSpeech.ts`). */
  speech?: ReadonlyMap<string, RoomSpeech>;
  /** Shown over an agent still working on its reply. Translated by the host. */
  thinkingLabel?: string;
  children?: ReactNode;
}

/** A seat's bubble: its reply, or the thinking line while it works; nothing otherwise. */
function bubbleFor(said: RoomSpeech | undefined, thinkingLabel: string | undefined): { text: string; pending: boolean } | null {
  const text = said?.text ?? (said?.pending ? thinkingLabel : undefined);
  return said && text ? { text, pending: said.pending } : null;
}

export function RoomScene({
  seats, palette, design, unknownLabel, controlsEnabled = true, orbit = true, hiddenUserId = null,
  speech, thinkingLabel, children,
}: RoomSceneProps) {
  const width = design.floor.width;
  const depth = design.floor.depth;
  const wallHeight = design.wall.height;
  const wallColor = design.wall.color ?? palette.wall;
  // The ring marks belong to the standup room: a room with chairs marks its places
  // with the chairs themselves.
  const ringed = useMemo(() => roomDesignSeats(design).length === 0, [design]);
  const shadowReach = Math.max(width, depth) / 2 + 2;

  return (
    <>
      <color attach="background" args={[design.sky ?? palette.sky]} />
      <ambientLight intensity={palette.ambient} />
      <directionalLight
        position={[4, 9, 5]}
        intensity={palette.sun}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-shadowReach}
        shadow-camera-right={shadowReach}
        shadow-camera-top={shadowReach}
        shadow-camera-bottom={-shadowReach}
      />

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={design.floor.color ?? palette.floor} />
      </mesh>

      {/* The back wall — where a session and a creation can hang — and the two side
          walls. Slightly outside the floor's edge so a thing hung on a wall never
          fights it for the same pixels. The front wall is where the camera stands. */}
      <mesh position={[0, wallHeight / 2, -depth / 2 - 0.06]} receiveShadow>
        <planeGeometry args={[width, wallHeight]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <mesh position={[-width / 2 - 0.06, wallHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, wallHeight]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <mesh position={[width / 2 + 0.06, wallHeight / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, wallHeight]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>

      {ringed && seats.map((seat) => {
        const mark = seatPlacement(seat.index, seats.length, ROOM_SEAT_RADIUS);
        return (
          <mesh key={`mark-${seat.userId}`} rotation={[-Math.PI / 2, 0, 0]} position={[mark.position[0], 0.012, mark.position[2]]}>
            <ringGeometry args={[0.42, 0.52, 28]} />
            <meshBasicMaterial color={palette.chair} toneMapped={false} />
          </mesh>
        );
      })}

      {seats.filter((seat) => seat.userId !== hiddenUserId).map((seat) => (
        <PeerAvatar
          key={seat.userId}
          position={seat.position}
          yaw={seat.yaw}
          color={bodyColor(seat.userId, palette, seat.isSelf)}
          label={seat.displayName || unknownLabel}
          avatarUrl={seat.avatarUrl}
          live={seat.present}
          speech={bubbleFor(speech?.get(seat.userId), thinkingLabel)}
        />
      ))}

      {children}

      {orbit && (
        <OrbitControls
          enabled={controlsEnabled}
          enableDamping
          dampingFactor={0.1}
          enablePan
          target={[0, ROOM_EYE_HEIGHT * 0.8, 0]}
          minDistance={1.2}
          maxDistance={Math.max(14, Math.max(width, depth) * 1.2)}
          // Never below the floor and never straight down: both are views of a
          // room from somewhere nobody can stand.
          minPolarAngle={0.25}
          maxPolarAngle={Math.PI / 2 - 0.06}
        />
      )}
    </>
  );
}
