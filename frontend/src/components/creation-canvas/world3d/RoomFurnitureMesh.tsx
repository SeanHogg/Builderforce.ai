/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import type { ReactNode } from 'react';
import {
  ROOM_FURNITURE_SPECS, type RoomFurniture, type RoomFurnitureKind,
} from '@builderforce/creation-canvas-contract';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { RoomMeshModel } from './RoomMeshModel';
import { SurfacePanel } from './SurfacePanel';

/**
 * ONE PIECE OF FURNITURE — the mesh a `RoomFurniture` is, picked from its kind.
 *
 * The single place "what does each kind look like" is decided, the way `PropMesh`
 * is for a world's props: adding a kind is one entry in `ROOM_FURNITURE_SPECS`
 * (what it MEANS — seats, rests, solid) and one shape here (what it LOOKS like).
 * Every shape is built from the piece's own dimensions (footprint × scale), so a
 * stretched table is a longer table rather than a thicker one.
 *
 * Local frame: the piece stands on y = 0 and faces −Z, so a chair's back is on +Z
 * and a person sat on it looks toward −Z. A wall-mounted piece is the exception —
 * its origin is its CENTRE (it hangs at a height) and its picture faces +Z, into
 * the room from the wall behind it.
 *
 * Presentational: it is handed the palette and draws; the room decides where.
 */

type Dims = { w: number; h: number; d: number };
type Shape = (dims: Dims, color: string, accent: string) => ReactNode;

function Box({ size, at, color }: { size: [number, number, number]; at: [number, number, number]; color: string }) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Legs({ w, d, h, color, inset = 0.06, thick = 0.05 }: Dims & { color: string; inset?: number; thick?: number }) {
  const x = w / 2 - inset;
  const z = d / 2 - inset;
  return (
    <>
      {([[-x, -z], [x, -z], [-x, z], [x, z]] as const).map(([lx, lz]) => (
        <Box key={`${lx}:${lz}`} size={[thick, h, thick]} at={[lx, h / 2, lz]} color={color} />
      ))}
    </>
  );
}

const TOP = 0.06;

const SHAPES: Readonly<Record<Exclude<RoomFurnitureKind, 'model' | 'whiteboard' | 'screen' | 'poster'>, Shape>> = {
  tableRound: ({ w, h }, color) => (
    <>
      <mesh position={[0, h - TOP / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[w / 2, w / 2, TOP, 40]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, (h - TOP) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.34, h - TOP, 20]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </>
  ),
  tableLong: ({ w, h, d }, color) => <>
    <Box size={[w, TOP, d]} at={[0, h - TOP / 2, 0]} color={color} />
    <Legs w={w} d={d} h={h - TOP} color={color} inset={0.3} thick={0.09} />
  </>,
  desk: ({ w, h, d }, color) => <>
    <Box size={[w, TOP, d]} at={[0, h - TOP / 2, 0]} color={color} />
    <Legs w={w} d={d} h={h - TOP} color={color} />
  </>,
  counter: ({ w, h, d }, color, accent) => <>
    <Box size={[w, h - TOP, d * 0.94]} at={[0, (h - TOP) / 2, 0]} color={color} />
    <Box size={[w, TOP, d]} at={[0, h - TOP / 2, 0]} color={accent} />
  </>,
  chair: ({ w, h, d }, color) => {
    const seat = h * 0.5;
    return <>
      <Box size={[w, 0.06, d]} at={[0, seat, 0]} color={color} />
      <Box size={[w, h - seat, 0.06]} at={[0, seat + (h - seat) / 2, d / 2 - 0.03]} color={color} />
      <Legs w={w} d={d} h={seat} color={color} thick={0.04} />
    </>;
  },
  stool: ({ w, h }, color) => <>
    <mesh position={[0, h - 0.03, 0]} castShadow><cylinderGeometry args={[w / 2, w / 2, 0.06, 24]} /><meshStandardMaterial color={color} /></mesh>
    <mesh position={[0, (h - 0.06) / 2, 0]} castShadow><cylinderGeometry args={[0.04, 0.12, h - 0.06, 12]} /><meshStandardMaterial color={color} /></mesh>
  </>,
  sofa: ({ w, h, d }, color) => {
    const base = h * 0.52;
    return <>
      <Box size={[w, base, d]} at={[0, base / 2, 0]} color={color} />
      <Box size={[w, h - base, 0.22]} at={[0, base + (h - base) / 2, d / 2 - 0.11]} color={color} />
      <Box size={[0.18, base + 0.14, d]} at={[-w / 2 + 0.09, (base + 0.14) / 2, 0]} color={color} />
      <Box size={[0.18, base + 0.14, d]} at={[w / 2 - 0.09, (base + 0.14) / 2, 0]} color={color} />
    </>;
  },
  partition: ({ w, h, d }, color) => <Box size={[w, h, d]} at={[0, h / 2, 0]} color={color} />,
  shelf: ({ w, h, d }, color) => <>
    <Box size={[0.04, h, d]} at={[-w / 2 + 0.02, h / 2, 0]} color={color} />
    <Box size={[0.04, h, d]} at={[w / 2 - 0.02, h / 2, 0]} color={color} />
    {[0.02, 0.35, 0.68, 0.98].map((f) => <Box key={f} size={[w, 0.03, d]} at={[0, h * f, 0]} color={color} />)}
  </>,
  fridge: ({ w, h, d }, color, accent) => <>
    <Box size={[w, h, d]} at={[0, h / 2, 0]} color={color} />
    <Box size={[0.03, h * 0.3, 0.03]} at={[w / 2 - 0.1, h * 0.62, -d / 2 - 0.02]} color={accent} />
  </>,
  plant: ({ w, h }, color, accent) => <>
    <mesh position={[0, 0.18, 0]} castShadow><cylinderGeometry args={[w * 0.38, w * 0.28, 0.36, 16]} /><meshStandardMaterial color={accent} /></mesh>
    <mesh position={[0, 0.36 + (h - 0.36) / 2, 0]} castShadow><sphereGeometry args={[Math.max(w / 2, (h - 0.36) / 2), 16, 12]} /><meshStandardMaterial color={color} /></mesh>
  </>,
  lamp: ({ w, h }, color, accent) => <>
    <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[w / 2, w / 2, 0.04, 16]} /><meshStandardMaterial color={accent} /></mesh>
    <mesh position={[0, h / 2, 0]}><cylinderGeometry args={[0.02, 0.02, h, 8]} /><meshStandardMaterial color={accent} /></mesh>
    <mesh position={[0, h - 0.12, 0]}><coneGeometry args={[w / 2, 0.26, 16, 1, true]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} /></mesh>
  </>,
  rug: ({ w, h, d }, color) => (
    <mesh position={[0, h / 2 + 0.004, 0]} receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} />
    </mesh>
  ),
};

/** Which theme role paints a kind that has no colour of its own. */
function paletteColor(kind: RoomFurnitureKind, palette: RoomPalette): string {
  switch (kind) {
    case 'chair': case 'stool': case 'sofa': return palette.body;
    case 'partition': case 'shelf': case 'poster': return palette.panel;
    default: return palette.table;
  }
}

/** The dimensions a piece is drawn at. Exported so its collider matches its mesh. */
export function furnitureDims(item: RoomFurniture): Dims {
  const [w, h, d] = ROOM_FURNITURE_SPECS[item.kind].footprint;
  return { w: w * item.scale[0], h: h * item.scale[1], d: d * item.scale[2] };
}

export interface RoomFurnitureMeshProps {
  item: RoomFurniture;
  palette: RoomPalette;
  /** Drawn with the designer's selection ring under it. */
  selected?: boolean;
}

export function RoomFurnitureMesh({ item, palette, selected = false }: RoomFurnitureMeshProps) {
  const spec = ROOM_FURNITURE_SPECS[item.kind];
  const dims = furnitureDims(item);
  const color = item.color ?? spec.color ?? paletteColor(item.kind, palette);
  const accent = palette.chair;

  let body: ReactNode;
  if (spec.wallMounted) {
    // A board on the wall: a frame, and its face (a picture when it has one).
    body = <>
      <Box size={[dims.w + 0.06, dims.h + 0.06, Math.max(0.02, dims.d)]} at={[0, 0, 0]} color={accent} />
      <SurfacePanel width={dims.w} height={dims.h} color={color} imageUrl={item.imageUrl} fit="contain" offset={dims.d / 2 + 0.004} />
    </>;
  } else if (item.kind === 'model') {
    const size = Math.max(dims.w, dims.h, dims.d);
    const placeholder = <Box size={[dims.w, dims.h, dims.d]} at={[0, dims.h / 2, 0]} color={color} />;
    body = item.model
      ? <RoomMeshModel url={item.model.url} format={item.model.format} color={color} fallback={placeholder} size={size} />
      : placeholder;
  } else {
    body = SHAPES[item.kind as keyof typeof SHAPES](dims, color, accent);
  }

  return (
    <group position={item.position} rotation={[0, item.yaw, 0]}>
      {body}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, spec.wallMounted ? -dims.h / 2 - 0.02 : 0.015, 0]}>
          <ringGeometry args={[Math.max(dims.w, dims.d) * 0.55, Math.max(dims.w, dims.d) * 0.55 + 0.06, 40]} />
          <meshBasicMaterial color="#3b82f6" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
