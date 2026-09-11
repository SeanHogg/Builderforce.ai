/*
 * No `'use client'` — used only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useEffect, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Plane, Vector3 } from 'three';
import type { RoomSpot } from '@/lib/canvas/roomSpots';

const FLOOR = new Plane(new Vector3(0, 1, 0), 0);

export interface RoomItemDragHandlers {
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
}

/**
 * Picking a thing up in the room and putting it down somewhere else.
 *
 * Every pointer on the thing's body is a drag — opening is its own button on the
 * caption, never a press that did not travel far enough (see `RoomSessionDiorama`
 * for why those were split). The pointer's ray is followed across the floor plane
 * and each point is handed to `onPlace`; the placement rule decides, per frame,
 * whether that is the table, the floor or the wall. `onDragChange` lets the room
 * hold its camera still while something travels.
 *
 * Spread the result onto the thing's root `<group>`.
 */
export function useRoomItemDrag(
  onPlace: (spot: RoomSpot) => void,
  onDragChange: (dragging: boolean) => void,
): RoomItemDragHandlers {
  const [hovered, setHovered] = useState(false);
  // The hand cursor says "this can be picked up" before anything is pressed. Set on the
  // body because the pointer is over a WebGL canvas, which has no element of its own
  // per object to carry a cursor style.
  useEffect(() => {
    if (!hovered) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'grab';
    return () => { document.body.style.cursor = previous; };
  }, [hovered]);
  const dragPointer = useRef<number | null>(null);
  const hit = useRef(new Vector3());

  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      (event.target as Element).setPointerCapture(event.pointerId);
      dragPointer.current = event.pointerId;
      onDragChange(true);
    },
    onPointerMove: (event) => {
      if (dragPointer.current !== event.pointerId) return;
      event.stopPropagation();
      if (event.ray.intersectPlane(FLOOR, hit.current)) onPlace({ x: hit.current.x, z: hit.current.z });
    },
    onPointerUp: (event) => {
      if (dragPointer.current !== event.pointerId) return;
      event.stopPropagation();
      (event.target as Element).releasePointerCapture(event.pointerId);
      dragPointer.current = null;
      onDragChange(false);
    },
    onPointerOver: (event) => { event.stopPropagation(); setHovered(true); },
    onPointerOut: () => setHovered(false),
  };
}
