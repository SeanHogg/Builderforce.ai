/*
 * No `'use client'` — mounted only inside `CanvasWorldView`, which is itself
 * dynamically imported with `ssr: false` (see `CreationCanvas.tsx`). A second
 * boundary here would mark an entry point that does not exist.
 */
import { useMemo } from 'react';
import { BallCollider, CuboidCollider, RigidBody } from '@react-three/rapier';
import type { ThreeEvent } from '@react-three/fiber';
import type { CanvasWorldPhysicsKind, CanvasWorldProp, CanvasWorldPropKind } from '@builderforce/creation-canvas-contract';

/**
 * PropMesh — renders one `CanvasWorldProp` as the right Three.js mesh + the
 * right Rapier collider, picked from its `kind`. This is the single place
 * "what does each kind look like" is decided; adding a kind is one entry
 * here plus one in `PROP_KIND_DEFAULTS` (`@builderforce/creation-canvas-contract`).
 *
 * Ported from hired.video's `EntityMesh.tsx` — selection outline stays here
 * so the host scene doesn't need a per-prop gizmo overlay. Trimmed: no
 * texture mapping, no tag, no sensor-trigger event (challenges are out of
 * scope for this canvas's authoring surface — see `world.ts`'s header).
 */

interface PropMeshProps {
  prop: CanvasWorldProp;
  /** Edit mode shows selection chrome and makes the prop clickable. Walk
   *  mode drops both — the player is exploring, not authoring. */
  mode: 'edit' | 'walk';
  selected: boolean;
  onSelect?: (id: string) => void;
}

function physicsToRapierType(kind: CanvasWorldPhysicsKind): 'fixed' | 'dynamic' | 'kinematicPosition' {
  switch (kind) {
    case 'static': return 'fixed';
    case 'dynamic': return 'dynamic';
    case 'kinematic': return 'kinematicPosition';
    case 'sensor':
    case 'none':
      return 'fixed';
  }
}

export default function PropMesh({ prop, mode, selected, onSelect }: PropMeshProps) {
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (mode !== 'edit' || !onSelect) return;
    // Stop the click bubbling to the ground's deselect handler.
    event.stopPropagation();
    onSelect(prop.id);
  };

  if (prop.physics === 'none') {
    return (
      <group position={prop.position} rotation={prop.rotation} scale={prop.scale}>
        <KindMesh kind={prop.kind} color={prop.color} selected={selected} onClick={handleClick} />
      </group>
    );
  }

  const isSensor = prop.physics === 'sensor';
  return (
    <RigidBody type={physicsToRapierType(prop.physics)} position={prop.position} rotation={prop.rotation} colliders={false} sensor={isSensor}>
      <KindCollider kind={prop.kind} scale={prop.scale} sensor={isSensor} />
      <group scale={prop.scale}>
        <KindMesh kind={prop.kind} color={prop.color} selected={selected} onClick={handleClick} />
      </group>
    </RigidBody>
  );
}

interface KindMeshProps {
  kind: CanvasWorldPropKind;
  color: string;
  selected: boolean;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}

function KindMesh({ kind, color, selected, onClick }: KindMeshProps) {
  const material = (
    <meshStandardMaterial
      color={color}
      // Slight emissive on selection so the chrome reads even in shadow.
      emissive={selected ? '#3b82f6' : '#000000'}
      emissiveIntensity={selected ? 0.4 : 0}
    />
  );

  switch (kind) {
    case 'block':
    case 'platform':
    case 'hazard':
      return <mesh onClick={onClick} castShadow receiveShadow><boxGeometry args={[1, 1, 1]} />{material}</mesh>;
    case 'ramp':
      // Right-triangular prism approximated by a slanted thin box — a proper
      // ramp mesh is a follow-on once a geometry library is in scope.
      return <mesh onClick={onClick} castShadow receiveShadow rotation={[0, 0, -Math.PI / 6]}><boxGeometry args={[1, 0.2, 1]} />{material}</mesh>;
    case 'sphere':
    case 'collectible':
      return <mesh onClick={onClick} castShadow receiveShadow><sphereGeometry args={[0.5, 24, 18]} />{material}</mesh>;
    case 'goal':
      // Translucent so the walker can tell it's a pass-through zone, not a wall.
      return (
        <mesh onClick={onClick}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} transparent opacity={0.4} emissive={selected ? '#3b82f6' : color} emissiveIntensity={selected ? 0.5 : 0.2} />
        </mesh>
      );
    case 'light':
      return (
        <group>
          <pointLight color={color} intensity={1.5} distance={20} castShadow />
          <mesh onClick={onClick}><sphereGeometry args={[0.3, 12, 8]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} /></mesh>
        </group>
      );
  }
}

interface KindColliderProps {
  kind: CanvasWorldPropKind;
  scale: [number, number, number];
  sensor?: boolean;
}

/** Rapier collider sized to match the prop's authored scale — the mesh
 *  inside the RigidBody is scale-wrapped too, so the visuals and the
 *  collider stay locked together. */
function KindCollider({ kind, scale, sensor = false }: KindColliderProps) {
  const halfExtents = useMemo<[number, number, number]>(() => [scale[0] / 2, scale[1] / 2, scale[2] / 2], [scale]);
  const sphereRadius = useMemo(() => Math.max(scale[0], scale[1], scale[2]) / 2, [scale]);

  switch (kind) {
    case 'sphere':
    case 'collectible':
      return <BallCollider args={[sphereRadius]} sensor={sensor} />;
    case 'block':
    case 'platform':
    case 'ramp':
    case 'hazard':
    case 'goal':
    case 'light':
      return <CuboidCollider args={halfExtents} sensor={sensor} />;
  }
}
