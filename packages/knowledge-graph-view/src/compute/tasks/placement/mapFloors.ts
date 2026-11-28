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
    for (const group of systems.values()) {
        const bandLayout = layoutTransit(group, lines, width);
        const z = offset;
        for (const [id, p] of bandLayout.positions) layout.positions.set(id, { x: p.x, y: p.y + z });
        for (const [id, index] of bandLayout.bandIndex) layout.bandIndex.set(id, layout.bands.length + index);
        for (const band of bandLayout.bands) layout.bands.push({ ...band, y: band.y + z });
        layout.drawn.push(...bandLayout.drawn);
        layout.hiddenOnLine += bandLayout.hiddenOnLine;
        const floorWidth = Math.max(width, bandLayout.width);
        floors.push({ system: group[0]?.system ?? '', width: floorWidth, depth: bandLayout.height, offset });
        layout.width = Math.max(layout.width, floorWidth);
        layout.height = z + bandLayout.height;
        offset = layout.height + 96;
    }
    layout.routes = routeLines({ lines, positions: layout.positions, bands: layout.bands, bandIndex: layout.bandIndex });
    return { layout, floors };
}
