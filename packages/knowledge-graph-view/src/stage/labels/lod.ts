/**
 * Label level of detail as DATA (PRD 43 B4: marks, labels and links each have their own threshold). A label run shows
 * when its mark is drawn at least `minMarkPx` CSS px across for the run's priority: an important name (a busy station)
 * survives zooming out further than a minor one. At most `maxLabels` runs show at once, highest priority first.
 * The semantic-zoom bands (B1a rule 9) extend this table; nothing here is code.
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

/** The smallest on-screen mark size at which a run of `priority` shows. */
export function minMarkPxFor(priority: number, lod: LabelLod = LABEL_LOD): number {
    let px = Number.POSITIVE_INFINITY;
    for (const s of lod.steps) if (priority >= s.minPriority) px = Math.min(px, s.minMarkPx);
    return px;
}
