/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { Html, OrbitControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import {
  ROOM_EYE_HEIGHT, ROOM_FLOOR_SIZE, ROOM_PANEL_HEIGHT, ROOM_PANEL_WIDTH,
  ROOM_SEAT_RADIUS, ROOM_TABLE_HEIGHT, ROOM_TABLE_RADIUS, ROOM_WALL_Z,
  bodyColor, seatPlacement,
  type RoomPalette, type RoomPanel, type RoomSeat,
} from '@/lib/canvas/roomSeating';
import { PeerAvatar } from './PeerAvatar';
import { SurfacePanel } from './SurfacePanel';

/**
 * THE ROOM — a floor, a table, a ring of people and a wall of the work.
 *
 * Presentational by contract: it draws exactly what {@link assignRoomSeats} and
 * {@link wallPanels} hand it and computes no layout of its own. That separation
 * is what lets the geometry be checked by a test instead of by squinting, and
 * it is why this file has no arithmetic in it beyond turning a metre into a
 * mesh.
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
 * camera is outside the ring looking in, and your own body is drawn with
 * everybody else's — you see the room the same way the room sees you.
 */

export interface RoomSceneProps {
  seats: readonly RoomSeat[];
  panels: readonly RoomPanel[];
  palette: RoomPalette;
  /** Label for a peer the roster has not named yet. Translated by the host. */
  unknownLabel: string;
  onSelectObject?: ((objectId: string) => void) | undefined;
}

export function RoomScene({ seats, panels, palette, unknownLabel, onSelectObject }: RoomSceneProps) {
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

      {/* The wall the work hangs on. Slightly behind the panels so the two
          never fight for the same depth — see SurfacePanel's own offset. */}
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
          live={seat.live}
        />
      ))}

      {panels.map((panel) => (
        <WallPanel
          key={panel.objectId}
          panel={panel}
          palette={palette}
          {...(onSelectObject ? { onSelect: () => onSelectObject(panel.objectId) } : {})}
        />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        target={[0, ROOM_EYE_HEIGHT * 0.8, 0]}
        minDistance={3}
        maxDistance={12}
        // Never below the floor and never straight down: both are views of a
        // room from somewhere nobody can stand.
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.06}
      />
    </>
  );
}

interface WallPanelProps {
  panel: RoomPanel;
  palette: RoomPalette;
  onSelect?: (() => void) | undefined;
}

/**
 * One board object on the wall.
 *
 * A backing board in the room's own panel colour, the object's colour painted
 * on its face through the shared {@link SurfacePanel}, and the object's title
 * under it. The title is the whole reason the wall is worth drawing — a grid of
 * anonymous coloured rectangles is wallpaper, not the team's work.
 */
function WallPanel({ panel, palette, onSelect }: WallPanelProps) {
  const click = onSelect
    ? (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }
    : undefined;

  return (
    <group position={panel.position}>
      <mesh receiveShadow {...(click ? { onClick: click } : {})}>
        <planeGeometry args={[ROOM_PANEL_WIDTH, ROOM_PANEL_HEIGHT]} />
        <meshStandardMaterial color={palette.panel} />
      </mesh>
      <SurfacePanel
        width={ROOM_PANEL_WIDTH - 0.16}
        height={ROOM_PANEL_HEIGHT - 0.16}
        color={panel.color}
        imageUrl={panel.preview}
        fit="contain"
        {...(click ? { onClick: click } : {})}
      />
      <Html position={[0, -(ROOM_PANEL_HEIGHT / 2) - 0.16, 0.02]} center distanceFactor={9} pointerEvents="none" zIndexRange={[10, 0]}>
        <span
          style={{
            display: 'block',
            maxWidth: 190,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            lineHeight: 1.4,
            color: 'var(--text-primary, #f5f5f5)',
            textShadow: '0 1px 2px rgba(0,0,0,.35)',
          }}
        >
          {panel.label}
        </span>
      </Html>
    </group>
  );
}

