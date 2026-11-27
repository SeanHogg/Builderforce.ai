/**
 * The Flow placement (PRD 43 C7): the level's shapes standing on rising decks along its main path. The main path is
 * `sequenceFlow.ts`'s entry walk (the system-band walk — the entry's line, as the Sequence reads it — over the LEVEL's
 * own stations and lines), never a second walker; each stop stands on a deck whose height rises with its step (step
 * height x 0.55, the prototype's `layout()` flow branch), the decks joined by `route` links. The level's other shapes
 * stand at floor height beside the path; a stop another line also runs through ends a branch stub there.
 *
 * Depth is the drill: no drill is the system (its stations), `package:` the component level (its files), `class:` /
 * `function:` the class level (its symbols) — the SAME level model the Map's drill places (`drill.ts` `drillLevel`), so
 * the slots, the loaded definitions (`append`) and the lines agree. Every other slot (files, folders, hidden stations)
 * is anchored at its station (B1a rule 4), so a camera switch is a tween. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import { DASH_DESCRIBES, DASH_SOLID, type Caption, type LabelRun, type Placement, type Vec3 } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { drillLevel } from './drill';
import { polylineBatch, type WorldPath } from './links';
import { drillFrameOf, placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';
import { sequenceFlow } from './sequenceFlow';

const MARGIN = 48;
/** Columns between the path's stops, clamped as the Sequence's are. */
const COLUMN = { min: 96, max: 200 } as const;
/** One step's height and how much of it a deck rises per step (the prototype's `step * 0.55`). */
const STEP = 24;
export const DECK_RISE = STEP * 0.55;
const SIZE = 10;
const SHAPE_HEIGHT = 8;
/** Where the path runs (world z), the first floor row, the gap between floor rows, and the floor shapes drawn at most. */
const PATH_Z = 64;
const FLOOR_Z = 144;
const FLOOR_ROW = 56;
export const FLOW_FLOOR_MAX = 60;
/** A deck's width and a branch stub's length (world units). */
const DECK_WIDTH = 7;
const STUB = 24;

export function placeFlow(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const records = req.symbols ?? [];
    const frame = drillFrameOf(req.drill);
    const drilled = frame ? drillLevel(g, model, frame, records) : null;
    const level = drilled?.level ?? model;
    // The loaded definitions matter only at class / function depth (the drilled level); the system level reads the resident graph.
    const full = drilled?.full ?? g;
    const { marks } = level;
    const symbolWalk = req.pathId?.startsWith('node:') && !!drilled;
    const walk = sequenceFlow({ band: symbolWalk ? 'method' : 'system', entry: req.pathId, full, records: drilled ? records : [], stations: level.stations, lines: level.lines.lines });
    const slots = symbolWalk ? level.nodeSlot : level.stationSlot;

    const stops = [...new Set(walk.participants)].filter((id) => slots.has(id));
    const onPath = new Set(stops);
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const col = Math.max(COLUMN.min, Math.min(COLUMN.max, (width - 2 * MARGIN) / Math.max(1, stops.length - 1)));
    const at = new Map<string, Vec3>(stops.map((id, i) => [id, [MARGIN + i * col, i * DECK_RISE, PATH_Z]] as const));

    const d = draftFor(marks.keys.length);
    const labels: LabelRun[] = [], a11y: Placement['a11y'] = [], captions: Caption[] = [];
    const nameOf = (slot: number, id: string): string => marks.label[slot] ?? level.stations.byId.get(id)?.name ?? id;
    const stand = (id: string, [x, y, z]: Vec3): void => {
        const slot = slots.get(id)!;
        show(d, slot, x, y, z, SIZE, SHAPE_HEIGHT);
        labels.push({ slot, text: nameOf(slot, id), offsetPx: [0, SIZE + 12], font: 'mono', size: 11, weight: 500, anchor: 'middle', tone: toneIndex('text'), halo: { tone: BG_TONE, px: 3 }, priority: 1, scale: 'world' });
        a11y.push({ slot, label: level.stations.byId.get(id)?.path ?? nameOf(slot, id) });
    };
    stops.forEach((id, i) => {
        const p = at.get(id)!;
        stand(id, p);
        captions.push({ text: String(i + 1), position: [p[0], p[1] + SHAPE_HEIGHT, p[2] - SIZE - 6], anchor: 'middle', tone: toneIndex('muted') });
    });

    // The level's other shapes on the floor beside the path, in station order, in rows under it.
    const beside = level.stations.stations
        .filter((s) => !onPath.has(s.id) && !drilled?.view.leaves.has(s.id) && slots.has(s.id))
        .slice(0, FLOW_FLOOR_MAX);
    const perRow = Math.max(1, Math.floor((width - 2 * MARGIN) / COLUMN.min) + 1);
    const step = Math.max(COLUMN.min, Math.min(COLUMN.max, (width - 2 * MARGIN) / Math.max(1, Math.min(perRow, beside.length) - 1)));
    beside.forEach((s, i) => stand(s.id, [MARGIN + (i % perRow) * step, 0, FLOOR_Z + Math.floor(i / perRow) * FLOOR_ROW]));
    const rows = Math.ceil(beside.length / perRow);
    const bottom = beside.length ? FLOOR_Z + Math.max(0, rows - 1) * FLOOR_ROW : PATH_Z;
    const right = MARGIN + Math.max(0, (stops.length - 1) * col, (Math.min(perRow, beside.length) - 1) * step) + MARGIN;
    const top = Math.max(0, (stops.length - 1) * DECK_RISE) + SHAPE_HEIGHT;
    anchorHidden(marks, d, 'station', [right / 2, 0, bottom / 2]);

    const directed = symbolWalk
        ? walk.messages.map(({ from, to }) => [from, to] as const)
        : stops.slice(1).map((id, i) => [stops[i]!, id] as const);
    const decks: WorldPath[] = directed.flatMap(([from, to]) => {
        const a = at.get(from), b = at.get(to);
        return a && b && a !== b ? [{ pts: [a, b], tone: toneIndex('plane'), width: DECK_WIDTH, dash: DASH_SOLID, flags: 0 }] : [];
    });
    // A stop that more than one line runs through is where the flow branches: a short dotted stub marks the branch end.
    const branches: WorldPath[] = stops.flatMap((id) => {
        if ((level.lines.interchanges.get(id)?.length ?? 0) < 2) return [];
        const [x, y, z] = at.get(id)!;
        return [{ pts: [[x, y, z - SIZE], [x, y, z - SIZE - STUB]] as Vec3[], tone: toneIndex('muted'), width: 1.5, dash: DASH_DESCRIBES, flags: 0 }];
    });
    const shown = stops.length + beside.length;
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links: [
            ...(decks.length ? [polylineBatch('route', decks, 'world')] : []),
            ...(branches.length ? [polylineBatch('describes', branches, 'px')] : []),
        ],
        planes: [], labels, captions, a11y,
        caption: { shown, total: Math.max(shown, level.stations.stations.length), capped: shown < level.stations.stations.length },
        bounds: { min: [0, 0, 0], max: [right, top, bottom + FLOOR_ROW] },
        rig: {
            projection: 'orthographic', frame: 'document',
            home: { position: [right / 2, 1000, bottom / 2], target: [right / 2, 0, bottom / 2], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
        ...(drilled?.append ? { append: drilled.append } : {}),
    };
}
