/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { RoomGeometry } from '@builderforce/creation-canvas-contract';
import { DEFAULT_ROOM_GEOMETRY } from '@/lib/canvas/roomSession';

/**
 * THE ROOM'S GEOMETRY, for whatever stands in it.
 *
 * The session, every creation and every station decide "table, floor or wall" from
 * where they were dropped — and in a designed room the table is a boardroom slab or a
 * kitchen island, and the wall is where THIS room's wall is. Threaded as a prop it
 * would pass through the station registry and every stand; published here it is read
 * by each placed thing directly. Outside a provider it is the standup room's, which is
 * what every placement meant before rooms could be designed.
 */
const RoomGeometryContext = createContext<RoomGeometry>(DEFAULT_ROOM_GEOMETRY);

export function RoomGeometryProvider({ geometry, children }: { geometry: RoomGeometry; children: ReactNode }) {
  return <RoomGeometryContext.Provider value={geometry}>{children}</RoomGeometryContext.Provider>;
}

export function useRoomGeometry(): RoomGeometry {
  return useContext(RoomGeometryContext);
}
