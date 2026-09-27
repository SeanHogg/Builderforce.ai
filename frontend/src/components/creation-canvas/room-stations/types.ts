import type { ComponentType, ReactNode } from 'react';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';

/**
 * What one station shows, for one viewer, right now.
 *
 * Returned by the station's own hook, which resolves its data AND its entitlement —
 * null means "not for this viewer", and then nothing of the station renders anywhere:
 * not its stand, not its row in the room's list, not its panel.
 */
/**
 * What a station LOOKS like in the room — one of two things, never both:
 *  • a `face`: DOM content on a board on a post. Drawn through `SurfacePanel`, whose
 *    content renders in a root with no React context, so it must not read a provider;
 *  • a `body`: the station IS a thing, not a board — scene-graph content (R3F) that
 *    stands on the post in the board's place. It must fit the board's box
 *    ({@link ROOM_STATION_BODY_BOX}, centred on the origin) so the caption above it and
 *    the drag around it behave the same as every other station.
 */
export type RoomStationLook =
  | { face: ReactNode; body?: never }
  | { body: ReactNode; face?: never };

/** The box, in metres, a station's `body` must fit inside (width, height, depth). */
export const ROOM_STATION_BODY_BOX = { width: 1.5, height: 1.0, depth: 1.2 } as const;

export type RoomStationModel = RoomStationLook & {
  /** Its name, on the caption, the list row and the panel's title. */
  title: string;
  /** One line of state — "3 changes waiting" — beside the name. */
  summary: string;
};

export interface RoomStationView {
  /**
   * Resolve this station for this viewer. A hook — called once per instance, from a
   * component keyed by the instance, so the hook order is stable for its lifetime.
   * `panelOpen` lets a station that owns something singular (a live widget frame) draw
   * a placeholder on its face while the panel has it.
   */
  useModel: (instance: RoomStationInstance, panelOpen: boolean) => RoomStationModel | null;
  /** The accessible 2D reading, inside the room's slide-out panel. */
  Panel: ComponentType<{ instance: RoomStationInstance }>;
}
