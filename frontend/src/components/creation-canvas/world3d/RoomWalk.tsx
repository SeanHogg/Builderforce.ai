/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo } from 'react';
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from '@react-three/rapier';
import {
  ROOM_FURNITURE_SPECS, roomDesignSpawn,
  type CanvasRoomDesign, type CanvasWorldTransform,
} from '@builderforce/creation-canvas-contract';
import PlayerController from './PlayerController';
import { furnitureDims } from './RoomFurnitureMesh';

/**
 * WALKING THE ROOM — the room's walls and furniture as colliders, and a walker in it.
 *
 * The same runtime a `world` is walked in (`PlayerController`, Rapier), with the
 * room's own look: Roblox's drag-to-look rather than a locked pointer, because the
 * left button in the room still has buttons to press. Every wall is solid, and so is
 * every piece the design calls `solid` — a table, a partition, a fridge — while a rug
 * and a chair are walked over or into, which is what a person does with them.
 *
 * The colliders come from the SAME dimensions the meshes are drawn at
 * (`furnitureDims`), so what you bump into is what you see.
 */

const WALL_THICKNESS = 0.2;
/** Where the walker's capsule centre starts: its feet on the floor. */
const SPAWN_HEIGHT = 1.1;

export interface RoomWalkProps {
  design: CanvasRoomDesign;
  cameraView: 'first' | 'third';
  walkerColor: string;
  respawnNonce: number;
  /** The walker's feet and heading, every frame it moved. */
  onMove: (position: [number, number, number], yaw: number) => void;
}

export function RoomWalk({ design, cameraView, walkerColor, respawnNonce, onMove }: RoomWalkProps) {
  const hw = design.floor.width / 2;
  const hd = design.floor.depth / 2;
  const wall = design.wall.height;
  const spawn = useMemo<CanvasWorldTransform>(() => {
    const at = roomDesignSpawn(design);
    return { position: [at.position[0], SPAWN_HEIGHT, at.position[2]], rotation: [0, at.yaw, 0], scale: [1, 1, 1] };
  }, [design]);

  const solids = useMemo(() => design.furniture.filter((item) => ROOM_FURNITURE_SPECS[item.kind].solid), [design.furniture]);

  return (
    <Physics gravity={[0, -9.81, 0]}>
      <RigidBody type="fixed" colliders={false}>
        {/* The floor, a little wider than the room so an edge is never a drop. */}
        <CuboidCollider args={[hw + 1, 0.5, hd + 1]} position={[0, -0.5, 0]} />
        {/* Four walls. The front one is not drawn — the camera stands there — but it
            is solid, so the room is a room from inside it. */}
        <CuboidCollider args={[hw, wall / 2, WALL_THICKNESS / 2]} position={[0, wall / 2, -hd - WALL_THICKNESS / 2]} />
        <CuboidCollider args={[hw, wall / 2, WALL_THICKNESS / 2]} position={[0, wall / 2, hd + WALL_THICKNESS / 2]} />
        <CuboidCollider args={[WALL_THICKNESS / 2, wall / 2, hd]} position={[-hw - WALL_THICKNESS / 2, wall / 2, 0]} />
        <CuboidCollider args={[WALL_THICKNESS / 2, wall / 2, hd]} position={[hw + WALL_THICKNESS / 2, wall / 2, 0]} />
        {solids.map((item) => {
          const spec = ROOM_FURNITURE_SPECS[item.kind];
          const { w, h, d } = furnitureDims(item);
          // A wall-mounted piece's origin is its centre; everything else stands on y = 0.
          const cy = spec.wallMounted ? item.position[1] : item.position[1] + h / 2;
          const at: [number, number, number] = [item.position[0], cy, item.position[2]];
          return spec.round
            ? <CylinderCollider key={item.id} args={[h / 2, Math.max(w, d) / 2]} position={at} />
            : <CuboidCollider key={item.id} args={[w / 2, h / 2, Math.max(0.05, d / 2)]} position={at} rotation={[0, item.yaw, 0]} />;
        })}
      </RigidBody>
      <PlayerController
        spawn={spawn}
        respawnNonce={respawnNonce}
        cameraView={cameraView}
        walkerColor={walkerColor}
        look="drag"
        onMove={onMove}
      />
    </Physics>
  );
}
