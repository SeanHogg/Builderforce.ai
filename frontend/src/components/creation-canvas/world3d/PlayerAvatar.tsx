import { useMemo } from 'react';
import { Color } from 'three';

/**
 * AvatarFigure — the blocky third-person walker figure, built from a handful
 * of boxes centered on the group origin, total height ~2.0 units to match the
 * walker's Rapier `CapsuleCollider` (half-height 0.6 + radius 0.4). Ported
 * unchanged from hired.video's `world-3d/PlayerAvatar.tsx` (there it is also
 * shared with remote-peer rendering; this canvas has no multiplayer, so only
 * the local third-person body uses it).
 *
 * Presentational only — the caller owns the group's position and rotation.
 */

interface AvatarFigureProps {
  color: string;
}

export function AvatarFigure({ color }: AvatarFigureProps) {
  const headColor = useMemo(() => {
    const c = new Color(color);
    c.offsetHSL(0, 0, 0.12);
    return `#${c.getHexString()}`;
  }, [color]);

  return (
    <group>
      <group position={[0, 0.65, 0]}>
        <mesh castShadow><boxGeometry args={[0.55, 0.55, 0.55]} /><meshStandardMaterial color={headColor} /></mesh>
        <mesh position={[-0.13, 0.05, -0.29]}><boxGeometry args={[0.1, 0.12, 0.04]} /><meshStandardMaterial color="#1f2937" /></mesh>
        <mesh position={[0.13, 0.05, -0.29]}><boxGeometry args={[0.1, 0.12, 0.04]} /><meshStandardMaterial color="#1f2937" /></mesh>
      </group>
      <mesh position={[0, 0.05, 0]} castShadow><boxGeometry args={[0.6, 0.65, 0.32]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[-0.43, 0.08, 0]} castShadow><boxGeometry args={[0.22, 0.6, 0.28]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0.43, 0.08, 0]} castShadow><boxGeometry args={[0.22, 0.6, 0.28]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[-0.16, -0.6, 0]} castShadow><boxGeometry args={[0.24, 0.7, 0.3]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0.16, -0.6, 0]} castShadow><boxGeometry args={[0.24, 0.7, 0.3]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}
