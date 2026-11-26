/**
 * Where Simulate opens for a ref (PRD 43 Part C3), pure: the path it walks is a LINE's stops, so a ref is simulated on the
 * path whose stops pass through the ref's station, positioned on that stop. The line already chosen wins when it passes
 * through; else the first line (in the surface's own order) that does. No line passes through ⇒ `null`: the simulator
 * opens as it always did, on the path it already had.
 */

import type { Line } from './lines';
import { stationOfRef, type StationModel } from './stations';

export interface SimulateTarget {
    /** The line whose path the simulator walks. */
    lineId: string;
    /** The stop (station id) on that path the journey starts from. */
    stopId: string;
}

export function simulateTarget(lines: readonly Line[], current: Line | null, stations: Pick<StationModel, 'stationOf'>, ref: string): SimulateTarget | null {
    const stopId = stationOfRef(stations, ref);
    if (stopId === undefined) return null;
    const through = current?.stops.includes(stopId) ? current : lines.find((l) => l.stops.includes(stopId));
    return through ? { lineId: through.id, stopId } : null;
}
