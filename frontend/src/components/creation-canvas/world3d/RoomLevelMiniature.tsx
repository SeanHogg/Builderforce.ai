/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo } from 'react';
import type { CanvasWorldProp, CanvasWorldScene } from '@builderforce/creation-canvas-contract';

/**
 * A ROBLOX LEVEL, SMALL ENOUGH TO STAND ON A PLINTH.
 *
 * A place's picture is a poster; its level is a place. So a Roblox game in the room
 * stands as the level itself — every part, at its own position and colour, shrunk
 * until its widest side is `size` — and pressing Play walks you into the full-size
 * version of exactly what you were looking at. Presentational: the stand reads the
 * scene once (`RoomCreationItem`), this only draws it.
 */

/** A level larger than this draws its first parts only: a plinth is not a renderer. */
const MINIATURE_PART_CAP = 400;

interface Fitted {
  scale: number;
  cx: number;
  cz: number;
  floor: number;
  props: readonly CanvasWorldProp[];
}

function fit(scene: CanvasWorldScene, size: number): Fitted | null {
  const props = scene.props.filter((prop) => prop.kind !== 'light').slice(0, MINIATURE_PART_CAP);
  if (!props.length) return null;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let floor = Infinity;
  for (const prop of props) {
    minX = Math.min(minX, prop.position[0] - prop.scale[0] / 2);
    maxX = Math.max(maxX, prop.position[0] + prop.scale[0] / 2);
    minZ = Math.min(minZ, prop.position[2] - prop.scale[2] / 2);
    maxZ = Math.max(maxZ, prop.position[2] + prop.scale[2] / 2);
    floor = Math.min(floor, prop.position[1] - prop.scale[1] / 2);
  }
  const extent = Math.max(maxX - minX, maxZ - minZ, 1e-3);
  return { scale: size / extent, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, floor, props };
}

export function RoomLevelMiniature({ scene, size, base }: { scene: CanvasWorldScene; size: number; base: string }) {
  const fitted = useMemo(() => fit(scene, size), [scene, size]);
  if (!fitted) return null;
  const { scale, cx, cz, floor, props } = fitted;
  return (
    <group>
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[size, 0.02, size]} />
        <meshStandardMaterial color={scene.ground.color || base} />
      </mesh>
      {props.map((prop) => {
        const at: [number, number, number] = [
          (prop.position[0] - cx) * scale,
          0.02 + (prop.position[1] - floor) * scale,
          (prop.position[2] - cz) * scale,
        ];
        const dims: [number, number, number] = [prop.scale[0] * scale, prop.scale[1] * scale, prop.scale[2] * scale];
        const round = prop.kind === 'sphere' || prop.kind === 'collectible';
        return (
          <mesh key={prop.id} position={at} rotation={prop.rotation} castShadow>
            {round ? <sphereGeometry args={[Math.max(...dims) / 2, 10, 8]} /> : <boxGeometry args={dims} />}
            <meshStandardMaterial color={prop.color} transparent={prop.kind === 'goal'} opacity={prop.kind === 'goal' ? 0.5 : 1} />
          </mesh>
        );
      })}
    </group>
  );
}
