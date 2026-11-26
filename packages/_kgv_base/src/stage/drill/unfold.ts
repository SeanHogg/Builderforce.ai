/**
 * Unfold on the stage (PRD 43 B7: a placement PATCH, satellites are member slots). The station's satellites are the
 * map's own `satellitesOf` — its sub-folders when it has two or more, else its most important files — and each is the
 * slot that already exists for it (`dir:<path>` or `node:<ref>`), shown on the map's own arc around the station
 * (`satellitePlaces`) with its clipped name. Nothing is laid out again and no worker is asked: the patch copies the
 * placement's three arrays, shows the satellites, and the stage tweens them out of the station (a hidden member sits
 * at its station). Folding is the unpatched placement. Pure.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import type { Station } from '../../surface/stations';
import { commonDir, satelliteName, satellitePlaces, satellitesOf } from '../../surface/transit/unfold';
import { BG_TONE, toneIndex } from '../tones';
import type { LabelRun, Placement } from '../types';

/** A satellite's size against its station's. */
const SATELLITE_SCALE = 0.45;
const MIN_SATELLITE = 3;

/** A station's satellites as slot keys, in the arc's order (a satellite with no slot is left out). */
export function satelliteKeys(station: Pick<Station, 'refs'>, index: ReadonlyMap<string, KNode>, slotOf: (key: string) => number): { key: string; name: string }[] {
    const base = commonDir(station.refs.map((ref) => pathOf(ref) ?? ref));
    return satellitesOf(station, index)
        .map((s) => ({ key: s.id.startsWith('dir:') ? `dir:${[...base, s.id.slice(4)].join('/')}` : `node:${s.id}`, name: s.name }))
        .filter((s) => slotOf(s.key) >= 0);
}

export function unfoldPatch(p: Placement, stationSlot: number, satellites: readonly { key: string; name: string }[], slotOf: (key: string) => number): Placement {
    if (stationSlot < 0 || !(p.scale[stationSlot]! > 0) || satellites.length === 0) return p;
    const position = p.position.slice(), scale = p.scale.slice(), extrude = p.extrude.slice();
    const at = { x: p.position[stationSlot * 3]!, y: p.position[stationSlot * 3 + 2]! };
    const midZ = (p.bounds.min[2] + p.bounds.max[2]) / 2;
    const places = satellitePlaces(at, satellites.length, at.y > midZ);
    const size = Math.max(MIN_SATELLITE, p.scale[stationSlot]! * SATELLITE_SCALE);
    const labels: LabelRun[] = [], a11y: Placement['a11y'] = [];
    satellites.forEach((s, i) => {
        const slot = slotOf(s.key), place = places[i];
        if (slot < 0 || slot >= scale.length || !place) return;
        position[slot * 3] = place.x; position[slot * 3 + 1] = p.position[stationSlot * 3 + 1]!; position[slot * 3 + 2] = place.y;
        scale[slot] = size; extrude[slot] = 0;
        labels.push({
            slot, text: satelliteName(s), offsetPx: [place.anchor === 'start' ? size + 8 : -(size + 8), 0], font: 'mono', size: 10, weight: 400,
            anchor: place.anchor, tone: toneIndex('text'), halo: { tone: BG_TONE, px: 3 }, priority: 0, scale: 'world',
        });
        a11y.push({ slot, label: s.name });
    });
    // The satellites are read right after their station.
    const after = p.a11y.findIndex((item) => item.slot === stationSlot);
    const order = after < 0 ? [...p.a11y, ...a11y] : [...p.a11y.slice(0, after + 1), ...a11y, ...p.a11y.slice(after + 1)];
    return { ...p, cacheKey: `${p.cacheKey}|unfold:${stationSlot}`, position, scale, extrude, labels: [...p.labels, ...labels], a11y: order };
}
