/**
 * Label level of detail as DATA (PRD 43 B4: marks, labels and links each have their own threshold). A label run shows
 * when its mark is drawn at least `minMarkPx` CSS px across for the run's priority: an important name (a busy station)
 * survives zooming out further than a minor one. At most `maxLabels` runs show at once, highest priority first.
 * The semantic-zoom bands (B1a rule 9) are a table below too ({@link ZOOM_BANDS}); nothing here is code.
 */

export interface LabelLodStep {
    /** Runs with at least this priority (0..1) … */
    minPriority: number;
    /** … show once their mark is at least this many CSS px across. */
    minMarkPx: number;
}

export interface LabelLod {
    steps: readonly LabelLodStep[];
    maxLabels: number;
}

export const LABEL_LOD: LabelLod = {
    steps: [
        { minPriority: 0.6, minMarkPx: 4 },
        { minPriority: 0.25, minMarkPx: 8 },
        { minPriority: 0, minMarkPx: 12 },
    ],
    maxLabels: 400,
};

/**
 * Caption zoom bands (B4 detail by zoom) for a placement that chooses its captions itself, collision-free (the Graph's
 * `placeCaptions`): `[minPx, maxPx)` is the settled zoom in CSS px per world unit (a placement's world is laid out about
 * 1 px per unit at home), `names` how many names compete in it, most important first. Zooming in widens the set; the
 * first band's 25 is the 2D graph's `LABELLED_NODES`. Each band's set is free of overlaps at both of its ends.
 */
export interface CaptionZoomBand { minPx: number; maxPx: number; names: number }

export const CAPTION_ZOOM_BANDS: readonly CaptionZoomBand[] = [
    // Below a quarter px per unit a mark is under a pixel: no names (the label LOD would drop them anyway).
    { minPx: 0.25, maxPx: 0.5, names: 25 },
    { minPx: 0.5, maxPx: 0.71, names: 25 },
    { minPx: 0.71, maxPx: 1, names: 25 },
    { minPx: 1, maxPx: 1.41, names: 40 },
    { minPx: 1.41, maxPx: 2, names: 60 },
    { minPx: 2, maxPx: 2.83, names: 100 },
    { minPx: 2.83, maxPx: 4, names: 160 },
    { minPx: 4, maxPx: 8, names: 250 },
    { minPx: 8, maxPx: Number.POSITIVE_INFINITY, names: 400 },
];

/** A caption's size and its gap from the mark in CSS px (the 2D graph's `FONT_PX` and its 0.4-em gap). */
export const CAPTION_FONT_PX = 11;
export const CAPTION_GAP_EM = 0.4;

/**
 * The semantic-zoom bands (B1a rule 9) as DATA: system → class → method → code, each a level of the same slot forest.
 * Band `i` is ENTERED when the mark under the zoom point (a mark of band `i − 1`'s level) is drawn at least `enterPx`
 * CSS px across, and LEFT when its parent mark falls below `exitPx` — the gap is the hysteresis, so a zoom resting on a
 * threshold never flickers. Strictly increasing, so one zoom never crosses two bands at once (a Sequence participant
 * keeps its size from band to band). The rig and the Sequence read the same rows; nothing here is code.
 */
export type ZoomBand = 'system' | 'class' | 'method' | 'code';

export interface ZoomBandStep { band: ZoomBand; enterPx: number; exitPx: number }

export const ZOOM_BANDS: readonly ZoomBandStep[] = [
    { band: 'system', enterPx: 0, exitPx: 0 },
    { band: 'class', enterPx: 120, exitPx: 96 },
    { band: 'method', enterPx: 240, exitPx: 190 },
    { band: 'code', enterPx: 420, exitPx: 330 },
];

/** A zoom-entered level spreads over this many of its parent mark's diameters, centred on the parent. */
export const NEST_SPREAD = 4;
/** "Go inside" flies to this many times the next band's `enterPx`, so it lands clear of the threshold. */
export const ZOOM_OVERSHOOT = 1.15;

/** The smallest on-screen mark size at which a run of `priority` shows. */
export function minMarkPxFor(priority: number, lod: LabelLod = LABEL_LOD): number {
    let px = Number.POSITIVE_INFINITY;
    for (const s of lod.steps) if (priority >= s.minPriority) px = Math.min(px, s.minMarkPx);
    return px;
}
