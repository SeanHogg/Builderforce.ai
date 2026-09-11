/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { GeometryTriangle, MeshFormat } from '@/lib/creativeGeometry';
import { loadMeshTriangles } from '@/lib/meshPreviewCache';
import { fitModelToRoom } from '@/lib/canvas/roomCreations';

export interface RoomMeshModelProps {
  url: string;
  format: MeshFormat;
  color: string;
  /** Shown while the file loads, and instead of it when it holds nothing drawable. */
  fallback: ReactNode;
}

/**
 * A generated model, standing in the room as its own geometry.
 *
 * The 3D board view draws a model as a picture re-projected from the camera's angle;
 * in the room it is a real mesh, so walking round the plinth walks round the model.
 * The triangles come from the same once-per-file cache the board uses
 * (`meshPreviewCache`), so a model already seen on the board costs no second fetch.
 * Its base rests at y = 0 — the stand places it.
 */
export function RoomMeshModel({ url, format, color, fallback }: RoomMeshModelProps) {
  // Keyed by the url it was read for, so a changed file never shows the old mesh and
  // nothing has to be reset from inside the effect.
  const [loaded, setLoaded] = useState<{ url: string; triangles: readonly GeometryTriangle[] } | null>(null);
  useEffect(() => {
    let live = true;
    void loadMeshTriangles(url, format).then((triangles) => {
      if (live) setLoaded({ url, triangles });
    });
    return () => { live = false; };
  }, [url, format]);

  const geometry = useMemo(() => {
    if (!loaded || loaded.url !== url) return null;
    const positions = fitModelToRoom(loaded.triangles);
    if (!positions.length) return null;
    const built = new BufferGeometry();
    built.setAttribute('position', new Float32BufferAttribute(positions, 3));
    built.computeVertexNormals();
    return built;
  }, [loaded, url]);
  // A replaced or unmounted mesh gives its GPU buffers back.
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!geometry) return <>{fallback}</>;
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  );
}
