import type { ComponentType, ReactNode } from 'react';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';

/**
 * What one station shows, for one viewer, right now.
 *
 * Returned by the station's own hook, which resolves its data AND its entitlement —
 * null means "not for this viewer", and then nothing of the station renders anywhere:
 * not its stand, not its row in the room's list, not its panel.
 */
export interface RoomStationModel {
  /** Its name, on the caption, the list row and the panel's title. */
  title: string;
  /** One line of state — "3 changes waiting" — beside the name. */
  summary: string;
  /**
   * What the stand's FACE shows. Pure DOM: it is drawn through `SurfacePanel`, whose
   * content renders in a root with no React context, so it must not read a provider.
   */
  face: ReactNode;
}

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
