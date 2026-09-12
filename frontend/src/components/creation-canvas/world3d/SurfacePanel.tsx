/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import type { ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { DoubleSide } from 'three';
import { useImageTexture } from './useImageTexture';

/**
 * drei's `Html` in transform mode draws one CSS pixel as `distanceFactor / 400` world
 * units (see its `getObjectCSSMatrix` scale). Solving for the factor that makes a
 * `pixelWidth`-wide element exactly `width` metres wide is what lets DOM sit ON a face
 * rather than float near it.
 */
const HTML_TRANSFORM_UNITS_PER_FACTOR = 400;

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
  /**
   * LIVE CONTENT on the face — what a texture cannot carry: text that updates, buttons
   * a keyboard reaches, a third-party frame. Laid out at `pixelWidth` CSS pixels (the
   * height follows the face's aspect) and scaled onto the face, so it turns with the
   * face instead of floating in front of the camera.
   *
   * It renders in drei's own DOM root, which does not inherit React context — hand it
   * props, never a component that reads a provider.
   */
  content?: { node: ReactNode; pixelWidth: number } | undefined;
}

export function SurfacePanel({
  width,
  height,
  color,
  imageUrl,
  fit = 'cover',
  onClick,
  offset = 0.01,
  content,
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

  const face = (
    <mesh position={[0, 0, offset]} {...(onClick ? { onClick } : {})}>
      <planeGeometry args={[drawWidth, drawHeight]} />
      {texture
        ? <meshBasicMaterial map={texture} toneMapped={false} side={DoubleSide} />
        : <meshBasicMaterial color={color} toneMapped={false} side={DoubleSide} />}
    </mesh>
  );
  if (!content || !(content.pixelWidth > 0)) return face;
  const pixelHeight = Math.round(content.pixelWidth * (height / width));
  return (
    <>
      {face}
      <Html
        transform
        position={[0, 0, offset + 0.002]}
        distanceFactor={(width * HTML_TRANSFORM_UNITS_PER_FACTOR) / content.pixelWidth}
        zIndexRange={[5, 0]}
      >
        <div
          // A pointer on the face's DOM must not start a drag of the stand behind it,
          // and R3F never sees it anyway — the same rule the captions follow.
          onPointerDown={(event) => event.stopPropagation()}
          style={{ width: content.pixelWidth, height: pixelHeight, overflow: 'hidden' }}
        >
          {content.node}
        </div>
      </Html>
    </>
  );
}

