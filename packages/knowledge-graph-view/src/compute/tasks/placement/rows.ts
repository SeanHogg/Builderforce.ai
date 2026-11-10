/**
 * The ONE row-plane layout the grouped cameras share (PRD 43 B1a rule 8: System, Heat, Style and Features are the same
 * marks grouped into their view's planes). A camera hands over its grouping — sections (a system), each of rows (a
 * tier, a layer, a feature group), each of slots — and this lays it out the way the DOM cameras read: a row is a plane
 * (alternating tone) with its title caption at the top and its marks left to right, wrapping at the viewport band's
 * width; a section title sits above its rows; a row cut short says "+N more" after its last mark. A slot already placed
 * by an earlier row keeps that place (first row wins), so a slot is never shown twice. Then {@link rowsPlacement}
 * anchors every other slot (rule 4) and returns the {@link Placement}. Pure.
 */

import type { OverlayModel } from '../../../surface/overlays';
import type { Station } from '../../../surface/stations';
import { towerHeight } from '../../../surface/transit/towerHeight';
import { fillTemplate } from '../../../template';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import type { A11yItem, Caption, LabelRun, LinkBatch, Placement, PlaneSpec } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, VISIBLE, show, type Draft } from './anchor';
import { CAMERA_WORD, wordIn } from './cameraStrings';
import { placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

export interface RowItem {
    slot: number;
    scale: number;
    extrude?: number;
    /** The mono name drawn under the mark; none = no label. */
    label?: string;
    /** The accessible name; defaults to the label, then the MarkSet's label. */
    a11y?: string;
    priority?: number;
}

export interface Row {
    /** The grouping id (a layer, a feature group, `stores`): parity tests read it. */
    key: string;
    title: string;
    items: readonly RowItem[];
    /** Members the row leaves out ("+N more"). */
    more?: number;
}

export interface Section { key: string; title: string | null; rows: readonly Row[] }

export interface RowsOut {
    planes: PlaneSpec[];
    captions: Caption[];
    labels: LabelRun[];
    a11y: A11yItem[];
    /** Row key → the slots it shows, in order (after first-row-wins). */
    rowSlots: Map<string, number[]>;
    width: number;
    height: number;
    top: number;
}

export interface RowMetrics { pitch: number; margin: number }

/** A station's mark as every row camera draws it: radius = the size channel, tilt extrudes it to its tower (Map's reading). */
export function stationItem(model: StageModel, overlay: OverlayModel, depth: number, s: Station): RowItem | null {
    const slot = model.stationSlot.get(s.id);
    if (slot === undefined) return null;
    const size = overlay.style(s).size;
    return { slot, scale: size, extrude: depth * towerHeight(size, s.cx), label: s.name, a11y: s.path ?? s.name, priority: s.use };
}

/** The request's tilt, 0 (flat) to 1. */
export const depthOf = (req: Pick<PlacementReq, 'depth'>): number => Math.max(0, Math.min(1, req.depth ?? 0));

const SECTION_HEAD = 24;
const ROW_HEAD = 28;
const ROW_FOOT = 10;
const MUTED = toneIndex('muted');
const TEXT = toneIndex('text');
const BAND_TONES = [toneIndex('plane'), toneIndex('bg')];

export function layoutRows(d: Draft, sections: readonly Section[], req: Pick<PlacementReq, 'viewportBand'>, strings: Readonly<Record<string, string>>, m: RowMetrics): RowsOut {
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const cols = Math.max(1, Math.floor((width - 2 * m.margin) / m.pitch));
    const out: RowsOut = { planes: [], captions: [], labels: [], a11y: [], rowSlots: new Map(), width, height: 0, top: 0 };
    let z = m.margin, band = 0;
    for (const section of sections) {
        if (section.title !== null) {
            out.captions.push({ text: section.title, position: [m.margin, 0, z + 14], anchor: 'start', tone: TEXT, role: 'plane' });
            z += SECTION_HEAD;
        }
        for (const row of section.rows) {
            const top = z;
            const slots: number[] = [];
            for (const item of row.items) {
                if (d.placed[item.slot] === VISIBLE) continue;
                const col = slots.length % cols, line = Math.floor(slots.length / cols);
                const x = m.margin + (col + 0.5) * m.pitch, zz = top + ROW_HEAD + (line + 0.5) * m.pitch;
                show(d, item.slot, x, 0, zz, item.scale, item.extrude ?? 0);
                out.top = Math.max(out.top, item.extrude ?? 0);
                slots.push(item.slot);
                if (item.label) {
                    out.labels.push({
                        slot: item.slot, text: item.label, offsetPx: [0, item.scale + 10], font: 'mono', size: 10, weight: 400, anchor: 'middle',
                        tone: TEXT, halo: { tone: BG_TONE, px: 3 }, priority: item.priority ?? 0, scale: 'world',
                    });
                }
                const label = item.a11y ?? item.label;
                out.a11y.push({ slot: item.slot, label: label ?? '' });
            }
            const lines = Math.max(1, Math.ceil(slots.length / cols));
            if (row.more && row.more > 0) {
                // Just after the row's last mark (or at the row's start when it shows none).
                const last = slots.length - 1, line = last < 0 ? 0 : Math.floor(last / cols), col = last < 0 ? 0 : (last % cols) + 1;
                const text = fillTemplate(wordIn(strings, CAMERA_WORD.more), { count: row.more });
                out.captions.push({ text, position: [m.margin + col * m.pitch + 4, 0, top + ROW_HEAD + (line + 0.5) * m.pitch], anchor: 'start', tone: MUTED });
            }
            z = top + ROW_HEAD + lines * m.pitch + ROW_FOOT;
            out.planes.push({ kind: 'band', min: [0, -0.5, top], max: [width, -0.5, z], tone: BAND_TONES[band++ % 2]! });
            out.captions.push({ text: row.title, position: [m.margin, 0, top + 14], anchor: 'start', tone: MUTED, role: 'band' });
            out.rowSlots.set(row.key, slots);
        }
    }
    out.height = z + m.margin;
    return out;
}

/** The finished placement of a row camera: every unplaced slot anchored (rule 4), a `fill` frame, tilt = the plane stack. */
export function rowsPlacement(model: StageModel, req: PlacementReq, d: Draft, rows: RowsOut, total: number, links: LinkBatch[] = []): Placement {
    const { marks } = model;
    const { width, height } = rows;
    anchorHidden(marks, d, 'station', [width / 2, 0, height / 2]);
    // A slot with no label of its own is named by its MarkSet label.
    const a11y = rows.a11y.map((a) => (a.label ? a : { ...a, label: marks.label[a.slot] ?? marks.keys[a.slot] ?? '' }));
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links, planes: rows.planes, labels: rows.labels, captions: rows.captions, a11y,
        caption: { shown: a11y.length, total, capped: a11y.length < total },
        bounds: { min: [0, 0, 0], max: [width, rows.top, height] },
        rig: {
            projection: 'orthographic', frame: 'fill',
            home: { position: [width / 2, 1000, height / 2], target: [width / 2, 0, height / 2], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
    };
}
