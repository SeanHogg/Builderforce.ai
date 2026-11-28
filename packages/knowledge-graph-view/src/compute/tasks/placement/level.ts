/**
 * The Map and 3D placement: ONE level at a time, as the design draws it (`code-visualizer-next` `layMap` / `build`). At the
 * world that is the systems (or the apps of the one system); inside a system its apps; inside an app its stations; inside a
 * station its files, then a file's symbols, then a symbol and its callees (`levelChildren.ts`). Each child is a RECTANGULAR
 * shape (`Placement.aspect`) at the design's footprint and height for its kind (`levelGeometry.ts`), standing in tier rows on
 * ONE floor plane (`tierLayout.ts`), with up to 12 of ITS children small on its roof (`roofMinis.ts`) and the references
 * between children as raised floor bars (`levelLinks.ts`). Visibility is scale: every other slot is anchored at scale 0
 * (`anchorHidden`) so a tween between levels is continuous. Map and 3D differ only in the depth (Flat collapses heights).
 * `Placement.level` says what was drawn, for the diagnostics. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { RESTING_DEPTH } from '../../../stage/depth';
import { TYPE_FORM } from '../../../stage/marks/forms';
import { toneIndex } from '../../../stage/tones';
import type { LevelDescriptor, Placement, PlaneSpec } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { associationLinks } from './associations';
import { chipLabel } from './chipLabel';
import { levelOf, type LevelChild } from './levelChildren';
import { FLOOR, FOOT, footprintScale, heightOf, kindOfChild, OUTLINE_SPAN, ROUND_KINDS, U } from './levelGeometry';
import { floorLinks } from './levelLinks';
import { homeRig, mapFit } from './mapFit';
import { drillFrameOf, placementKeyOf, type PlacementReq } from './request';
import { roofMinis, type RoofParent } from './roofMinis';
import { layTiers } from './tierLayout';

const round = (v: number): number => Math.round(v * 100) / 100;

export function placeLevel(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const lv = levelOf(g, model, drillFrameOf(req.drill), req.symbols ?? []);
    const { marks } = lv.model;
    const hidden = new Set(req.hiddenStations);
    const kids: LevelChild[] = lv.children.filter((c) => c.stationIds.length === 0 || !c.stationIds.every((id) => hidden.has(id)));
    const depth = Math.max(0, Math.min(1, req.depth ?? RESTING_DEPTH));
    const slots = marks.keys.length;
    const d = draftFor(slots), aspect = new Float32Array(slots).fill(1), ghost = new Uint8Array(slots);
    const W = FLOOR.w * U, D = FLOOR.d * U;

    const maxFiles = Math.max(1, ...kids.map((c) => c.files));
    const shapes = kids.map((c) => {
        const kind = kindOfChild(c.role, c.type), [fw, fd] = FOOT[kind], k = footprintScale(c.files, maxFiles);
        return { kind, w: fw * k, d: ROUND_KINDS.has(kind) ? fw * k : fd * k, h: heightOf(kind, c.cx) };
    });
    const spots = layTiers(kids.map((c, i) => ({ tier: c.tier, w: shapes[i]!.w, d: shapes[i]!.d })));

    let top = 0, ghosts = 0;
    const labels: Placement['labels'] = [], a11y: Placement['a11y'] = [], corners: { x: number; y: number }[] = [];
    const info: LevelDescriptor['children'] = [], roofs: RoofParent[] = [];
    kids.forEach((c, i) => {
        const spot = spots[i]!, shape = shapes[i]!;
        const w = spot.w, dd = ROUND_KINDS.has(shape.kind) ? spot.w : spot.d;
        const x = W / 2 + spot.x * U, z = D / 2 + spot.z * U, extrude = depth * shape.h * U;
        top = Math.max(top, extrude);
        show(d, c.slot, x, 0, z, (w * U) / OUTLINE_SPAN, extrude);
        aspect[c.slot] = dd / Math.max(w, 1e-6);
        if (c.ghost) { ghost[c.slot] = 1; ghosts++; }
        corners.push({ x: x - (w * U) / 2, y: z - (dd * U) / 2 }, { x: x + (w * U) / 2, y: z + (dd * U) / 2 });
        labels.push(chipLabel(c.slot, c.name, (dd * U) / 2, c.importance, c.risky, marks.tooltip[c.slot]));
        a11y.push({ slot: c.slot, label: marks.tooltip[c.slot] ?? c.name });
        roofs.push({ x, z, w, d: dd, roof: shape.h * U });
        info.push({ slot: c.slot, key: c.key, name: c.name, kind: shape.kind, form: TYPE_FORM[c.type], w: round(w), d: round(dd), h: round(shape.h), files: c.files, minis: 0 });
    });
    // Every child stands first; a roof then takes only the slots no child holds.
    kids.forEach((c, i) => {
        const held = lv.below(c);
        roofMinis(d, aspect, roofs[i]!, held);
        info[i]!.minis = held.length;
    });
    anchorHidden(marks, d, 'station', [W / 2, 0, D / 2]);

    const centres = kids.map((c) => ({ x: d.position[c.slot * 3]!, z: d.position[c.slot * 3 + 2]! }));
    const slotOfRef = new Map<string, number>();
    for (const c of kids) if (c.role === 'node' && c.refs[0] !== undefined) slotOfRef.set(c.refs[0], c.slot);
    const associations = lv.drilled ? associationLinks({ position: d.position, scale: d.scale }, req.symbols ?? [], slotOfRef) : null;

    const inside = req.drill != null;
    const planes: PlaneSpec[] = kids.length ? [{
        kind: 'room', min: [0, -FLOOR.thick * U, 0], max: [W, 0, D], tone: toneIndex(inside ? 'room' : 'floor'), edge: toneIndex(inside ? 'lit' : 'edge'),
    }] : [];
    const fit = mapFit({ width: W, height: D }, corners, top);
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude, aspect,
        links: [floorLinks(g, { ...lv, children: kids }, centres), ...(associations ? [associations] : [])],
        planes, labels, captions: [], a11y,
        // A roof miniature stands on its parent's roof: its y lowers with the extrude in Flat.
        liftWithDepth: true,
        caption: { shown: kids.length, total: lv.total, capped: kids.length < lv.total },
        bounds: { min: [0, 0, 0], max: [W, top, D] },
        rig: homeRig(fit, top),
        ...(lv.drilled?.append ? { append: lv.drilled.append } : {}), ...(ghosts ? { ghost } : {}),
        level: { level: lv.level, ref: lv.ref, name: lv.name, children: info, total: lv.total, notOnMap: lv.notOnMap },
    };
}
