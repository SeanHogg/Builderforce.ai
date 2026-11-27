import { layoutTransit, type TransitLayout } from '../../../surface/transitLayout';
import { routeLines } from '../../../surface/transit/corridors';
import type { Line } from '../../../surface/lines';
import type { Station } from '../../../surface/stations';

export interface Floor { system: string; width: number; depth: number; offset: number }

/** Each system has its own base. Keep one set of coordinates so lines can cross between bases. */
export function layoutFloors(stations: readonly Station[], lines: readonly Line[], width: number, order?: readonly string[]) {
    const systems = new Map<string, Station[]>();
    for (const station of stations) {
        const key = station.system ?? '';
        const group = systems.get(key) ?? [];
        if (!systems.has(key)) systems.set(key, group);
        group.push(station);
    }
    if (order || systems.size < 2) {
        const layout = layoutTransit(stations, lines, width, order ? { order } : {});
        return { layout, floors: [{ system: systems.keys().next().value ?? '', width: layout.width, depth: layout.height, offset: 0 }] as Floor[] };
    }
    const floors: Floor[] = [];
    const layout: TransitLayout = {
        width: 0, height: 0, bands: [], positions: new Map(), drawn: [], routes: [], bandIndex: new Map(), hiddenOnLine: 0,
    };
    let offset = 0;
    for (const [system, group] of systems) {
        const floor = layoutTransit(group, lines, width);
        floors.push({ system, width: floor.width, depth: floor.height, offset });
        for (const [id, p] of floor.positions) layout.positions.set(id, { x: p.x, y: p.y + offset });
        for (const [id, index] of floor.bandIndex) layout.bandIndex.set(id, layout.bands.length + index);
        for (const band of floor.bands) layout.bands.push({ ...band, y: band.y + offset });
        layout.drawn.push(...floor.drawn);
        layout.width = Math.max(layout.width, floor.width);
        layout.height = offset + floor.height;
        layout.hiddenOnLine += floor.hiddenOnLine;
        offset = layout.height + 96;
    }
    layout.routes = routeLines({ lines, positions: layout.positions, bands: layout.bands, bandIndex: layout.bandIndex });
    return { layout, floors };
}
