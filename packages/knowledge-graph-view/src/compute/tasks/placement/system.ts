/**
 * The System placement (PRD 43 B1a rule 8): the System camera's tiers as planes of the SAME station marks. It reads the
 * DOM camera's own model — `buildSystemGroups` / `buildSystemLayout`, unchanged — so the grouping cannot drift: one
 * section per system (a multi-system root), each a plane per tier (its first `MAX_PER_TIER` stations, "+N more" for
 * the rest), then a row of the system's deployable units (capsules: containers, workers, functions — `deployFacts.ts`),
 * then the data stores and external services as the last plane, with the units' bindings (queues, buckets, databases)
 * beside them. Stations in no layer and on no line stay hidden (the DOM camera only counts them). Marks: radius = the
 * size channel; tilt extrudes each into its tower. Pure.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { deployBindingsOf, deployUnitsOf } from '../../../deployFacts';
import { bandTitleIn } from '../../../surface/bands';
import { makeOverlay, NEUTRAL_SIZE } from '../../../surface/overlays';
import { stationOfRef } from '../../../surface/stations';
import { buildSystemGroups } from '../../../surface/system/systemGroups';
import { buildSystemLayout, type SystemLayout } from '../../../surface/system/systemModel';
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { draftFor } from './anchor';
import { CAMERA_WORD, wordIn } from './cameraStrings';
import { channelBindings, type PlacementReq } from './request';
import { depthOf, layoutRows, rowsPlacement, stationItem, type Row, type RowItem, type Section } from './rows';

export const SYSTEM_METRICS = { pitch: 72, margin: 16 } as const;

/** A unit's and a binding's mark radius (world units): a station's neutral size, so the rows read as one grid. */
const UNIT_SCALE = NEUTRAL_SIZE;

interface Placed { node: KNode; system: string }

/**
 * The deployable units and bindings (`deployFacts.ts`), each with its system: the system of its descriptor file — the
 * file whose `mentions` edge points at it — read through that file's station (`Station.system`; '' for none).
 */
export function deployBySystem(g: KnowledgeGraph, model: Pick<StageModel, 'stations'>): { units: Placed[]; bindings: Placed[] } {
    const unitRefs = new Set(deployUnitsOf(g).map((u) => u.ref));
    const bindings = deployBindingsOf(g);
    const wanted = new Set([...unitRefs, ...bindings.map((b) => b.ref as string)]);
    const descriptor = new Map<string, string>();
    for (const e of g.edges) if (e.kind === 'mentions' && wanted.has(e.to) && !descriptor.has(e.to)) descriptor.set(e.to, e.from);
    const systemOf = (ref: string): string => {
        const file = descriptor.get(ref);
        const station = file === undefined ? undefined : stationOfRef(model.stations, file);
        return (station === undefined ? undefined : model.stations.byId.get(station)?.system) ?? '';
    };
    const nodes = new Map(g.nodes.map((n) => [n.ref as string, n] as const));
    return {
        units: [...unitRefs].flatMap((ref) => { const node = nodes.get(ref); return node ? [{ node, system: systemOf(ref) }] : []; }),
        bindings: bindings.map((node) => ({ node, system: systemOf(node.ref) })),
    };
}

export function placeSystem(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const { stations, lines, strings } = model;
    const overlay = makeOverlay(channelBindings(req.channels), stations.stations);
    const depth = depthOf(req);
    const item = (id: string): RowItem[] => { const s = stations.byId.get(id); const it = s ? stationItem(model, overlay, depth, s) : null; return it ? [it] : []; };
    const deploy = deployBySystem(g, model);
    const entity = (n: { ref: string; label: string }): RowItem[] => { const slot = model.nodeSlot.get(n.ref); return slot === undefined ? [] : [{ slot, scale: UNIT_SCALE, label: n.label, a11y: n.label }]; };
    const rowsOf = (layout: SystemLayout, prefix: string, system: string | null): Row[] => {
        // `system` null = a single-system root: every unit and binding is its own.
        const units = deploy.units.filter((u) => system === null || u.system === system).flatMap((u) => entity(u.node));
        const bindings = deploy.bindings.filter((b) => system === null || b.system === system).flatMap((b) => entity(b.node));
        const stores = [...layout.stores.flatMap((t) => item(t.stationId)), ...bindings];
        return [
            ...layout.tiers.map((t): Row => ({ key: `${prefix}${t.layer}`, title: bandTitleIn(strings, t.layer), items: t.shown.flatMap((s) => item(s.id)), more: t.hidden })),
            ...(units.length > 0 ? [{ key: `${prefix}units`, title: wordIn(strings, CAMERA_WORD.systemUnits), items: units }] : []),
            ...(stores.length > 0 ? [{ key: `${prefix}stores`, title: wordIn(strings, CAMERA_WORD.systemData), items: stores }] : []),
        ];
    };
    const groups = buildSystemGroups(stations, lines, g);
    const sections: Section[] = groups.length === 0
        ? [{ key: '', title: null, rows: rowsOf(buildSystemLayout(stations, lines, g), '', null) }]
        : groups.map((gr) => ({ key: gr.system, title: gr.name || wordIn(strings, CAMERA_WORD.systemLoose), rows: rowsOf(gr.layout, `${gr.system}/`, gr.system) }));
    const d = draftFor(model.marks.keys.length);
    const rows = layoutRows(d, sections, req, strings, SYSTEM_METRICS);
    return rowsPlacement(model, req, d, rows, stations.stations.length);
}
