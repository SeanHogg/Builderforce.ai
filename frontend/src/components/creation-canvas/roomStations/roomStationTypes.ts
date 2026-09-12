import type { ComponentType } from 'react';
import type { RoomStationDef } from '@/lib/canvas/roomStations';

/** One board object as a station panel reads it — the room's own nodes, unwrapped. */
export interface RoomStationNode {
  id: string;
  data: Readonly<Record<string, unknown>>;
}

/**
 * What a station's panel is handed: the board, and nothing else.
 *
 * A panel OWNS its reading of the board — it computes the gradebook, the audit or
 * the gate itself from these nodes — and reaches anything that acts on the board
 * through the board's own published runners (`useCardActRunner`), never through a
 * callback the room would have to learn about.
 */
export interface RoomStationPanelProps {
  nodes: readonly RoomStationNode[];
}

/** A station: its definition (data, placement, presence) and the panel behind its Open. */
export interface RoomStationEntry extends RoomStationDef {
  Panel: ComponentType<RoomStationPanelProps>;
}
