/**
 * Unfold: a station opens into satellite sub-stations drawn around it. The satellites are its
 * sub-areas (the folders under the files' common directory) when there are at least two, else
 * its most important files. Pure.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { cmp, round } from '../../order';
import { tailOf } from '../outlineGraph';
import type { Station } from '../stations';
import type { Point } from './geometry';
import { clip, type Box } from './labelPlacement';

export const MAX_SATELLITES = 6;
const RADIUS = 52;

export interface Satellite { id: string; name: string; weight: number }


function commonDir(paths: readonly string[]): string[] {
    const split = paths.map((p) => p.split('/').slice(0, -1));
    const first = split[0] ?? [];
    let n = 0;
    while (n < first.length && split.every((s) => s[n] === first[n])) n++;
    return first.slice(0, n);
}

export function satellitesOf(station: Pick<Station, 'refs'>, index: ReadonlyMap<string, KNode>, max = MAX_SATELLITES): Satellite[] {
    const files = station.refs.map((ref) => ({ ref, path: pathOf(ref) ?? ref, weight: index.get(ref)?.importance ?? 0 }));
    if (files.length < 2) return [];
    const base = commonDir(files.map((f) => f.path)).length;
    const groups = new Map<string, number>();
    for (const f of files) {
        const parts = f.path.split('/');
        if (parts.length - 1 <= base) continue;
        const name = parts[base]!;
        groups.set(name, (groups.get(name) ?? 0) + f.weight + 0.001);
    }
    if (groups.size >= 2) {
        return [...groups].map(([name, weight]) => ({ id: `dir:${name}`, name, weight }))
            .sort((a, b) => b.weight - a.weight || cmp(a.name, b.name)).slice(0, max);
    }
    return [...files].sort((a, b) => b.weight - a.weight || cmp(a.ref, b.ref)).slice(0, max)
        .map((f) => ({ id: f.ref, name: tailOf(f.path), weight: f.weight }));
}

export interface SatellitePlace { x: number; y: number; anchor: 'start' | 'end' }

/** A satellite's name is clipped to this many characters, so the arc stays compact. */
const SATELLITE_NAME = 18;
export const satelliteName = (s: Pick<Satellite, 'name'>): string => clip(s.name, SATELLITE_NAME);

/** The room each satellite and its name take, for the station labels and the card to keep off. */
export function satelliteBoxes(places: readonly SatellitePlace[], items: readonly Pick<Satellite, 'name'>[]): Box[] {
    return places.flatMap((p, i) => {
        const item = items[i];
        if (!item) return [];
        const text = satelliteName(item).length * 6.6;
        // The dot (radius 5) and the name, which starts 8px to the side the satellite faces.
        return [p.anchor === 'start' ? { x: p.x - 6, y: p.y - 9, w: 14 + text, h: 18 } : { x: p.x - 8 - text, y: p.y - 9, w: 14 + text, h: 18 }];
    });
}

/** Satellites on an arc around `at`: below it, or above when the station is in the lower half of the map. */
export function satellitePlaces(at: Point, count: number, above: boolean): SatellitePlace[] {
    return Array.from({ length: count }, (_, i) => {
        const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, count - 1)) + (above ? Math.PI : 0);
        const x = round(at.x + Math.cos(a) * RADIUS * 1.6), y = round(at.y + Math.sin(a) * RADIUS);
        return { x, y, anchor: x >= at.x ? 'start' : 'end' } as const;
    });
}
