/**
 * Label runs → where each one is drawn (PRD 43 B1a rule 4, B3 Labels). A placement's `LabelRun`s are SLOT-RELATIVE: a
 * run names its slot, and is placed at that slot's position in the placement plus its pixel offset. `world` runs
 * (Transit, Tower) are sized in world units once; `screen` runs are re-placed when the zoom settles, sized in CSS px.
 * The label LOD (`lod.ts`) drops runs whose mark is too small for their priority, and keeps the top `maxLabels`.
 *
 * A run goes to the SDF pass only when the host gave a mono font AND the font's subset covers every glyph of its text;
 * otherwise it becomes a mono DOM caption, which gets the browser's glyph fallback (and troika never asks a CDN). Pure.
 */

import { monoCovers } from '../fonts';
import type { Caption, LabelRun, Placement } from '../types';
import { LABEL_LOD, minMarkPxFor, type LabelLod } from './lod';

export interface LabelView {
    /** CSS px per world unit at the settled zoom. */
    pxPerWorld: number;
    /** The depth control (0..1): a label sits on its mark's top, which rises with the extrude. */
    depth: number;
}

/** One placed SDF label, in world units, lying on the ground plane (screen up = world −z). */
export interface PlacedLabel {
    /** Stable per run (slot + text): the label layer reuses the typeset text object for it. */
    id: string;
    slot: number;
    text: string;
    position: [number, number, number];
    fontSize: number;
    outlineWidth: number;
    anchorX: 'left' | 'center' | 'right';
    weight: LabelRun['weight'];
    tone: number;
    haloTone: number;
    priority: number;
    note?: { text: string; tone: number; position: [number, number, number]; fontSize: number };
}

export interface PlacedLabels { sdf: PlacedLabel[]; dom: Caption[] }

const ANCHOR_X: Record<LabelRun['anchor'], PlacedLabel['anchorX']> = { start: 'left', middle: 'center', end: 'right' };
/** A note's size relative to its name (`TYPE.monoMeta` 10 / `TYPE.monoName` 11) and its line gap. */
const NOTE_RATIO = 10 / 11, LINE_GAP = 1.25;
/** Lift above the mark's top so a flat label never fights the cap for depth. */
const LIFT = 0.05;

export function placeLabels(
    runs: readonly LabelRun[], p: Pick<Placement, 'position' | 'scale' | 'extrude'>, view: LabelView,
    sdfAvailable: boolean, lod: LabelLod = LABEL_LOD,
): PlacedLabels {
    const px = Math.max(view.pxPerWorld, 1e-6);
    const shown = runs
        .filter((r) => {
            if (r.zoomPx && (px < r.zoomPx[0] || px >= r.zoomPx[1])) return false;
            const scale = p.scale[r.slot] ?? 0;
            return scale > 0 && 2 * scale * px >= minMarkPxFor(r.priority, lod);
        })
        .sort((a, b) => b.priority - a.priority || a.slot - b.slot)
        .slice(0, lod.maxLabels);
    const sdf: PlacedLabel[] = [], dom: Caption[] = [];
    for (const r of shown) {
        const unit = r.scale === 'world' ? 1 : 1 / px;
        // A world run grows with the zoom but never draws under its nominal size in CSS px: zoomed out on a wide Map or
        // Mind map (≪ 1 px per unit) its names would otherwise shrink to a few px — drawn, but unreadable. Offsets stay world.
        const textUnit = r.scale === 'world' ? Math.max(1, 1 / px) : unit;
        const x = p.position[r.slot * 3]! + (r.offsetWorld?.[0] ?? 0) + r.offsetPx[0] * unit;
        const y = (p.extrude[r.slot] ?? 0) * view.depth + LIFT;
        const z = p.position[r.slot * 3 + 2]! + (r.offsetWorld?.[1] ?? 0) + r.offsetPx[1] * unit;
        if (!sdfAvailable || !monoCovers(r.text) || (r.note && !monoCovers(r.note.text))) {
            dom.push({ text: r.text, position: [x, y, z], anchor: r.anchor, tone: r.tone, font: 'mono' });
            if (r.note) dom.push({ text: r.note.text, position: [x, y, z + r.size * LINE_GAP * textUnit], anchor: r.anchor, tone: r.note.tone, font: 'mono' });
            continue;
        }
        const fontSize = r.size * textUnit;
        sdf.push({
            id: `${r.slot}:${r.text}`, slot: r.slot, text: r.text, position: [x, y, z], fontSize,
            outlineWidth: r.halo.px * textUnit, anchorX: ANCHOR_X[r.anchor], weight: r.weight, tone: r.tone, haloTone: r.halo.tone, priority: r.priority,
            ...(r.note ? { note: { text: r.note.text, tone: r.note.tone, position: [x, y, z + fontSize * LINE_GAP] as [number, number, number], fontSize: fontSize * NOTE_RATIO } } : {}),
        });
    }
    return { sdf, dom };
}
