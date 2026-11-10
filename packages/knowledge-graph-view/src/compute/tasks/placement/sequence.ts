/**
 * The Sequence placement (PRD 43 B1a rules 8 and 10, B2): a sequence is NOT a diagram type — its participants ARE the
 * marks already on the stage (stations at the system band, classes or methods below, the `external` dashed cross for a
 * call that leaves the graph), tweened into a row; each lifeline hangs from its mark (an `edge` link, dotted); each
 * message is an `arrow` link between those same slots, top to bottom in call-site order, carrying its `CallSite`
 * (`LinkBatch.callSites`) so a pick can reveal path:line. Activation bars, returns and the class band's association stubs
 * are link paths too (`sequenceDecor.ts`). Depth is the participant's layer: a message that climbs a layer moves in depth.
 *
 * Zoom splits participants (rule 10): at the class band each method that is not shown waits at its class's head (scale 0),
 * and at the method band each class that is not shown waits at its shown methods' centroid — so class → method tweens a
 * class into its methods, and back. Every other slot is hidden at its station.
 *
 * The band is `req.lod` (`sequenceBandOf`); the entry is `req.pathId` (`node:<ref>`, `st:<id>` or a line id). Loaded
 * definitions (`req.symbols`), then the externals, are appended slots (`symbolSlots`). Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { LAYER_ORDER } from '../../../surface/layers';
import { fileRefOf, stationOfRef } from '../../../surface/stations';
import { isSymbol, withSymbolRecords } from '../../../surface/transit/symbols';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import { DASH_DESCRIBES, DASH_SOLID, FLAG, type LabelRun, type Placement, type Vec3 } from '../../../stage/types';
import { fillTemplate } from '../../../template';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show, type Draft } from './anchor';
import { isExternal } from './callIndex';
import { polylineBatch, type WorldPath } from './links';
import { placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';
import { activationPaths, returnPaths, stubPaths, type SequenceRows } from './sequenceDecor';
import { sequenceBandOf, sequenceFlow, type Flow, type FlowMessage, type SequenceBand } from './sequenceFlow';
import { symbolSlots } from './symbolSlots';

const MARGIN = 48;
/** Columns between participants, clamped so a short sequence is not stretched and a long one stays readable. */
const COLUMN = { min: 96, max: 220 } as const;
/** The participant row's depth (world z) and the gap between two messages down the time axis. */
const HEAD = 32;
const ROW = 36;
/** A self-message's loop width. */
const SELF = 24;
const MARK = 10;
/** World units a participant sinks per layer at full depth. */
export const LAYER_STEP = 40;
/** `Draft.placed` for a slot parked hidden at a position (as `anchor.ts` marks one). */
const PARKED = 2;

/** The catalog words the Sequence reads from `model.strings`: a system-band hop (`{count}`), and one with no reference. */
export const SEQUENCE_WORD_KEYS = ['sequence.hop', 'sequence.noReference'] as const;

export function placeSequence(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const band = sequenceBandOf(req.lod);
    const records = req.symbols ?? [];
    const full = withSymbolRecords(g, records);
    const flow = sequenceFlow({ band, entry: req.pathId, full, records, stations: model.stations, lines: model.lines.lines });
    const { marks, append, nodeSlot } = symbolSlots(model, full, g.nodes.length, flow.externals);
    const slotOf = (key: string): number | undefined => (band === 'system' ? model.stationSlot.get(key) : nodeSlot.get(key));
    const layerOf = (key: string): number => {
        if (isExternal(key)) return 0;
        const station = band === 'system' ? key : stationOfRef(model.stations, fileRefOf(key));
        const layer = station === undefined ? undefined : model.stations.byId.get(station)?.layer;
        const at = layer ? (model.order ?? (LAYER_ORDER as readonly string[])).indexOf(layer) : -1;
        return Math.max(0, at);
    };

    const participants = flow.participants.filter((p) => slotOf(p) !== undefined);
    const messages = flow.messages.filter((m) => slotOf(m.from) !== undefined && slotOf(m.to) !== undefined);
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const col = Math.max(COLUMN.min, Math.min(COLUMN.max, (width - 2 * MARGIN) / Math.max(1, participants.length - 1)));
    const sink = Math.max(0, Math.min(1, req.depth ?? 0)) * LAYER_STEP;
    const bottom = HEAD + ROW * (messages.length + 1);
    const column = new Map<string, Vec3>(participants.map((p, i) => [p, [MARGIN + i * col, -layerOf(p) * sink, HEAD]] as const));
    const rows: SequenceRows = { rowZ: (i) => HEAD + ROW * (i + 1), row: ROW, column, mark: MARK };

    const d = draftFor(marks.keys.length);
    const labels: LabelRun[] = [], a11y: Placement['a11y'] = [];
    const lifelines: WorldPath[] = [];
    const muted = toneIndex('muted');
    for (const p of participants) {
        const slot = slotOf(p)!, [x, y, z] = column.get(p)!;
        show(d, slot, x, y, z, MARK);
        lifelines.push({ pts: [[x, y, z + MARK], [x, y, bottom]], tone: muted, width: 1, dash: DASH_DESCRIBES, flags: 0 });
        labels.push({ slot, text: marks.label[slot] ?? p, offsetPx: [0, -(MARK + 10)], font: 'mono', size: 11, weight: 500, anchor: 'middle', tone: toneIndex('text'), halo: { tone: BG_TONE, px: 3 }, priority: 1, scale: 'world' });
        a11y.push({ slot, label: marks.label[slot] ?? p });
    }
    if (band !== 'system') parkSplit(d, band, flow, full, nodeSlot, column);
    anchorHidden(marks, d, 'station', [width / 2, 0, bottom / 2]);

    const calls: WorldPath[] = messages.map((m, i) => messagePath(m, i, column));
    const decorated = band !== 'system';
    const returning = decorated ? returnPaths(messages, rows) : [];
    const stubs = stubPaths(flow.stubs, rows);
    const right = MARGIN + Math.max(0, participants.length - 1) * col + MARGIN;
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links: [
            polylineBatch('edge', lifelines, 'px'),
            // Messages first, then their returns: `callSites` is per polyline, a return has none.
            { ...polylineBatch('arrow', [...calls, ...returning], 'px'), callSites: [...messages.map((m) => m.site), ...returning.map(() => null)] },
            ...(decorated && messages.length ? [polylineBatch('route', activationPaths(messages, rows), 'world')] : []),
            ...(stubs.length ? [polylineBatch('describes', stubs, 'px')] : []),
        ],
        planes: [], labels,
        captions: messages.map((m, i) => ({ text: messageText(m, band, model.strings), position: midOf(calls[i]!), anchor: 'middle' as const, tone: muted })),
        a11y,
        caption: { shown: messages.length, total: Math.max(messages.length, flow.total), capped: messages.length < flow.total },
        bounds: { min: [0, -sink * 8, 0], max: [right, 0, bottom + ROW] },
        rig: {
            projection: 'orthographic', frame: 'document',
            home: { position: [right / 2, 1000, bottom / 2], target: [right / 2, 0, bottom / 2], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
        ...(append ? { append } : {}),
    };
}

function park(d: Draft, slot: number, at: Vec3): void {
    d.position[slot * 3] = at[0]; d.position[slot * 3 + 1] = at[1]; d.position[slot * 3 + 2] = at[2];
    d.scale[slot] = 0; d.extrude[slot] = 0; d.placed[slot] = PARKED;
}

/**
 * The split (rule 10): class band — a hidden method waits at its shown class's head; method band — a hidden class waits
 * at the centroid of its shown methods. The SAME slots in both bands, so class ↔ method is one member tween.
 */
function parkSplit(d: Draft, band: SequenceBand, flow: Flow, full: KnowledgeGraph, nodeSlot: ReadonlyMap<string, number>, column: ReadonlyMap<string, Vec3>): void {
    const members = new Map<string, Vec3[]>();
    for (const n of full.nodes) {
        if (!isSymbol(n)) continue;
        const ref = n.ref as string, cls = flow.classOf(ref);
        if (cls === ref) continue;
        if (band === 'class') {
            const head = column.get(cls), slot = nodeSlot.get(ref);
            if (head && slot !== undefined && d.placed[slot] === 0) park(d, slot, head);
        } else if (column.has(ref) && !column.has(cls)) {
            let list = members.get(cls);
            if (!list) members.set(cls, (list = []));
            list.push(column.get(ref)!);
        }
    }
    for (const [cls, at] of members) {
        const slot = nodeSlot.get(cls);
        if (slot === undefined || d.placed[slot] !== 0) continue;
        park(d, slot, [0, 1, 2].map((k) => at.reduce((s, p) => s + p[k]!, 0) / at.length) as unknown as Vec3);
    }
}

/** Message `i` at row `i` down the time axis, from the caller's lifeline to the callee's (a self-call loops out and back). */
function messagePath(m: FlowMessage, i: number, column: ReadonlyMap<string, Vec3>): WorldPath {
    const a = column.get(m.from)!, b = column.get(m.to)!, z = HEAD + ROW * (i + 1);
    const pts: Vec3[] = m.from === m.to
        ? [[a[0], a[1], z], [a[0] + SELF, a[1], z], [a[0] + SELF, a[1], z + ROW / 3], [a[0], a[1], z + ROW / 3]]
        : [[a[0], a[1], z], [b[0], b[1], z]];
    return { pts, tone: toneIndex('edge'), width: 1.5, dash: DASH_SOLID, flags: FLAG.SELECTABLE };
}

const midOf = (p: WorldPath): Vec3 => {
    const a = p.pts[0]!, b = p.pts[Math.min(1, p.pts.length - 1)]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] - 6];
};

/** A message's words: the callee (data) below the system band; a hop's reference count (catalog words) at it. */
function messageText(m: FlowMessage, band: SequenceBand, strings: Readonly<Record<string, string>>): string {
    if (band !== 'system') return m.label;
    return m.count === 0 ? strings['sequence.noReference'] ?? '' : fillTemplate(strings['sequence.hop'], { count: m.count });
}
