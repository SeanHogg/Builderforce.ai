/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import type { ThreeEvent } from '@react-three/fiber';
import { DoubleSide } from 'three';
import { useImageTexture } from './useImageTexture';

/**
 * A flat face with something on it — the ONE thing that paints a picture in 3D.
 *
 * ── WHY IT IS SHARED ─────────────────────────────────────────────────────────
 * Two surfaces put a rectangle with an image on it into a scene, for different
 * reasons: the room hangs board objects on its back wall, and a `world` prop
 * carrying a `surface` or an `objectId` shows what it stands for. Written twice
 * they would be two answers to "what does a picture look like when it fails to
 * load", two texture lifetimes and two sets of lighting decisions — and the
 * failure case is the one that matters, because an authored URL breaks often.
 *
 * So this owns the whole answer: load, degrade to the colour when there is no
 * image, and draw an unlit face so a poster reads the same on a wall in shadow
 * as it does on one in the sun. A photograph that dims when the sun moves is a
 * photograph nobody can read, which is the opposite of why it was put there.
 */
export interface SurfacePanelProps {
  width: number;
  height: number;
  /** Drawn when there is no image, and behind one that is still loading. */
  color: string;
  imageUrl?: string | undefined;
  /** `contain` letterboxes inside the face; `cover` fills it. Default `cover`. */
  fit?: 'cover' | 'contain';
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  /** Lifts the face very slightly off whatever it is mounted on, so a panel and
   *  its backing board do not fight for the same depth. */
  offset?: number;
}

export function SurfacePanel({
  width,
  height,
  color,
  imageUrl,
  fit = 'cover',
  onClick,
  offset = 0.01,
}: SurfacePanelProps) {
  const texture = useImageTexture(imageUrl);

  // `contain` shrinks the drawn face to the image's own aspect; `cover` keeps
  // the face and lets the texture crop. Solved here rather than with UV maths
  // because a smaller mesh cannot bleed past the board it is mounted on, which
  // a cropped texture on an oversized face can.
  let drawWidth = width;
  let drawHeight = height;
  if (texture && fit === 'contain' && texture.image) {
    const image = texture.image as { width?: number; height?: number };
    const aspect = (image.width ?? 1) / (image.height ?? 1);
    if (Number.isFinite(aspect) && aspect > 0) {
      if (aspect > width / height) drawHeight = width / aspect;
      else drawWidth = height * aspect;
    }
  }

  return (
    <mesh position={[0, 0, offset]} {...(onClick ? { onClick } : {})}>
      <planeGeometry args={[drawWidth, drawHeight]} />
      {texture
        ? <meshBasicMaterial map={texture} toneMapped={false} side={DoubleSide} />
        : <meshBasicMaterial color={color} toneMapped={false} side={DoubleSide} />}
    </mesh>
  );
}

