import { batchesOf, typeIndex } from '../../compute/tasks/markSet';
import { draftFor, show } from '../../compute/tasks/placement/anchor';
import { polylineBatch, type WorldPath } from '../../compute/tasks/placement/links';
import { pathOf } from '../../graphModel';
import type { KnowledgeGraphLabels } from '../../labels';
import { edgeKindLabel } from '../../names';
import type { MarkType } from '../../shapes';
import type { DiagramId } from '../../surface/diagrams/catalog';
import type { Diagram, DiagramEdge, DiagramNode } from '../../surface/diagrams/model';
import { tailOf } from '../../surface/outlineGraph';
import { FORM_RISE, TYPE_FORM } from '../marks/forms';
import { capacityFor } from '../slots';
import { BG_TONE, toneIndex } from '../tones';
import { DASH_DESCRIBES, DASH_SOLID, FLAG, type Caption, type MarkPaint, type MarkSet, type Placement, type Vec3 } from '../types';

export interface DiagramScene { id: DiagramId; model: Diagram }

const kinds: Readonly<Partial<Record<string, MarkType>>> = {
    system: 'system', package: 'system', component: 'system', container: 'system', node: 'unit',
    class: 'class', instance: 'class', part: 'class', artifact: 'source', interface: 'interface', stereotype: 'interface',
    method: 'function', function: 'function', activity: 'function', process: 'function', useCase: 'function',
    state: 'entity', actor: 'entity', participant: 'entity', interaction: 'entity',
    data: 'data', entity: 'data', datastore: 'data', relationship: 'claim', decision: 'claim', gateway: 'claim',
    event: 'section', place: 'section', service: 'unit', external: 'external',
};

export const diagramMarkType = (kind: string): MarkType => Object.hasOwn(kinds, kind) ? kinds[kind] ?? 'source' : 'source';
export const diagramKey = (id: string): string => `diagram:${id}`;
export const diagramName = (node: DiagramNode): string => {
    const path = node.ref ? pathOf(node.ref) : undefined;
    return path && node.label === path ? tailOf(path) : node.label;
};

const STEP = 100, PAD = 54, RADIUS = 13;
const TEXT = toneIndex('text');

interface Mark { node: DiagramNode; point: Vec3; key: string; label: string }

const captionAt = (text: string, position: Vec3, anchor: Caption['anchor'] = 'middle'): Caption =>
    ({ text, position, anchor, tone: TEXT });

/** Offset the ends to the marks' rims. Arrowheads use the stage's own line batches. */
function connection(edge: DiagramEdge, a: Vec3, b: Vec3): { path: WorldPath; arrow: WorldPath; centre: Vec3 } {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const length = Math.hypot(dx, dz);
    const x = length ? dx / length : 1, z = length ? dz / length : 0, h = 1;
    const rim = Math.min(RADIUS, length / 3);
    const start: Vec3 = [a[0] + x * rim, h, a[2] + z * rim];
    const end: Vec3 = length ? [b[0] - x * rim, h, b[2] - z * rim] : [b[0] + RADIUS, h, b[2] + 6];
    const px = end[0] - x * 8, pz = end[2] - z * 8;
    const dash = ['references', 'implements', 'dependency'].includes(edge.kind) ? DASH_DESCRIBES : DASH_SOLID;
    const tone = toneIndex(edge.kind === 'calls' ? 'l1' : 'edge');
    const pts: Vec3[] = length ? [start, end] : [[a[0] + RADIUS, h, a[2] - 6], [a[0] + 30, h, a[2] - 6], [a[0] + 30, h, a[2] + 6], end];
    return {
        path: { pts, tone, width: 1.5, dash, flags: 0 },
        arrow: { pts: [[px - z * 4, h, pz + x * 4], end, [px + z * 4, h, pz - x * 4]], tone, width: 1.5, dash: DASH_SOLID, flags: 0 },
        centre: length ? [(a[0] + b[0]) / 2, h, (a[2] + b[2]) / 2] : [a[0] + 34, h, a[2]],
    };
}

/** Diagram views supply data and placement to the existing stage, including imported nodes with no source slot. */
export function placeDiagram({ id, model }: DiagramScene, labels: KnowledgeGraphLabels, generation: number) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(model.nodes.length)));
    const timing = id === 'timingDiagram', strategy = id === 'wardley', matrix = id === 'dsm';
    const times = timing ? model.nodes.flatMap(({ x }) => x === undefined ? [] : [x]) : [];
    const first = times.length ? Math.min(...times) : 0;
    const duration = times.length ? Math.max(1, Math.max(...times) - first) : 1;
    const bound = (value: number, max: number) => Math.min(max, Math.max(0, value));
    const matrixStep = 44;
    const nodes: Mark[] = model.nodes.map((node, i) => {
        const x = node.x === undefined ? i % columns * STEP : timing ? (node.x - first) / duration * 650
            : strategy ? bound(node.x, 1) * 650 : bound(node.x, 2400);
        const z = node.y === undefined ? Math.floor(i / columns) * STEP : strategy ? (1 - bound(node.y, 1)) * 480 : bound(node.y, 2400);
        return { node, point: matrix ? [PAD + (i + 1) * matrixStep, 0, PAD] : [PAD + x, 0, PAD + z], key: diagramKey(node.id), label: diagramName(node) };
    });
    const byId = new Map(nodes.map((mark, i) => [mark.node.id, { ...mark, index: i }] as const));
    const paths: WorldPath[] = [], arrows: WorldPath[] = [];
    const captions: Caption[] = [];
    const extra: Mark[] = [];
    if (matrix) for (const mark of nodes) captions.push(captionAt(mark.label, [PAD, 1, mark.point[0]], 'end'));
    if (timing) {
        for (const time of new Set(times)) captions.push(captionAt(String(time), [PAD + (time - first) / duration * 650, 1, PAD / 2]));
        if (times.length) paths.push({ pts: [[PAD, 1, PAD / 2], [PAD + 650, 1, PAD / 2]], tone: TEXT, width: 1, dash: DASH_SOLID, flags: 0 });
    }
    const cells = new Map<string, number>();
    for (const [index, edge] of model.edges.entries()) {
        const a = byId.get(edge.from), b = byId.get(edge.to);
        if (!a || !b) continue;
        if (matrix) {
            const key = JSON.stringify([a.index, b.index]);
            cells.set(key, (cells.get(key) ?? 0) + (edge.count ?? 1));
            continue;
        }
        const { path, arrow, centre } = connection(edge, a.point, b.point);
        paths.push(path); arrows.push(arrow);
        const count = (edge.count ?? 1) > 1 ? ` (${edge.count})` : '';
        const order = id === 'communicationDiagram' ? `${index + 1}. ` : '';
        captions.push(captionAt(`${order}${edge.label ?? edgeKindLabel(labels, edge.kind)}${count}`, centre));
    }
    for (const [key, count] of cells) {
        const [row, col] = JSON.parse(key) as [number, number];
        const from = nodes[row]!, to = nodes[col]!;
        extra.push({ node: { id: key, kind: 'component', label: `${from.label} → ${to.label} · ${count}` },
            key: `diagram-cell:${key}`, point: [to.point[0], 0, from.point[0]], label: String(count) });
    }
    const all = [...nodes, ...extra];
    const types = all.map(({ node }) => diagramMarkType(node.kind));
    const type = Uint8Array.from(types, typeIndex);
    const draft = draftFor(all.length);
    const a11y: Placement['a11y'] = [];
    const runs: Placement['labels'] = [];
    let top = 0;
    all.forEach(({ node, point, label }, slot) => {
        const rise = 24 * FORM_RISE[TYPE_FORM[types[slot]!]];
        top = Math.max(top, rise);
        show(draft, slot, ...point, matrix ? 9 : RADIUS, rise);
        a11y.push({ slot, label: node.label });
        runs.push({ slot, text: label, offsetPx: [0, 0], font: 'mono', size: 11, weight: 500, anchor: 'middle',
            tone: TEXT, halo: { tone: BG_TONE, px: 3 }, priority: slot < nodes.length ? 2 : 1, minMarkPx: 0, scale: 'screen',
            chip: { risky: false, title: node.ref ? pathOf(node.ref) ?? node.label : node.label } });
    });
    const width = Math.max(PAD * 2, ...all.map(({ point }) => point[0] + PAD)),
        depth = matrix ? width : Math.max(PAD * 2, ...all.map(({ point }) => point[2] + PAD));
    const cacheKey = `diagram:${id}:${generation}`;
    const target: Vec3 = [width / 2, top / 2, depth / 2];
    const marks: MarkSet = {
        generation, digest: cacheKey, keys: all.map(({ key }) => key), type, batches: batchesOf(type), capacity: capacityFor(all.length),
        slotKind: new Uint8Array(all.length), parentStation: new Int32Array(all.length).fill(-1), parentFolder: new Int32Array(all.length).fill(-1),
        label: all.map(({ label }) => label), tooltip: all.map(({ node }) => node.label), importance: new Float32Array(all.length).fill(1),
    };
    const tone = Uint8Array.from(types, (kind) => toneIndex(kind === 'data' ? 'catData' : kind === 'interface' ? 'muted' : 'accent'));
    const paint: MarkPaint = {
        generation, tone, tone2: tone.slice(), fill: new Float32Array(all.length).fill(0.85), flags: new Uint16Array(all.length).fill(FLAG.SELECTABLE),
    };
    const placement: Placement = {
        generation, cacheKey, anchor: 'station', position: draft.position, scale: draft.scale, extrude: draft.extrude,
        links: [polylineBatch('edge', paths, 'px'), polylineBatch('arrow', arrows, 'px')],
        planes: [{ kind: 'room', min: [0, -4, 0], max: [width, 0, depth], tone: toneIndex('floor'), edge: toneIndex('edge') }],
        labels: runs, captions, a11y,
        caption: { shown: all.length, total: all.length, capped: false },
        bounds: { min: [0, -4, 0], max: [width, top, depth] },
        rig: { projection: 'perspective', frame: 'fill', home: { position: [target[0], 1000, target[2]], target, up: [0, 1, 0] },
            depth: { tilt: [5, 89], orbit: true }, view: { yaw: -30, pitch: matrix ? 70 : 47, distance: 1000, fov: 38, radius: Math.hypot(width, depth, top) / 2, flatDepth: 0.03 } },
    };
    return { marks, paint, placement };
}
