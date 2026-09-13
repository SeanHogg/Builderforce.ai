import { useMemo } from 'react';
import { Color } from 'three';
import { useFaceTexture } from './useFaceTexture';

/**
 * AvatarFigure — the blocky third-person walker figure, built from a handful
 * of boxes centered on the group origin, total height ~2.0 units to match the
 * walker's Rapier `CapsuleCollider` (half-height 0.6 + radius 0.4). Ported
 * from hired.video's `world-3d/PlayerAvatar.tsx`, and — as there — shared by
 * the local walker and every remote person (`PeerAvatar`).
 *
 * ── A FACE, WHEN THE PERSON HAS ONE ──────────────────────────────────────────
 * Given `faceUrl`, the front of the head wears that person's profile picture in
 * place of the two eyes, so a colleague in the room is recognisably them rather
 * than a colour. Unlit (`meshBasicMaterial`, no tone mapping): a face is for
 * recognising, and the room's side-lighting would put half the table's faces in
 * shadow. Until the picture loads — or if it never can — the eyes stay.
 *
 * Presentational only — the caller owns the group's position and rotation.
 */

interface AvatarFigureProps {
  color: string;
  /** The person's profile picture, drawn as the face. Absent draws the eyes. */
  faceUrl?: string | null;
}

/** The head is a 0.55 cube; the face sits just proud of its front (-Z) side. */
const FACE_SIZE = 0.5;
const FACE_Z = -0.281;

export function AvatarFigure({ color, faceUrl }: AvatarFigureProps) {
  const headColor = useMemo(() => {
    const c = new Color(color);
    c.offsetHSL(0, 0, 0.12);
    return `#${c.getHexString()}`;
  }, [color]);
  const face = useFaceTexture(faceUrl);

  return (
    <group>
      <group position={[0, 0.65, 0]}>
        <mesh castShadow><boxGeometry args={[0.55, 0.55, 0.55]} /><meshStandardMaterial color={headColor} /></mesh>
        {face ? (
          // A plane faces +Z; turned half a circle it faces -Z, the way the body looks.
          <mesh position={[0, 0, FACE_Z]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[FACE_SIZE, FACE_SIZE]} />
            <meshBasicMaterial map={face} toneMapped={false} />
          </mesh>
        ) : (
          <>
            <mesh position={[-0.13, 0.05, -0.29]}><boxGeometry args={[0.1, 0.12, 0.04]} /><meshStandardMaterial color="#1f2937" /></mesh>
            <mesh position={[0.13, 0.05, -0.29]}><boxGeometry args={[0.1, 0.12, 0.04]} /><meshStandardMaterial color="#1f2937" /></mesh>
          </>
        )}
      </group>
      <mesh position={[0, 0.05, 0]} castShadow><boxGeometry args={[0.6, 0.65, 0.32]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[-0.43, 0.08, 0]} castShadow><boxGeometry args={[0.22, 0.6, 0.28]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0.43, 0.08, 0]} castShadow><boxGeometry args={[0.22, 0.6, 0.28]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[-0.16, -0.6, 0]} castShadow><boxGeometry args={[0.24, 0.7, 0.3]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0.16, -0.6, 0]} castShadow><boxGeometry args={[0.24, 0.7, 0.3]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}
