/**
 * The Graph camera's node captions per zoom band (PRD 43 B4 detail by zoom, B3 Labels): for each `CAPTION_ZOOM_BANDS`
 * row the band's top names (importance order) go through the 2D graph's ONE collision-avoiding placer
 * (`placeCaptions`, its spatial grid) at the band's caption size in world units, with the band captions as obstacles —
 * right of the mark, else left, else dropped, exactly as the 2D graph places them. A name is kept for a band only when
 * it is placed on the SAME side at both ends of the band, so the band's set is overlap-free at every zoom in it.
 * Consecutive bands that keep a name on the same side share one run (`zoomPx` spans them); the label layer shows a run
 * only inside its span (`stage/labels/runs.ts`).
 *
 * World geometry: a caption starts `radius` world units plus `CAPTION_GAP_EM` em from its mark's centre and is centred
 * on it vertically (troika anchors the top: offset −half a line), the 2D graph's box. Pure.
 */

import { bandCaption, placeCaptions, type Box, type CaptionCandidate, type PlacedCaption } from '../../../graph2d/captionPlacement';
import type { Band, Bounds } from '../../../graph2d/layout2d';
import { LINE_EM } from '../../../map/labelBudget';
import { CAPTION_FONT_PX, CAPTION_GAP_EM, CAPTION_ZOOM_BANDS, type CaptionZoomBand } from '../../../stage/labels/lod';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import type { Caption, LabelRun } from '../../../stage/types';

/** A captionable node in world units (x, z on the ground), in importance order. */
export interface GraphCaptionNode {
    slot: number;
    ref: string;
    x: number;
    z: number;
    /** The drawn mark's radius (world units). */
    r: number;
    text: string;
    importance: number;
}

/** The band captions the node captions avoid: each band (world units) and its localized title. */
export interface BandTitle { band: Band; text: string }

/** An effective "infinite" zoom for the open last band's far end. */
const FAR_PX = 1e4;
/** The 2D graph's always-labelled count: these keep the top label-LOD priority. */
const LEADING = CAPTION_ZOOM_BANDS[0]?.names ?? 25;
const TEXT = toneIndex('text');
const MUTED = toneIndex('muted');
const HALO_EM = 0.15;

/**
 * The placed captions of `nodes` at `px` CSS px per world unit — the 2D graph's `Captions` in world units. `sides`
 * pins each named node to one side (the far-end check of {@link bandSet}).
 */
export function captionsAt(nodes: readonly GraphCaptionNode[], titles: readonly BandTitle[], bounds: Bounds, px: number, sides?: ReadonlyMap<string, PlacedCaption['anchor']>): PlacedCaption[] {
    const font = CAPTION_FONT_PX / px;
    const obstacles: Box[] = titles.map((t) => bandCaption(t.band, bounds, font, t.text).box);
    const candidates: CaptionCandidate[] = nodes.map((n) => {
        const side = sides?.get(n.ref);
        return { ref: n.ref, x: n.x, y: n.z, r: n.r, text: n.text, ...(side ? { side } : {}) };
    });
    return placeCaptions(candidates, font, obstacles);
}

/**
 * A band's kept names, ref → side: the 2D graph's captions at the band's near (most zoomed-out) end, then those of them
 * that still fit on that same side at its far end — so the set is overlap-free at both ends.
 */
export function bandSet(nodes: readonly GraphCaptionNode[], titles: readonly BandTitle[], bounds: Bounds, band: CaptionZoomBand): Map<string, PlacedCaption['anchor']> {
    const names = nodes.slice(0, band.names);
    const near = Math.max(band.minPx, 1e-3), far = Number.isFinite(band.maxPx) ? band.maxPx : FAR_PX;
    const atNear = new Map(captionsAt(names, titles, bounds, near).map((c) => [c.ref, c.anchor] as const));
    const atFar = captionsAt(names.filter((n) => atNear.has(n.ref)), titles, bounds, far, atNear);
    return new Map(atFar.map((c) => [c.ref, c.anchor] as const));
}

/**
 * A band's title as a DOM caption that follows its obstacle box at every zoom: anchored at the band's top-left world
 * corner, shifted by the px offset `bandCaption` gives at the caption size (it is linear in the font, so the offset is
 * the same px at any zoom), centred vertically on the box. The names avoid exactly this box ({@link captionsAt}).
 */
export function bandTitleCaption(t: BandTitle, bounds: Bounds): Caption {
    const at = bandCaption(t.band, bounds, CAPTION_FONT_PX, t.text);
    return {
        text: t.text, position: [bounds.minX, 0, t.band.top], anchor: 'start', tone: MUTED, role: 'band',
        offsetPx: [at.box.x - bounds.minX, at.box.y + at.box.h / 2 - t.band.top],
    };
}

/** The runs: one per (name, side, contiguous span of bands). */
export function graphCaptionRuns(nodes: readonly GraphCaptionNode[], titles: readonly BandTitle[], bounds: Bounds, bands: readonly CaptionZoomBand[] = CAPTION_ZOOM_BANDS): LabelRun[] {
    const byRef = new Map(nodes.map((n, i) => [n.ref, { n, i }] as const));
    const open = new Map<string, { anchor: PlacedCaption['anchor']; from: number }>();
    const runs: LabelRun[] = [];
    const close = (ref: string, to: number): void => {
        const o = open.get(ref)!;
        open.delete(ref);
        const { n, i } = byRef.get(ref)!;
        runs.push(runOf(n, i, o.anchor, [bands[o.from]!.minPx, bands[to]!.maxPx]));
    };
    bands.forEach((band, b) => {
        const set = bandSet(nodes, titles, bounds, band);
        for (const [ref, o] of [...open]) if (set.get(ref) !== o.anchor) close(ref, b - 1);
        for (const [ref, anchor] of set) if (!open.has(ref)) open.set(ref, { anchor, from: b });
    });
    for (const ref of [...open.keys()]) close(ref, bands.length - 1);
    return runs.sort((p, q) => p.slot - q.slot || p.zoomPx![0] - q.zoomPx![0]);
}

function runOf(n: GraphCaptionNode, rank: number, anchor: PlacedCaption['anchor'], zoomPx: [number, number]): LabelRun {
    const sign = anchor === 'start' ? 1 : -1;
    return {
        slot: n.slot, text: n.text, font: 'mono', size: CAPTION_FONT_PX, weight: 400, anchor,
        offsetWorld: [sign * n.r, 0], offsetPx: [sign * CAPTION_GAP_EM * CAPTION_FONT_PX, -(CAPTION_FONT_PX * LINE_EM) / 2],
        tone: TEXT, halo: { tone: BG_TONE, px: CAPTION_FONT_PX * HALO_EM },
        // The 2D graph's always-named nodes outrank every other name, so the label LOD drops them last.
        priority: rank < LEADING ? 1 : Math.min(0.99, Math.max(0, n.importance)), scale: 'screen', zoomPx,
    };
}
