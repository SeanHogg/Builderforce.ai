/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import type { ReactNode } from 'react';
import { OrbitControls } from '@react-three/drei';
import {
  ROOM_EYE_HEIGHT, ROOM_FLOOR_SIZE, ROOM_SEAT_RADIUS, ROOM_TABLE_HEIGHT, ROOM_TABLE_RADIUS, ROOM_WALL_Z,
  bodyColor, seatPlacement,
  type RoomPalette, type RoomSeat,
} from '@/lib/canvas/roomSeating';
import { PeerAvatar } from './PeerAvatar';

/**
 * THE ROOM — a floor, a table, a ring of people, a back wall, and whatever the
 * surface puts in it.
 *
 * Presentational by contract: it draws exactly what {@link assignRoomSeats} hands
 * it and computes no layout of its own. That separation is what lets the geometry
 * be checked by a test instead of by squinting, and it is why this file has no
 * arithmetic in it beyond turning a metre into a mesh.
 *
 * ── WHY THE WORK IS NOT DRAWN HERE ───────────────────────────────────────────
 * The room used to hang a capped, newest-first wall of the board's objects behind
 * the ring — a SECOND 3D reading of the board beside the "3D space" surface, with
 * its own cap, its own layout and its own way of drawing a card. The session is
 * now ONE thing the surface places in the room (`RoomSessionDiorama`), rendered
 * as `children` so this scene stays about the room and the diorama stays about
 * the board. The wall is still here, blank, because it is one of the places the
 * session can hang.
 *
 * ── WHY EVERY MEMBER GETS A CHAIR, NOT ONLY THE LIVE ONES ────────────────────
 * A standup where people appear only once they move is a standup where you
 * cannot tell "nobody joined" from "nobody has spoken". So the room seats the
 * whole roster and marks who is actually HERE — a lit body with a bright plate
 * for a peer the relay has heard from, a dimmed one for a member who is on the
 * board rather than in the room. Two states, one list, no guessing.
 *
 * ── WHY THE CAMERA ORBITS RATHER THAN WALKS ──────────────────────────────────
 * Walking belongs to the `world` and `play` surfaces, where the space itself is
 * the thing. A fifteen-minute standup is not improved by pointer lock and a
 * jump key; it is improved by being able to see every face at once. So the
 * camera orbits the table, pans across the room and zooms — enough to look at
 * anything in it from anywhere a person could stand — and your own body is
 * drawn with everybody else's.
 */

export interface RoomSceneProps {
  seats: readonly RoomSeat[];
  palette: RoomPalette;
  /** Label for a peer the roster has not named yet. Translated by the host. */
  unknownLabel: string;
  /**
   * Whether the camera answers the pointer. False while something IN the room is
   * being dragged, because a drag that also orbits the camera is a drag that
   * moves the floor out from under the thing being placed.
   */
  controlsEnabled?: boolean;
  /** What the surface puts in the room — the session, and every 3D creation on the board. */
  children?: ReactNode;
}

export function RoomScene({ seats, palette, unknownLabel, controlsEnabled = true, children }: RoomSceneProps) {
  const wallHeight = 4.2;

  return (
    <>
      <color attach="background" args={[palette.sky]} />
      <ambientLight intensity={palette.ambient} />
      <directionalLight
        position={[4, 9, 5]}
        intensity={palette.sun}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />

      {/* Floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[ROOM_FLOOR_SIZE, ROOM_FLOOR_SIZE]} />
        <meshStandardMaterial color={palette.floor} />
      </mesh>

      {/* The back wall. Slightly behind the wall's own anchor depth so a session
          hung on it never fights it for the same pixels. */}
      <mesh position={[0, wallHeight / 2, ROOM_WALL_Z - 0.06]} receiveShadow>
        <planeGeometry args={[ROOM_FLOOR_SIZE, wallHeight]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Table: a top on a column, sized from the same radius the ring uses. */}
      <group position={[0, 0, 0]}>
        <mesh castShadow receiveShadow position={[0, ROOM_TABLE_HEIGHT, 0]}>
          <cylinderGeometry args={[ROOM_TABLE_RADIUS, ROOM_TABLE_RADIUS, 0.08, 40]} />
          <meshStandardMaterial color={palette.table} />
        </mesh>
        <mesh castShadow position={[0, ROOM_TABLE_HEIGHT / 2, 0]}>
          <cylinderGeometry args={[0.22, 0.34, ROOM_TABLE_HEIGHT, 20]} />
          <meshStandardMaterial color={palette.table} />
        </mesh>
      </group>

      {/* A ring mark under each place, so an empty room still reads as a room
          laid out for people rather than as an empty floor. */}
      {seats.map((seat) => {
        const mark = seatPlacement(seat.index, seats.length, ROOM_SEAT_RADIUS);
        return (
          <mesh key={`mark-${seat.userId}`} rotation={[-Math.PI / 2, 0, 0]} position={[mark.position[0], 0.012, mark.position[2]]}>
            <ringGeometry args={[0.42, 0.52, 28]} />
            <meshBasicMaterial color={palette.chair} toneMapped={false} />
          </mesh>
        );
      })}

      {seats.map((seat) => (
        <PeerAvatar
          key={seat.userId}
          position={seat.position}
          yaw={seat.yaw}
          color={bodyColor(seat.userId, palette, seat.isSelf)}
          label={seat.displayName || unknownLabel}
          live={seat.present}
        />
      ))}

      {children}

      <OrbitControls
        enabled={controlsEnabled}
        enableDamping
        dampingFactor={0.1}
        enablePan
        target={[0, ROOM_EYE_HEIGHT * 0.8, 0]}
        minDistance={1.2}
        maxDistance={14}
        // Never below the floor and never straight down: both are views of a
        // room from somewhere nobody can stand.
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.06}
      />
    </>
  );
}
