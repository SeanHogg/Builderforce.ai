import { layoutTransit, type TransitLayout } from '../../../surface/transitLayout';
import { routeLines } from '../../../surface/transit/corridors';
import type { Line } from '../../../surface/lines';
import type { Station } from '../../../surface/stations';

export interface Floor { system: string; width: number; depth: number; offset: number }
export interface ModuleArea { app: string; x: number; z: number; width: number; depth: number }

function cityDistrict(stations: readonly Station[]): TransitLayout {
    const drawn = stations.slice(0, 36).map(({ id }) => id);
    const columns = Math.max(1, Math.ceil(Math.sqrt(drawn.length)));
    const pitch = 94;
    return {
        width: (columns + 1) * pitch, height: (Math.ceil(drawn.length / columns) + 1) * pitch,
        drawn, positions: new Map(drawn.map((id, i) => [id, { x: (i % columns + 1) * pitch, y: (Math.floor(i / columns) + 1) * pitch }])),
        bands: [], routes: [], bandIndex: new Map(), hiddenOnLine: 0,
    };
}

/** Each system has its own base. Keep one set of coordinates so lines can cross between bases. */
export function layoutFloors(stations: readonly Station[], lines: readonly Line[], width: number, order?: readonly string[], showModules = false) {
    const systems = new Map<string, Station[]>();
    for (const station of stations) {
        const key = station.system ?? '';
        const group = systems.get(key) ?? [];
        if (!systems.has(key)) systems.set(key, group);
        group.push(station);
    }
    if (order || !showModules && systems.size < 2) {
        const layout = layoutTransit(stations, lines, width, order ? { order } : {});
        return { layout, floors: [{ system: systems.keys().next().value ?? '', width: layout.width, depth: layout.height, offset: 0 }] as Floor[], modules: [] as ModuleArea[] };
    }
    const floors: Floor[] = [];
    const modules: ModuleArea[] = [];
    const layout: TransitLayout = {
        width: 0, height: 0, bands: [], positions: new Map(), drawn: [], routes: [], bandIndex: new Map(), hiddenOnLine: 0,
    };
    let offset = 0;
    for (const [system, group] of systems) {
        const byApp = new Map<string, Station[]>();
        for (const station of group) {
            const app = showModules ? station.app ?? '' : '';
            const held = byApp.get(app);
            if (held) held.push(station);
            else byApp.set(app, [station]);
        }
        let z = offset + (showModules ? 48 : 0), floorWidth = width;
        for (const [app, items] of byApp) {
            const bandLayout = showModules ? cityDistrict(items) : layoutTransit(items, lines, width);
            const x = showModules ? 24 : 0;
            for (const [id, p] of bandLayout.positions) layout.positions.set(id, { x: p.x + x, y: p.y + z });
            for (const [id, index] of bandLayout.bandIndex) layout.bandIndex.set(id, layout.bands.length + index);
            for (const band of bandLayout.bands) layout.bands.push({ ...band, y: band.y + z });
            layout.drawn.push(...bandLayout.drawn);
            layout.hiddenOnLine += bandLayout.hiddenOnLine;
            if (showModules && app) modules.push({ app, x, z, width: bandLayout.width, depth: bandLayout.height });
            floorWidth = Math.max(floorWidth, bandLayout.width + x * 2);
            z += bandLayout.height + (showModules ? 32 : 0);
        }
        floors.push({ system, width: floorWidth, depth: z - offset, offset });
        layout.width = Math.max(layout.width, floorWidth);
        layout.height = z;
        offset = z + 96;
    }
    if (!showModules) layout.routes = routeLines({ lines, positions: layout.positions, bands: layout.bands, bandIndex: layout.bandIndex });
    return { layout, floors, modules };
}
