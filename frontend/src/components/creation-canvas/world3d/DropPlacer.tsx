import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';

/**
 * DropPlacer — pure raycast helper. Lives inside the R3F `<Canvas>` so it can
 * read the camera + canvas geometry via `useThree()` and convert a
 * screen-space cursor position into a world-space hit on the ground plane.
 *
 * The outer HTML5 drop event (in `CanvasWorldView.tsx`) reads the dragged
 * prop kind and asks DropPlacer for the world position via the registered
 * ref. DropPlacer doesn't know what's being placed — the host owns the
 * dispatch. Ported unchanged from hired.video's `world-3d/DropPlacer.tsx`.
 */

export type DropPlacerHandler = (clientX: number, clientY: number) => [number, number, number] | null;

interface DropPlacerProps {
  handlerRef: React.MutableRefObject<DropPlacerHandler | null>;
}

export default function DropPlacer({ handlerRef }: DropPlacerProps) {
  const { camera, gl } = useThree();

  useEffect(() => {
    const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();

    const handler: DropPlacerHandler = (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const intersected = raycaster.ray.intersectPlane(groundPlane, hit);
      if (!intersected) return null;
      return [hit.x, hit.y, hit.z];
    };

    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, [camera, gl, handlerRef]);

  return null;
}
